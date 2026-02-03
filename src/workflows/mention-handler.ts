import * as slack from '../services/slack.js';
import * as claude from '../services/claude.js';
import * as zoom from '../services/zoom.js';
import { env } from '../config/env.js';
import { storePending } from '../services/pending-store.js';
import {
  getReminderTemplates,
  renderTemplate,
  type ReminderContext,
} from '../config/templates.js';

// ===========================================
// Mention Handler - Handles @CA Pro Calls mentions
// ===========================================

// Rebecca's user ID - will be tagged after reminders are generated
const REBECCA_USER_ID = env.SLACK_REBECCA_USER_ID;

// Track processed mentions to avoid duplicates
const processedMentions: Map<string, Date> = new Map();
const DUPLICATE_WINDOW_MS = 60 * 1000; // 1 minute window

/**
 * Handle an @mention of the bot in a channel
 * When someone @mentions the bot with a topic, generate reminders in a thread
 */
export async function handleAppMention(event: {
  channel: string;
  user: string;
  text: string;
  ts: string;
  thread_ts?: string;
}): Promise<void> {
  const { channel, user, text, ts, thread_ts } = event;

  // Avoid duplicate processing
  const mentionKey = `${channel}:${ts}`;
  if (processedMentions.has(mentionKey)) {
    return;
  }

  // Clean up old entries
  const now = new Date();
  for (const [key, timestamp] of processedMentions.entries()) {
    if (now.getTime() - timestamp.getTime() > DUPLICATE_WINDOW_MS) {
      processedMentions.delete(key);
    }
  }

  processedMentions.set(mentionKey, now);

  // Remove the bot mention from the text to get the actual topic
  // Slack formats mentions as <@BOTID>
  const cleanText = text.replace(/<@[A-Z0-9]+>/g, '').trim();

  if (!cleanText) {
    // Empty mention - ask what topic they want
    await slack.postMessage(
      channel,
      "Hey! What topic would you like me to generate reminders for? Just @mention me again with the topic.",
      undefined,
      undefined,
      ts
    );
    return;
  }

  console.log(`[Mention Handler] Processing mention: "${cleanText.substring(0, 80)}..."`);

  // Parse the message for topic, presenter, and extra context
  // Format: "Topic Name" or "Topic Name - extra context" or "Topic Name - Angela is running this"
  const parsed = parseTopicMessage(cleanText);

  // Detect if this is a topic announcement
  const topicInfo = await claude.detectTopicInMessage(parsed.rawTopic, '', true);

  if (!topicInfo.isTopic || !topicInfo.topic) {
    // Not recognized as a topic - ask for clarification
    await slack.postMessage(
      channel,
      `I'm not sure I understood the topic. Could you rephrase it?\n\nFormat: "@CA Pro Calls Topic Name"\nWith context: "@CA Pro Calls Topic Name - Angela is presenting, covering her review process"`,
      undefined,
      undefined,
      ts
    );
    return;
  }

  // Determine call type based on upcoming schedule
  const callType = await determineCallType();
  const callLabel = callType === 'weekly' ? 'Weekly Training' : 'Monthly Business Owner';

  // Build confirmation message
  let confirmMsg = `📣 Got it! Generating ${callLabel} reminders for: *${topicInfo.topic}*`;
  if (parsed.presenter !== 'Stefan') {
    confirmMsg += `\n👤 Presenter: ${parsed.presenter}`;
  }
  if (parsed.extraContext) {
    confirmMsg += `\n📝 Context: ${parsed.extraContext}`;
  }
  confirmMsg += '\n\nPlease wait...';

  // Post initial response in thread
  await slack.postMessage(channel, confirmMsg, undefined, undefined, ts);

  try {
    // Fetch Zoom link
    const zoomInfo = await zoom.getJoinUrlForNextCall(callType);
    const zoomLink = zoomInfo?.joinUrl || 'https://us06web.zoom.us/j/your-meeting-id';
    const callTime = zoomInfo?.startTime
      ? formatCallTime(zoomInfo.startTime)
      : callType === 'weekly' ? '1:00 PM' : '2:00 PM';

    // Generate reminder description using Claude (with presenter and context)
    console.log(`[Mention Handler] Generating description with presenter: "${parsed.presenter}"`);
    const description = await claude.generateReminderDescription(
      topicInfo.topic,
      callType,
      parsed.presenter,
      parsed.extraContext
    );
    console.log(`[Mention Handler] Generated description: "${description}"`);

    // Build context for template rendering
    const reminderContext: ReminderContext = {
      topic: topicInfo.topic,
      description,
      presenter: parsed.presenter,
      time: callTime,
      zoomLink,
      day: zoomInfo?.startTime
        ? zoomInfo.startTime.toLocaleString('en-US', { weekday: 'long', timeZone: 'America/New_York' })
        : callType === 'weekly' ? 'Tuesday' : 'Monday',
      date: zoomInfo?.startTime
        ? zoomInfo.startTime.toLocaleString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' })
        : '',
    };

    // Generate Day Before reminder (WhatsApp) - only for weekly
    if (callType === 'weekly') {
      const dayBeforeTemplates = getReminderTemplates(callType, 'dayBefore');
      if (dayBeforeTemplates.whatsapp) {
        const dayBeforeMessage = renderTemplate(dayBeforeTemplates.whatsapp, reminderContext);

        // Store and post Day Before WhatsApp
        const dayBeforePendingId = storePending({
          type: 'reminder',
          channel: 'whatsapp',
          callType,
          timing: 'dayBefore',
          message: dayBeforeMessage,
          metadata: {
            topic: topicInfo.topic,
            description,
            zoomLink,
            callTime,
          },
          slackMessageTs: ts,
          slackChannel: channel,
        });

        await postWhatsAppReminder(
          channel,
          ts,
          '📅 DAY BEFORE Reminder (WhatsApp)',
          dayBeforeMessage,
          dayBeforePendingId
        );
      }

      // Generate Day Before reminder (Email) - only for weekly
      if (dayBeforeTemplates.email) {
        const dayBeforeEmailMessage = renderTemplate(dayBeforeTemplates.email, reminderContext);

        const dayBeforeEmailPendingId = storePending({
          type: 'reminder',
          channel: 'email',
          callType,
          timing: 'dayBefore',
          message: dayBeforeEmailMessage,
          metadata: {
            topic: topicInfo.topic,
            description,
            zoomLink,
            callTime,
            subject: dayBeforeTemplates.email.subject,
          },
          slackMessageTs: ts,
          slackChannel: channel,
        });

        await postEmailReminder(
          channel,
          ts,
          '📧 DAY BEFORE Reminder (Email)',
          dayBeforeEmailMessage,
          dayBeforeEmailPendingId
        );
      }
    }

    // Generate Week Before reminder - only for monthly
    if (callType === 'monthly') {
      const weekBeforeTemplates = getReminderTemplates(callType, 'weekBefore');

      if (weekBeforeTemplates.whatsapp) {
        const weekBeforeMessage = renderTemplate(weekBeforeTemplates.whatsapp, reminderContext);

        const weekBeforePendingId = storePending({
          type: 'reminder',
          channel: 'whatsapp',
          callType,
          timing: 'weekBefore',
          message: weekBeforeMessage,
          metadata: {
            topic: topicInfo.topic,
            description,
            zoomLink,
            callTime,
          },
          slackMessageTs: ts,
          slackChannel: channel,
        });

        await postWhatsAppReminder(
          channel,
          ts,
          '📅 WEEK BEFORE Reminder (WhatsApp)',
          weekBeforeMessage,
          weekBeforePendingId
        );
      }

      if (weekBeforeTemplates.email) {
        const weekBeforeEmailMessage = renderTemplate(weekBeforeTemplates.email, reminderContext);

        const weekBeforeEmailPendingId = storePending({
          type: 'reminder',
          channel: 'email',
          callType,
          timing: 'weekBefore',
          message: weekBeforeEmailMessage,
          metadata: {
            topic: topicInfo.topic,
            description,
            zoomLink,
            callTime,
            subject: weekBeforeTemplates.email.subject,
          },
          slackMessageTs: ts,
          slackChannel: channel,
        });

        await postEmailReminder(
          channel,
          ts,
          '📧 WEEK BEFORE Reminder (Email)',
          weekBeforeEmailMessage,
          weekBeforeEmailPendingId
        );
      }
    }

    // Get Day Of templates
    const dayOfTemplates = getReminderTemplates(callType, 'dayOf');

    // Generate Day Of reminder (WhatsApp)
    if (dayOfTemplates.whatsapp) {
      const dayOfWhatsAppMessage = renderTemplate(dayOfTemplates.whatsapp, reminderContext);

      const dayOfWhatsAppPendingId = storePending({
        type: 'reminder',
        channel: 'whatsapp',
        callType,
        timing: 'dayOf',
        message: dayOfWhatsAppMessage,
        metadata: {
          topic: topicInfo.topic,
          description,
          zoomLink,
          callTime,
        },
        slackMessageTs: ts,
        slackChannel: channel,
      });

      await postWhatsAppReminder(
        channel,
        ts,
        '📅 DAY OF Reminder (WhatsApp)',
        dayOfWhatsAppMessage,
        dayOfWhatsAppPendingId
      );
    }

    // Generate Day Of reminder (Email)
    if (dayOfTemplates.email) {
      const dayOfEmailMessage = renderTemplate(dayOfTemplates.email, reminderContext);

      const dayOfEmailPendingId = storePending({
        type: 'reminder',
        channel: 'email',
        callType,
        timing: 'dayOf',
        message: dayOfEmailMessage,
        metadata: {
          topic: topicInfo.topic,
          description,
          zoomLink,
          callTime,
          subject: dayOfTemplates.email.subject,
        },
        slackMessageTs: ts,
        slackChannel: channel,
      });

      await postEmailReminder(
        channel,
        ts,
        '📧 DAY OF Reminder (Email)',
        dayOfEmailMessage,
        dayOfEmailPendingId
      );
    }

    // Tag Rebecca if configured
    if (REBECCA_USER_ID) {
      await slack.postMessage(
        channel,
        `<@${REBECCA_USER_ID}> Reminders are ready above! ☝️`,
        undefined,
        undefined,
        ts
      );
    }

    console.log(`[Mention Handler] Generated reminders for: "${topicInfo.topic}"`);
  } catch (error) {
    console.error('[Mention Handler] Error generating reminders:', error);
    await slack.postMessage(
      channel,
      `⚠️ Sorry, I had trouble generating the reminders. Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      undefined,
      undefined,
      ts
    );
  }
}

/**
 * Parse a topic message for topic, presenter, and extra context
 * Examples:
 *   "Copy Chief Checklist" → { rawTopic: "Copy Chief Checklist", presenter: "Stefan", extraContext: undefined }
 *   "Copy Chief Checklist - Angela is presenting" → { rawTopic: "Copy Chief Checklist", presenter: "Angela", extraContext: "Angela is presenting" }
 *   "VSL Breakdown - with guest John Carlton" → { rawTopic: "VSL Breakdown", presenter: "Stefan", extraContext: "with guest John Carlton" }
 */
function parseTopicMessage(text: string): {
  rawTopic: string;
  presenter: string;
  extraContext?: string;
} {
  // Default presenter is Stefan
  let presenter = 'Stefan';
  let extraContext: string | undefined;
  let rawTopic = text;

  // Check if there's a dash or hyphen separating topic from context
  const dashMatch = text.match(/^(.+?)\s*[-–—]\s*(.+)$/);
  if (dashMatch) {
    rawTopic = dashMatch[1].trim();
    extraContext = dashMatch[2].trim();

    // Try to detect if someone else is presenting
    // Look for patterns like "Angela is presenting", "with Angela", "Kevin is running this", etc.
    console.log(`[Mention Handler] Parsing extraContext: "${extraContext}"`);

    const presenterPatterns = [
      /^(\w+)\s+is\s+(?:presenting|running|hosting|leading|doing|covering)/i,
      /^(\w+)\s+(?:presenting|running|hosting|leading|doing|covering)/i,
      /^(?:with|featuring|by)\s+(\w+)/i,
      /^(\w+)\s+(?:will\s+)?(?:cover|present|run|host|lead|do)/i,
      /^(\w+)\s+is\s+/i, // Catch "Kevin is running this" style - simpler pattern
    ];

    for (let i = 0; i < presenterPatterns.length; i++) {
      const pattern = presenterPatterns[i];
      const match = extraContext.match(pattern);
      console.log(`[Mention Handler] Pattern ${i}: ${pattern} -> match: ${JSON.stringify(match)}`);
      if (match && match[1]) {
        // Check if it's a name (capitalized, not a common word)
        const possibleName = match[1];
        const commonWords = ['this', 'that', 'the', 'she', 'he', 'they', 'it', 'we', 'her', 'his', 'i', 'a', 'an'];
        if (!commonWords.includes(possibleName.toLowerCase()) && /^[A-Z]/.test(possibleName)) {
          presenter = possibleName;
          console.log(`[Mention Handler] Detected presenter: ${presenter}`);
          break;
        }
      }
    }
  }

  return { rawTopic, presenter, extraContext };
}

/**
 * Determine if this is for a weekly or monthly call based on Zoom schedule
 */
async function determineCallType(): Promise<'weekly' | 'monthly'> {
  try {
    const weeklyCall = await zoom.getJoinUrlForNextCall('weekly');
    const monthlyCall = await zoom.getJoinUrlForNextCall('monthly');

    if (!weeklyCall && monthlyCall) {
      return 'monthly';
    }

    if (weeklyCall && monthlyCall) {
      if (monthlyCall.startTime < weeklyCall.startTime) {
        return 'monthly';
      }
    }

    return 'weekly';
  } catch (error) {
    console.error('[Mention Handler] Error determining call type:', error);
    return 'weekly';
  }
}

/**
 * Format call time for display (just the time, e.g., "1:00 PM")
 */
function formatCallTime(date: Date): string {
  return date.toLocaleString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/New_York',
  });
}

/**
 * Post a WhatsApp reminder with Copy button
 */
async function postWhatsAppReminder(
  channel: string,
  threadTs: string,
  header: string,
  message: string,
  pendingId: string
): Promise<void> {
  const baseUrl = env.RAILWAY_PUBLIC_DOMAIN
    ? `https://${env.RAILWAY_PUBLIC_DOMAIN}`
    : 'https://autoweeklymonthlycalls-production.up.railway.app';
  const copyUrl = `${baseUrl}/copy.html?text=${encodeURIComponent(message)}`;

  const blocks = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: header,
        emoji: true,
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '```' + message + '```',
      },
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: {
            type: 'plain_text',
            text: '📋 Copy',
            emoji: true,
          },
          url: copyUrl,
          action_id: `copy_whatsapp_${pendingId}`,
        },
        {
          type: 'button',
          text: {
            type: 'plain_text',
            text: '✏️ Set Message',
            emoji: true,
          },
          action_id: 'set_message',
          value: pendingId,
        },
      ],
    },
  ];

  await slack.postMessage(channel, message, blocks, undefined, threadTs);
}

/**
 * Post an Email reminder with Approve button
 */
async function postEmailReminder(
  channel: string,
  threadTs: string,
  header: string,
  message: string,
  pendingId: string
): Promise<void> {
  const blocks = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: header,
        emoji: true,
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '```' + message + '```',
      },
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: {
            type: 'plain_text',
            text: '✅ Approve to Send',
            emoji: true,
          },
          style: 'primary',
          action_id: 'approve_email',
          value: pendingId,
        },
        {
          type: 'button',
          text: {
            type: 'plain_text',
            text: '✏️ Set Message',
            emoji: true,
          },
          action_id: 'set_message',
          value: pendingId,
        },
      ],
    },
  ];

  await slack.postMessage(channel, message, blocks, undefined, threadTs);
}

/**
 * Check if mention handling is properly configured
 */
export function isMentionHandlerConfigured(): boolean {
  return !!env.SLACK_BOT_TOKEN;
}
