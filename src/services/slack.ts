import axios from 'axios';
import crypto from 'crypto';
import { env } from '../config/env.js';
import type { CallType, SlackPendingMetadata } from '../types/index.js';
import type { MessageChannel, MessageType, ReminderTiming } from '../config/templates.js';

const SLACK_API_BASE = 'https://slack.com/api';

const slackClient = axios.create({
  baseURL: SLACK_API_BASE,
  headers: {
    Authorization: `Bearer ${env.SLACK_BOT_TOKEN}`,
    'Content-Type': 'application/json',
  },
});

// ===========================================
// Types
// ===========================================

export interface SlackUser {
  id: string;
  name: string;
  real_name: string;
  is_bot: boolean;
}

export interface SlackMessage {
  channel: string;
  ts: string;
  text?: string;
}

export interface SlackMessageMetadata {
  event_type: string;
  event_payload: Record<string, unknown>;
}

// ===========================================
// Signature Verification
// ===========================================

/**
 * Verify Slack request signature
 */
export function verifySlackSignature(
  signature: string,
  timestamp: string,
  body: string
): boolean {
  if (!env.SLACK_SIGNING_SECRET) {
    console.warn('SLACK_SIGNING_SECRET not configured');
    return false;
  }

  const sigBasestring = `v0:${timestamp}:${body}`;
  const mySignature = 'v0=' + crypto
    .createHmac('sha256', env.SLACK_SIGNING_SECRET)
    .update(sigBasestring)
    .digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(mySignature),
    Buffer.from(signature)
  );
}

// ===========================================
// Core API Methods
// ===========================================

/**
 * Open a DM channel with a user
 */
export async function openDmChannel(userId: string): Promise<string> {
  const response = await slackClient.post('/conversations.open', {
    users: userId,
  });

  if (!response.data.ok) {
    throw new Error(`Failed to open DM: ${response.data.error}`);
  }

  return response.data.channel.id;
}

/**
 * Post a message to a channel or DM
 */
export async function postMessage(
  channel: string,
  text: string,
  blocks?: unknown[],
  metadata?: SlackMessageMetadata,
  threadTs?: string
): Promise<SlackMessage> {
  const payload: Record<string, unknown> = {
    channel,
    text,
  };

  if (blocks) {
    payload.blocks = blocks;
  }

  if (metadata) {
    payload.metadata = metadata;
  }

  if (threadTs) {
    payload.thread_ts = threadTs;
  }

  const response = await slackClient.post('/chat.postMessage', payload);

  if (!response.data.ok) {
    throw new Error(`Failed to post message: ${response.data.error}`);
  }

  return {
    channel: response.data.channel,
    ts: response.data.ts,
    text: response.data.message?.text,
  };
}

/**
 * Get thread replies
 */
export async function getThreadReplies(
  channel: string,
  threadTs: string
): Promise<Array<{ ts: string; text: string; user: string }>> {
  const response = await slackClient.get('/conversations.replies', {
    params: {
      channel,
      ts: threadTs,
    },
  });

  if (!response.data.ok) {
    throw new Error(`Failed to get thread: ${response.data.error}`);
  }

  return response.data.messages || [];
}

/**
 * Get a specific message (to retrieve metadata)
 */
export async function getMessage(
  channel: string,
  messageTs: string
): Promise<Record<string, unknown> | null> {
  const response = await slackClient.get('/conversations.history', {
    params: {
      channel,
      latest: messageTs,
      inclusive: true,
      limit: 1,
    },
  });

  if (!response.data.ok) {
    throw new Error(`Failed to get message: ${response.data.error}`);
  }

  return response.data.messages?.[0] || null;
}

/**
 * List Slack users
 */
export async function listUsers(): Promise<SlackUser[]> {
  const response = await slackClient.get('/users.list');

  if (!response.data.ok) {
    throw new Error(`Failed to list users: ${response.data.error}`);
  }

  return response.data.members
    .filter((m: SlackUser & { deleted?: boolean }) => !m.is_bot && !m.deleted)
    .map((m: SlackUser & { profile?: { real_name?: string } }) => ({
      id: m.id,
      name: m.name,
      real_name: m.profile?.real_name || m.name,
    }));
}

// ===========================================
// Message Builders
// ===========================================

/**
 * Build reminder message blocks for Slack
 */
export function buildReminderBlocks(
  callType: CallType,
  callDate: Date,
  callTopic?: string
): unknown[] {
  const typeLabel = callType === 'weekly' ? 'Weekly' : 'Monthly';
  const dateStr = callDate.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/New_York',
  });

  const blocks = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: `📅 CA Pro ${typeLabel} Training Reminder`,
        emoji: true,
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*When:* ${dateStr} ET${callTopic ? `\n*Topic:* ${callTopic}` : ''}`,
      },
    },
    {
      type: 'divider',
    },
  ];

  return blocks;
}

/**
 * Build recap message blocks with copy button
 */
export function buildRecapBlocks(
  callType: CallType,
  callDate: Date,
  topic: string,
  description: string,
  keyTakeaways: string[],
  circleUrl: string,
  youtubeUrl: string
): unknown[] {
  const typeLabel = callType === 'weekly' ? 'Weekly' : 'Monthly';
  const dateStr = callDate.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  // Build WhatsApp-friendly message for copy button
  const whatsappMessage = `🎬 New CA Pro ${typeLabel} Training Available!\n\n📚 ${topic}\n\n${description}\n\n🔗 Watch now: ${circleUrl}`;
  const encodedMessage = encodeURIComponent(whatsappMessage);
  const baseUrl = env.RAILWAY_PUBLIC_DOMAIN
    ? `https://${env.RAILWAY_PUBLIC_DOMAIN}`
    : 'https://autoweeklymonthlycalls-production.up.railway.app';
  const copyUrl = `${baseUrl}/copy.html?text=${encodedMessage}`;

  const blocks = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: `🎬 ${dateStr} - CA Pro ${typeLabel} Training Recap`,
        emoji: true,
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Topic:* ${topic}`,
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: description,
      },
    },
    {
      type: 'divider',
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*Key Takeaways:*\n' + keyTakeaways.slice(0, 5).map(t => `• ${t}`).join('\n'),
      },
    },
    {
      type: 'divider',
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `<${circleUrl}|View on Circle> • <${youtubeUrl}|Watch on YouTube>`,
      },
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: {
            type: 'plain_text',
            text: '📋 Copy for WhatsApp',
            emoji: true,
          },
          url: copyUrl,
          action_id: 'copy_whatsapp',
        },
        {
          type: 'button',
          text: {
            type: 'plain_text',
            text: '✏️ Edit Message',
            emoji: true,
          },
          action_id: 'edit_message',
        },
      ],
    },
  ];

  return blocks;
}

// ===========================================
// High-Level Functions
// ===========================================

/**
 * Send reminder to a specific user
 */
export async function sendReminderToUser(
  userId: string,
  callType: CallType,
  callDate: Date,
  callTopic?: string
): Promise<SlackMessage> {
  const channel = await openDmChannel(userId);
  const blocks = buildReminderBlocks(callType, callDate, callTopic);
  const text = `Reminder: CA Pro ${callType === 'weekly' ? 'Weekly' : 'Monthly'} Training`;

  return postMessage(channel, text, blocks);
}

/**
 * Send recap to the welcome user (for forwarding to WhatsApp)
 */
export async function sendRecapToAdmin(
  callType: CallType,
  callDate: Date,
  topic: string,
  description: string,
  keyTakeaways: string[],
  circleUrl: string,
  youtubeUrl: string
): Promise<SlackMessage | null> {
  if (!env.SLACK_WELCOME_USER_ID) {
    console.warn('SLACK_WELCOME_USER_ID not configured');
    return null;
  }

  const channel = await openDmChannel(env.SLACK_WELCOME_USER_ID);
  const blocks = buildRecapBlocks(
    callType,
    callDate,
    topic,
    description,
    keyTakeaways,
    circleUrl,
    youtubeUrl
  );

  // Store metadata for edit functionality
  const metadata: SlackMessageMetadata = {
    event_type: 'call_recap',
    event_payload: {
      callType,
      topic,
      description,
      keyTakeaways,
      circleUrl,
      youtubeUrl,
    },
  };

  const text = `New CA Pro ${callType === 'weekly' ? 'Weekly' : 'Monthly'} Training Recap: ${topic}`;

  return postMessage(channel, text, blocks, metadata);
}

/**
 * Check if Slack is configured
 */
export function isSlackConfigured(): boolean {
  return !!(env.SLACK_BOT_TOKEN && env.SLACK_SIGNING_SECRET);
}

/**
 * Test Slack connection
 */
export async function checkSlackConnection(): Promise<boolean> {
  try {
    const response = await slackClient.get('/auth.test');
    return response.data.ok;
  } catch (error) {
    console.error('Slack connection check failed:', error);
    return false;
  }
}

// ===========================================
// Modal Functions
// ===========================================

/**
 * Open a generic modal
 */
export async function openModal(
  triggerId: string,
  view: Record<string, unknown>
): Promise<boolean> {
  try {
    const response = await slackClient.post('/views.open', {
      trigger_id: triggerId,
      view,
    });

    if (!response.data.ok) {
      console.error('Failed to open modal:', response.data.error);
      return false;
    }

    return true;
  } catch (error) {
    console.error('Error opening modal:', error);
    return false;
  }
}

/**
 * Open a modal for custom message input (Set Message)
 */
export async function openSetMessageModal(
  triggerId: string,
  pendingId: string,
  currentMessage: string,
  metadata: SlackPendingMetadata
): Promise<boolean> {
  const view = buildSetMessageModal(pendingId, currentMessage, metadata);

  try {
    const response = await slackClient.post('/views.open', {
      trigger_id: triggerId,
      view,
    });

    if (!response.data.ok) {
      console.error('Failed to open modal:', response.data.error);
      return false;
    }

    return true;
  } catch (error) {
    console.error('Error opening modal:', error);
    return false;
  }
}

/**
 * Build the Set Message modal view
 */
export function buildSetMessageModal(
  pendingId: string,
  currentMessage: string,
  metadata: SlackPendingMetadata
): Record<string, unknown> {
  const channelLabel = metadata.channel === 'whatsapp' ? 'WhatsApp' :
                       metadata.channel === 'email' ? 'Email' : 'Circle';
  const typeLabel = metadata.messageType === 'reminder' ? 'Reminder' : 'Recap';

  return {
    type: 'modal',
    callback_id: 'set_message_modal',
    private_metadata: JSON.stringify(metadata),
    title: {
      type: 'plain_text',
      text: `Edit ${channelLabel} Message`,
      emoji: true,
    },
    submit: {
      type: 'plain_text',
      text: 'Preview',
      emoji: true,
    },
    close: {
      type: 'plain_text',
      text: 'Cancel',
      emoji: true,
    },
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${typeLabel} - ${channelLabel}*\nEdit the message below. Formatting and line breaks will be preserved.`,
        },
      },
      {
        type: 'divider',
      },
      {
        type: 'input',
        block_id: 'message_input_block',
        label: {
          type: 'plain_text',
          text: 'Message Content',
          emoji: true,
        },
        element: {
          type: 'plain_text_input',
          action_id: 'message_input',
          multiline: true,
          initial_value: currentMessage,
          placeholder: {
            type: 'plain_text',
            text: 'Enter your custom message here...',
          },
        },
      },
    ],
  };
}

/**
 * Update a message in place
 */
export async function updateMessage(
  channel: string,
  messageTs: string,
  text: string,
  blocks?: unknown[]
): Promise<boolean> {
  try {
    const payload: Record<string, unknown> = {
      channel,
      ts: messageTs,
      text,
    };

    if (blocks) {
      payload.blocks = blocks;
    }

    const response = await slackClient.post('/chat.update', payload);
    return response.data.ok;
  } catch (error) {
    console.error('Error updating message:', error);
    return false;
  }
}

// ===========================================
// New Block Builders for Bot Flow
// ===========================================

/**
 * Build "Weekly or Monthly?" selection buttons
 */
export function buildCallTypeSelectionBlocks(topic: string): unknown[] {
  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `Got it! I'll create reminders for: *${topic}*\n\nIs this for a Weekly or Monthly call?`,
      },
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: {
            type: 'plain_text',
            text: 'Weekly',
            emoji: true,
          },
          style: 'primary',
          action_id: 'select_weekly',
          value: topic,
        },
        {
          type: 'button',
          text: {
            type: 'plain_text',
            text: 'Monthly',
            emoji: true,
          },
          action_id: 'select_monthly',
          value: topic,
        },
        {
          type: 'button',
          text: {
            type: 'plain_text',
            text: 'Cancel',
            emoji: true,
          },
          action_id: 'cancel_reminder',
        },
      ],
    },
  ];
}

/**
 * Build WhatsApp reminder blocks with Copy and Set Message buttons
 */
export function buildWhatsAppReminderBlocks(
  message: string,
  pendingId: string,
  timing: ReminderTiming,
  callType: CallType
): unknown[] {
  const timingLabel = timing === 'dayBefore' ? 'Day Before' : 'Day Of';
  const encodedMessage = encodeURIComponent(message);
  const baseUrl = env.RAILWAY_PUBLIC_DOMAIN
    ? `https://${env.RAILWAY_PUBLIC_DOMAIN}`
    : 'https://autoweeklymonthlycalls-production.up.railway.app';
  const copyUrl = `${baseUrl}/copy.html?text=${encodedMessage}`;

  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*WhatsApp (${timingLabel})*`,
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
}

/**
 * Build Email reminder blocks with Approve and Set Message buttons
 */
export function buildEmailReminderBlocks(
  message: string,
  pendingId: string,
  timing: ReminderTiming,
  callType: CallType
): unknown[] {
  const timingLabel = timing === 'dayBefore' ? 'Day Before' : 'Day Of';

  // Truncate for code block display if needed
  const displayMessage = message.length > 2800 ? message.substring(0, 2800) + '...' : message;

  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Email (${timingLabel})*`,
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '```' + displayMessage + '```',
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
}

/**
 * Build WhatsApp recap blocks with Copy and Set Message buttons
 */
export function buildWhatsAppRecapBlocks(
  message: string,
  pendingId: string
): unknown[] {
  const encodedMessage = encodeURIComponent(message);
  const baseUrl = env.RAILWAY_PUBLIC_DOMAIN
    ? `https://${env.RAILWAY_PUBLIC_DOMAIN}`
    : 'https://autoweeklymonthlycalls-production.up.railway.app';
  const copyUrl = `${baseUrl}/copy.html?text=${encodedMessage}`;

  // Truncate for code block display if needed
  const displayMessage = message.length > 2800 ? message.substring(0, 2800) + '...' : message;

  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*WhatsApp Recap*',
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '```' + displayMessage + '```',
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
          action_id: `copy_whatsapp_recap_${pendingId}`,
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
}

/**
 * Build Email recap blocks with Approve and Set Message buttons
 */
export function buildEmailRecapBlocks(
  message: string,
  pendingId: string
): unknown[] {
  // Truncate for code block display if needed
  const displayMessage = message.length > 2800 ? message.substring(0, 2800) + '...' : message;

  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*Email Recap*',
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '```' + displayMessage + '```',
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
}

/**
 * Build Circle recap blocks with Approve and Set Message buttons
 */
export function buildCircleRecapBlocks(
  message: string,
  pendingId: string,
  topic: string
): unknown[] {
  // Truncate for code block display if needed (Slack block text limit is 3000 chars)
  const displayMessage = message.length > 2800 ? message.substring(0, 2800) + '...' : message;

  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Circle Post: ${topic}*`,
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '```' + displayMessage + '```',
      },
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: {
            type: 'plain_text',
            text: '✅ Approve to Post',
            emoji: true,
          },
          style: 'primary',
          action_id: 'approve_circle',
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
}

/**
 * Build a "Copied!" confirmation block (to replace original after copy)
 */
export function buildCopiedConfirmationBlocks(
  originalMessage: string,
  channel: 'whatsapp'
): unknown[] {
  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*WhatsApp Message*\n📋 _Copied!_`,
      },
    },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: originalMessage.length > 500 ? originalMessage.substring(0, 500) + '...' : originalMessage,
        },
      ],
    },
  ];
}

/**
 * Build an "Approved/Sent" confirmation block
 */
export function buildApprovedConfirmationBlocks(
  channel: 'email' | 'circle',
  originalMessage: string
): unknown[] {
  const channelLabel = channel === 'email' ? 'Email' : 'Circle Post';
  const statusEmoji = '✅';
  const statusText = channel === 'email' ? 'Sent!' : 'Posted!';

  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${channelLabel}*\n${statusEmoji} _${statusText}_`,
      },
    },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: originalMessage.length > 500 ? originalMessage.substring(0, 500) + '...' : originalMessage,
        },
      ],
    },
  ];
}

/**
 * Build reminder thread header blocks
 */
export function buildReminderThreadHeader(timing: ReminderTiming): unknown[] {
  const emoji = timing === 'dayBefore' ? '📅' : '🔔';
  const label = timing === 'dayBefore' ? 'DAY BEFORE' : 'DAY OF';

  return [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: `${emoji} ${label} Reminders`,
        emoji: true,
      },
    },
    {
      type: 'divider',
    },
  ];
}
