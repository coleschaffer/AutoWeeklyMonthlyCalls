import * as zoom from '../services/zoom.js';
import * as videoProcessor from '../services/video-processor.js';
import * as youtube from '../services/youtube.js';
import * as googleDrive from '../services/google-drive.js';
import * as circle from '../services/circle.js';
import * as claude from '../services/claude.js';
import * as activeCampaign from '../services/activecampaign.js';
import * as slack from '../services/slack.js';
import { detectCallType } from '../config/schedule.js';
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
    const topic = zoom.extractTopicFromMeeting(rawTopic);
    const callType = detectCallType(rawTopic);
    const dateStr = formatDateForFile(recording.startTime);

    console.log(`Detected call type: ${callType}`);
    console.log(`Extracted topic: ${topic}`);

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
      recording.startTime
    );
    console.log('Follow-up notifications sent');

    // Step 10: Cleanup temp files
    console.log('Step 10: Cleaning up...');
    await videoProcessor.cleanupTempFiles([videoPath, trimResult.outputPath]);

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

    return {
      success: false,
      meetingId,
      error: errorMessage,
    };
  }
}

/**
 * Send follow-up notifications via email and Slack
 */
async function sendFollowUpNotifications(
  callType: CallType,
  topic: string,
  description: string,
  keyTakeaways: string[],
  circleUrl: string,
  youtubeUrl: string,
  callDate: Date
): Promise<void> {
  // Send email notification
  try {
    await activeCampaign.sendRecordingNotification(topic, description, circleUrl);
    console.log('Email notification sent');
  } catch (error) {
    console.error('Email notification failed:', error);
  }

  // Send Slack notification to admin (for WhatsApp copy)
  try {
    if (slack.isSlackConfigured()) {
      await slack.sendRecapToAdmin(
        callType,
        callDate,
        topic,
        description,
        keyTakeaways,
        circleUrl,
        youtubeUrl
      );
      console.log('Slack notification sent');
    }
  } catch (error) {
    console.error('Slack notification failed:', error);
  }
}

/**
 * Manual trigger for processing (for retries or manual runs)
 */
export async function processRecordingManual(
  meetingId: string
): Promise<PostCallProcessResult> {
  console.log(`Manual processing triggered for meeting: ${meetingId}`);

  try {
    // Get recording details
    const recording = await zoom.getRecording(meetingId);

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
