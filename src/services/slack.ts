import axios from 'axios';
import crypto from 'crypto';
import { env } from '../config/env.js';
import type { CallType } from '../types/index.js';

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
