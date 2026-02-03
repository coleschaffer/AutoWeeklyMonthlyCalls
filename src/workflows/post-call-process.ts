import * as zoom from '../services/zoom.js';
import * as videoProcessor from '../services/video-processor.js';
import * as youtube from '../services/youtube.js';
import * as googleDrive from '../services/google-drive.js';
import * as circle from '../services/circle.js';
import * as claude from '../services/claude.js';
import * as activeCampaign from '../services/activecampaign.js';
import * as slack from '../services/slack.js';
import * as pendingStore from '../services/pending-store.js';
import { getReminderTopic, storeReminderTopic, upsertCallHistory } from '../services/pending-store.js';
import { detectCallType } from '../config/schedule.js';
import { env } from '../config/env.js';
import {
  findConversationStart,
  extractPlainText,
} from '../utils/transcript-parser.js';
import { formatDateForFile, formatDateForCircle } from '../utils/date-helpers.js';
import type {
  ZoomWebhookPayload,
  PostCallProcessResult,
  CallType,
  ZoomTranscript,
} from '../types/index.js';

const TEMP_DIR = '/tmp/ca-pro-videos';

/**
 * Main post-call processing workflow
 * Triggered by Zoom webhook when recording is ready
 */
export async function processRecording(
  payload: ZoomWebhookPayload
): Promise<PostCallProcessResult> {
  const meetingId = payload.payload.object.uuid;
  const rawTopic = payload.payload.object.topic;

  console.log(`Starting post-call processing for meeting: ${meetingId}`);
  console.log(`Topic: ${rawTopic}`);

  try {
    // Step 1: Get recording details from Zoom
    console.log('Step 1: Fetching recording details...');
    const recording = await zoom.getRecording(meetingId);
    const callType = detectCallType(rawTopic);
    const dateStr = formatDateForFile(recording.startTime);

    // Try to get the topic from the stored reminder first
    // This ensures recaps use the same topic that was used for reminders
    const storedTopic = await getReminderTopic(callType, recording.startTime);
    const topic = storedTopic?.topic || zoom.extractTopicFromMeeting(rawTopic);

    console.log(`Detected call type: ${callType}`);
    console.log(`Topic source: ${storedTopic ? 'stored reminder' : 'extracted from meeting title'}`);
    console.log(`Topic: ${topic}`);

    // Step 2: Download and parse transcript
    console.log('Step 2: Processing transcript...');
    let transcript: ZoomTranscript | null = null;
    let transcriptText = '';
    let rawVttContent = '';
    let trimStartSeconds = 0;

    if (recording.transcriptUrl) {
      // Get raw VTT content for Drive upload
      rawVttContent = await zoom.getRawTranscriptContent(recording.transcriptUrl);
      transcript = await zoom.getTranscript(meetingId, recording.transcriptUrl);
      transcriptText = extractPlainText(transcript);
      trimStartSeconds = findConversationStart(transcript);
      console.log(`Transcript parsed. Trim start: ${trimStartSeconds}s`);
    } else {
      console.log('No transcript available, skipping trim optimization');
    }

    // Step 3: Download video
    console.log('Step 3: Downloading video...');
    const videoPath = `${TEMP_DIR}/${dateStr}_recording.mp4`;

    // Ensure the temp directory exists
    const fs = await import('fs');
    await fs.promises.mkdir(TEMP_DIR, { recursive: true });
    console.log(`Ensured temp directory exists: ${TEMP_DIR}`);

    await zoom.downloadRecording(recording.videoUrl, videoPath);
    console.log(`Video downloaded to: ${videoPath}`);

    // Step 4: Trim video
    console.log('Step 4: Trimming video...');
    const trimResult = await videoProcessor.trimVideo(videoPath, trimStartSeconds);
    console.log(
      `Video trimmed: ${trimResult.originalDuration}s -> ${trimResult.newDuration}s`
    );

    // Step 5: Generate AI summary
    console.log('Step 5: Generating AI summary...');
    let summary = {
      description: `This ${callType} training call covered ${topic}.`,
      keyTakeaways: [
        'Key strategies and insights were shared.',
        'Practical implementation tips discussed.',
        'Watch the full recording for details.',
      ],
    };

    if (transcriptText) {
      summary = await claude.generateCallSummary(transcriptText, topic);
      console.log('AI summary generated');
    }

    // Step 6: Upload to YouTube
    console.log('Step 6: Uploading to YouTube...');
    const youtubeTitle = `${formatDateForCircle(recording.startTime)} - CA Pro ${
      callType === 'weekly' ? 'Weekly' : 'Monthly'
    } Training: ${topic}`;

    const youtubeResult = await youtube.uploadCallRecording(
      trimResult.outputPath,
      youtubeTitle,
      summary.description
    );
    console.log(`YouTube upload complete: ${youtubeResult.videoUrl}`);

    // Step 7: Upload to Google Drive
    console.log('Step 7: Uploading to Google Drive...');
    let chatContent = '';
    if (recording.chatUrl) {
      chatContent = await zoom.getChatContent(recording.chatUrl);
    }

    const driveLinks = await googleDrive.uploadCallFiles(
      recording.startTime,
      callType,
      topic,
      {
        videoPath: trimResult.outputPath,
        transcriptContent: rawVttContent || undefined,
        chatContent: chatContent || undefined,
      }
    );
    console.log('Google Drive upload complete');

    // Step 8: Create Circle post
    console.log('Step 8: Creating Circle post...');
    const circlePost = await circle.createCallPost({
      date: recording.startTime,
      callType,
      topic,
      youtubeId: youtubeResult.videoId,
      youtubeUrl: youtubeResult.videoUrl,
      driveVideoLink: driveLinks.video?.webViewLink || '#',
      driveTranscriptLink: driveLinks.transcript?.webViewLink || '#',
      driveChatLink: driveLinks.chat?.webViewLink || '#',
      description: summary.description,
      bullets: summary.keyTakeaways,
    });
    console.log(`Circle post created: ${circlePost.url}`);

    // Step 9: Send follow-up notifications
    console.log('Step 9: Sending follow-up notifications...');
    await sendFollowUpNotifications(
      callType,
      topic,
      summary.description,
      summary.keyTakeaways,
      circlePost.url,
      youtubeResult.videoUrl,
      recording.startTime,
      transcriptText,
      {
        video: driveLinks.video?.webViewLink,
        transcript: driveLinks.transcript?.webViewLink,
        chat: driveLinks.chat?.webViewLink,
      },
      youtubeResult.videoId
    );
    console.log('Follow-up notifications sent');

    // Step 10: Cleanup temp files
    console.log('Step 10: Cleaning up...');
    await videoProcessor.cleanupTempFiles([videoPath, trimResult.outputPath]);

    // Log to call history
    await upsertCallHistory({
      meetingId,
      callType,
      topic,
      presenter: storedTopic?.presenter,
      callDate: recording.startTime,
      status: 'completed',
      youtubeUrl: youtubeResult.videoUrl,
      youtubeId: youtubeResult.videoId,
      circleUrl: circlePost.url,
      driveVideoUrl: driveLinks.video?.webViewLink,
      driveTranscriptUrl: driveLinks.transcript?.webViewLink,
      driveChatUrl: driveLinks.chat?.webViewLink,
    });

    console.log('Post-call processing complete!');

    return {
      success: true,
      meetingId,
      youtubeUrl: youtubeResult.videoUrl,
      driveLinks,
      circlePostUrl: circlePost.url,
      summary,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`Post-call processing failed: ${errorMessage}`);

    // Log failure to call history
    try {
      await upsertCallHistory({
        meetingId,
        callType: detectCallType(rawTopic),
        topic: rawTopic,
        callDate: new Date(),
        status: 'failed',
        errorMessage,
      });
    } catch (historyError) {
      console.error('Failed to log call history:', historyError);
    }

    return {
      success: false,
      meetingId,
      error: errorMessage,
    };
  }
}

/**
 * Send follow-up notifications via email and Slack
 * Now generates all recap formats and sends to Slack for approval
 */
async function sendFollowUpNotifications(
  callType: CallType,
  topic: string,
  description: string,
  keyTakeaways: string[],
  circleUrl: string,
  youtubeUrl: string,
  callDate: Date,
  transcriptText: string,
  driveLinks?: { video?: string; transcript?: string; chat?: string },
  youtubeId?: string
): Promise<void> {
  // Generate all recap formats using Claude
  let recaps;
  try {
    if (transcriptText && transcriptText.length > 100) {
      recaps = await claude.generateAllRecaps(
        transcriptText,
        topic,
        callType,
        circleUrl,
        driveLinks,
        youtubeId
      );
      console.log('AI-generated recap formats created');
    } else {
      // Fallback if no transcript
      const fallbackDescription = description || `Key insights from the ${callType} call on ${topic}.`;
      recaps = {
        whatsapp: `🎬 The ${callType === 'weekly' ? 'Weekly Training' : 'Monthly Business Owner'} Call recap is posted!\n\n${fallbackDescription}\n\nCheck it out: ${circleUrl}`,
        email: `Hey [first name],\n\nThis week's training call is now posted in Circle.\n\n${fallbackDescription}\n\nCheck it out here: ${circleUrl}\n\n—Stefan + Angela`,
        circle: description,
        structured: {
          description: fallbackDescription,
          quote: 'Great insights shared on today\'s call.',
          speaker: 'Stefan',
          sections: [],
          bullets: keyTakeaways,
        },
      };
    }
  } catch (error) {
    console.error('Failed to generate AI recaps:', error);
    // Use simple fallback
    const fallbackDescription = description || `Key insights from the ${callType} call on ${topic}.`;
    recaps = {
      whatsapp: `🎬 The ${callType === 'weekly' ? 'Weekly Training' : 'Monthly Business Owner'} Call recap is posted!\n\n${fallbackDescription}\n\nCheck it out: ${circleUrl}`,
      email: `Hey [first name],\n\nThis week's training call is now posted in Circle.\n\n${fallbackDescription}\n\nCheck it out here: ${circleUrl}\n\n—Stefan + Angela`,
      circle: description,
      structured: {
        description: fallbackDescription,
        quote: 'Great insights shared on today\'s call.',
        speaker: 'Stefan',
        sections: [],
        bullets: keyTakeaways,
      },
    };
  }

  // Send to Slack #ca-pro channel for approval (don't auto-send anymore)
  try {
    const caProChannel = env.SLACK_CA_PRO_CHANNEL_ID;
    const adminUserId = env.SLACK_WELCOME_USER_ID;

    if (slack.isSlackConfigured() && caProChannel) {
      // Post header message to #ca-pro channel (this starts the thread)
      const headerResult = await slack.postMessage(
        caProChannel,
        `🎬 New ${callType === 'weekly' ? 'Weekly' : 'Monthly'} Recap Ready for Review`,
        [
          {
            type: 'header',
            text: {
              type: 'plain_text',
              text: `🎬 ${topic} - Recap Ready`,
              emoji: true,
            },
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*Call Type:* ${callType === 'weekly' ? 'Weekly Training' : 'Monthly Business Owner'}\n*Topic:* ${topic}\n*Circle Post:* ${circleUrl}\n\nReview and approve each message below.`,
            },
          },
          {
            type: 'divider',
          },
        ]
      );

      // Get the thread timestamp from the header message
      const threadTs = headerResult?.ts;

      // Store and post Circle recap (needs approval to post) - as thread reply
      const circlePendingId = pendingStore.storePending({
        type: 'recap',
        channel: 'circle',
        callType,
        message: recaps.circle,
        metadata: { topic, circleUrl, youtubeUrl, youtubeId },
        slackMessageTs: threadTs || '',
        slackChannel: caProChannel,
      });

      const circleBlocks = slack.buildCircleRecapBlocks(recaps.circle, circlePendingId, topic);
      await slack.postMessage(caProChannel, 'Circle Recap', circleBlocks, undefined, threadTs);

      // Store and post WhatsApp recap (copy only) - as thread reply
      const whatsappPendingId = pendingStore.storePending({
        type: 'recap',
        channel: 'whatsapp',
        callType,
        message: recaps.whatsapp,
        metadata: { topic, circleUrl },
        slackMessageTs: threadTs || '',
        slackChannel: caProChannel,
      });

      const whatsappBlocks = slack.buildWhatsAppRecapBlocks(recaps.whatsapp, whatsappPendingId);
      await slack.postMessage(caProChannel, 'WhatsApp Recap', whatsappBlocks, undefined, threadTs);

      // Store and post Email recap (needs approval to send) - as thread reply
      const emailPendingId = pendingStore.storePending({
        type: 'recap',
        channel: 'email',
        callType,
        message: recaps.email,
        metadata: { topic, circleUrl },
        slackMessageTs: threadTs || '',
        slackChannel: caProChannel,
      });

      const emailBlocks = slack.buildEmailRecapBlocks(recaps.email, emailPendingId);
      await slack.postMessage(caProChannel, 'Email Recap', emailBlocks, undefined, threadTs);

      // Tag admin user at the end of the thread
      if (adminUserId) {
        await slack.postMessage(
          caProChannel,
          `<@${adminUserId}> Recaps are ready above! ☝️`,
          undefined,
          undefined,
          threadTs
        );
      }

      console.log('Slack recap messages sent to #ca-pro channel for approval');
    }
  } catch (error) {
    console.error('Slack notification failed:', error);
  }
}

/**
 * Manual trigger for processing (for retries or manual runs)
 * @param meetingId - Zoom meeting ID
 * @param overrideTopic - Optional topic to use instead of extracting from meeting title
 */
export async function processRecordingManual(
  meetingId: string,
  overrideTopic?: string
): Promise<PostCallProcessResult> {
  console.log(`Manual processing triggered for meeting: ${meetingId}`);
  if (overrideTopic) {
    console.log(`Using override topic: ${overrideTopic}`);
  }

  try {
    // Get recording details
    const recording = await zoom.getRecording(meetingId);

    // If override topic provided, store it so processRecording picks it up
    if (overrideTopic) {
      const callType = detectCallType(recording.topic);
      await storeReminderTopic(callType, recording.startTime, overrideTopic);
    }

    // Create a mock webhook payload
    const mockPayload: ZoomWebhookPayload = {
      event: 'recording.completed',
      event_ts: Date.now(),
      payload: {
        account_id: '',
        object: {
          id: meetingId,
          uuid: meetingId,
          host_id: '',
          topic: recording.topic,
          type: 2,
          start_time: recording.startTime.toISOString(),
          duration: recording.duration,
          timezone: 'America/New_York',
          recording_files: [],
        },
      },
    };

    return processRecording(mockPayload);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return {
      success: false,
      meetingId,
      error: errorMessage,
    };
  }
}
