import twilio from 'twilio';
import { env } from '../config/env.js';
import { config } from '../config/env.js';
import type { WhatsAppMessageData, WhatsAppSendResult } from '../types/index.js';

const client = twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);

/**
 * Send a WhatsApp message to a single number
 */
export async function sendWhatsAppMessage(
  data: WhatsAppMessageData
): Promise<WhatsAppSendResult> {
  try {
    // Ensure the number is in WhatsApp format
    const toNumber = data.to.startsWith('whatsapp:')
      ? data.to
      : `whatsapp:${data.to}`;

    const message = await client.messages.create({
      from: env.TWILIO_WHATSAPP_NUMBER,
      to: toNumber,
      body: data.message,
    });

    return {
      success: true,
      messageSid: message.sid,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('WhatsApp send failed:', errorMessage);
    return {
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * Send WhatsApp message to all group members
 */
export async function sendToGroup(message: string): Promise<WhatsAppSendResult[]> {
  const results: WhatsAppSendResult[] = [];

  for (const number of config.whatsappNumbers) {
    const result = await sendWhatsAppMessage({
      to: number,
      message,
    });
    results.push(result);

    // Small delay between messages to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  return results;
}

/**
 * Send reminder to WhatsApp group
 */
export async function sendReminder(
  callType: 'weekly' | 'monthly',
  reminderType: 'dayBefore' | 'hourBefore' | 'weekBefore' | 'dayOf'
): Promise<WhatsAppSendResult[]> {
  const templates = {
    weekly: {
      dayBefore: `📅 Reminder: CA Pro Weekly Training is tomorrow (Tuesday) at 1 PM ET!\n\nSee you on Zoom!`,
      hourBefore: `⏰ Starting in 1 hour!\n\nCA Pro Weekly Training at 1 PM ET.\n\nJoin us on Zoom!`,
      weekBefore: '', // Not used for weekly
      dayOf: '', // Use hourBefore instead
    },
    monthly: {
      weekBefore: `📅 Save the date!\n\nCA Pro Monthly Training is next Monday at 2 PM ET.\n\nMark your calendar!`,
      dayBefore: `📅 Reminder: CA Pro Monthly Training is tomorrow (Monday) at 2 PM ET!\n\nSee you on Zoom!`,
      dayOf: `🎯 Today!\n\nCA Pro Monthly Training at 2 PM ET.\n\nJoin us on Zoom!`,
      hourBefore: '', // Not used for monthly
    },
  };

  const message = templates[callType][reminderType];
  if (!message) {
    return [];
  }

  return sendToGroup(message);
}

/**
 * Send notification about new recording
 */
export async function sendRecordingNotification(
  callType: 'weekly' | 'monthly',
  topic: string,
  circleUrl: string
): Promise<WhatsAppSendResult[]> {
  const typeLabel = callType === 'weekly' ? 'Weekly' : 'Monthly';

  const message = `🎬 New CA Pro ${typeLabel} Training Available!\n\n📚 ${topic}\n\n🔗 Watch now: ${circleUrl}`;

  return sendToGroup(message);
}

/**
 * Check if Twilio is properly configured
 */
export async function checkTwilioConnection(): Promise<boolean> {
  try {
    await client.api.accounts(env.TWILIO_ACCOUNT_SID).fetch();
    return true;
  } catch (error) {
    console.error('Twilio connection check failed:', error);
    return false;
  }
}

/**
 * Get message status
 */
export async function getMessageStatus(messageSid: string) {
  const message = await client.messages(messageSid).fetch();
  return {
    status: message.status,
    errorCode: message.errorCode,
    errorMessage: message.errorMessage,
  };
}
