import * as slack from '../services/slack.js';
import * as zoom from '../services/zoom.js';
import * as claude from '../services/claude.js';
import * as pendingStore from '../services/pending-store.js';
import { getReminderTemplates, renderTemplate, type ReminderContext } from '../config/templates.js';
import type { CallType } from '../types/index.js';
import type { ReminderTiming } from '../config/templates.js';

// ===========================================
// DM Handler for Reminder Generation
// ===========================================

/**
 * Handle an incoming DM to the bot
 * If it's a topic for reminders, ask "Weekly or Monthly?"
 */
export async function handleUserDm(event: {
  channel: string;
  user: string;
  text: string;
  ts: string;
}): Promise<void> {
  const { channel, user, text, ts } = event;

  // Ignore empty messages or bot messages
  if (!text || text.trim().length === 0) {
    return;
  }

  const topic = text.trim();

  console.log(`DM received from ${user}: "${topic}"`);

  // Post the "Weekly or Monthly?" selection
  const blocks = slack.buildCallTypeSelectionBlocks(topic);

  await slack.postMessage(
    channel,
    `Creating reminders for: ${topic}`,
    blocks
  );
}

/**
 * Handle call type selection (Weekly or Monthly button click)
 */
export async function handleCallTypeSelection(
  channel: string,
  user: string,
  topic: string,
  callType: CallType,
  triggerId: string
): Promise<void> {
  console.log(`User selected ${callType} for topic: "${topic}"`);

  try {
    // Post a "generating..." message
    const loadingMsg = await slack.postMessage(
      channel,
      `Generating ${callType} reminders for "${topic}"... ⏳`
    );

    // Fetch Zoom meeting info
    const meetingInfo = await zoom.getJoinUrlForNextCall(callType);

    if (!meetingInfo) {
      await slack.postMessage(
        channel,
        `⚠️ Could not find an upcoming ${callType} call scheduled in Zoom. Please check the Zoom calendar and try again.`
      );
      return;
    }

    // Generate the description using Claude
    const description = await claude.generateReminderDescription(topic, callType);

    // Format the date/time
    const callDate = meetingInfo.startTime;
    const dayName = callDate.toLocaleDateString('en-US', {
      weekday: 'long',
      timeZone: 'America/New_York',
    });
    const dateStr = callDate.toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'America/New_York',
    });
    const timeStr = callDate.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: 'America/New_York',
    }).replace(':00', ''); // "1 PM" instead of "1:00 PM"

    const reminderContext: ReminderContext = {
      topic,
      description,
      day: dayName,
      date: dateStr,
      time: timeStr,
      zoomLink: meetingInfo.joinUrl,
    };

    // Get templates for this call type
    const dayBeforeTemplates = getReminderTemplates(callType, 'dayBefore');
    const dayOfTemplates = getReminderTemplates(callType, 'dayOf');

    // Generate messages for each timing
    const messages: {
      timing: ReminderTiming;
      whatsapp: string | null;
      email: string | null;
    }[] = [];

    // Day Before (only for weekly)
    if (dayBeforeTemplates.whatsapp || dayBeforeTemplates.email) {
      messages.push({
        timing: 'dayBefore',
        whatsapp: dayBeforeTemplates.whatsapp
          ? renderTemplate(dayBeforeTemplates.whatsapp, reminderContext)
          : null,
        email: dayBeforeTemplates.email
          ? renderTemplate(dayBeforeTemplates.email, reminderContext)
          : null,
      });
    }

    // Day Of
    if (dayOfTemplates.whatsapp || dayOfTemplates.email) {
      messages.push({
        timing: 'dayOf',
        whatsapp: dayOfTemplates.whatsapp
          ? renderTemplate(dayOfTemplates.whatsapp, reminderContext)
          : null,
        email: dayOfTemplates.email
          ? renderTemplate(dayOfTemplates.email, reminderContext)
          : null,
      });
    }

    // Post each timing as a separate thread
    for (const msg of messages) {
      // Post thread header
      const headerBlocks = slack.buildReminderThreadHeader(msg.timing);
      const threadParent = await slack.postMessage(
        channel,
        `${msg.timing === 'dayBefore' ? '📅 DAY BEFORE' : '🔔 DAY OF'} Reminders`,
        headerBlocks
      );

      // Post WhatsApp message in thread
      if (msg.whatsapp) {
        const whatsappPendingId = pendingStore.storePending({
          type: 'reminder',
          channel: 'whatsapp',
          callType,
          timing: msg.timing,
          message: msg.whatsapp,
          metadata: { topic, zoomLink: meetingInfo.joinUrl },
          slackMessageTs: threadParent.ts,
          slackChannel: channel,
        });

        const whatsappBlocks = slack.buildWhatsAppReminderBlocks(
          msg.whatsapp,
          whatsappPendingId,
          msg.timing,
          callType
        );

        await slack.postMessage(
          channel,
          'WhatsApp reminder',
          whatsappBlocks,
          undefined,
          threadParent.ts
        );
      }

      // Post Email message in thread
      if (msg.email) {
        const emailPendingId = pendingStore.storePending({
          type: 'reminder',
          channel: 'email',
          callType,
          timing: msg.timing,
          message: msg.email,
          metadata: { topic, zoomLink: meetingInfo.joinUrl },
          slackMessageTs: threadParent.ts,
          slackChannel: channel,
        });

        const emailBlocks = slack.buildEmailReminderBlocks(
          msg.email,
          emailPendingId,
          msg.timing,
          callType
        );

        await slack.postMessage(
          channel,
          'Email reminder',
          emailBlocks,
          undefined,
          threadParent.ts
        );
      }
    }

    // Update the loading message to show completion
    await slack.updateMessage(
      channel,
      loadingMsg.ts,
      `✅ Generated ${callType} reminders for "${topic}"\n\nCall scheduled: ${dayName}, ${dateStr} @ ${timeStr} EST\n\nReview the messages below. You can Copy, Approve, or Set a custom message for each.`
    );
  } catch (error) {
    console.error('Error generating reminders:', error);
    await slack.postMessage(
      channel,
      `❌ Error generating reminders: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Handle cancel button click
 */
export async function handleCancelReminder(
  channel: string,
  messageTs: string
): Promise<void> {
  await slack.updateMessage(
    channel,
    messageTs,
    '🚫 Reminder generation cancelled.'
  );
}
