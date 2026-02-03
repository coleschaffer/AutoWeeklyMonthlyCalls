import * as slack from '../services/slack.js';
import * as claude from '../services/claude.js';
import * as zoom from '../services/zoom.js';
import { env } from '../config/env.js';

// ===========================================
// Topic Watcher - Monitors #ca-pro channel
// ===========================================

// Channel to watch
const CA_PRO_CHANNEL_ID = env.SLACK_CA_PRO_CHANNEL_ID;

// Track recently processed topics to avoid duplicates (in-memory, resets on restart)
const processedTopics: Map<string, { topic: string; timestamp: Date }> = new Map();
const DUPLICATE_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours

// Track when someone asked about the topic (context awareness)
interface TopicRequestContext {
  askedBy: string;
  askedAt: Date;
  message: string;
}
let pendingTopicRequest: TopicRequestContext | null = null;
const TOPIC_REQUEST_WINDOW_MS = 4 * 60 * 60 * 1000; // 4 hours - topic usually comes within this window

// Recent messages buffer for context (last 12 messages)
const recentMessages: Array<{ user: string; text: string; ts: string }> = [];
const MAX_RECENT_MESSAGES = 12;

// ===========================================
// Message Processing
// ===========================================

/**
 * Handle a message from the #ca-pro channel
 * Tracks context (topic requests) and looks for topic announcements
 * Also handles thread replies (e.g., Stefan replies in thread to "what's the topic?")
 */
export async function handleChannelMessage(event: {
  channel: string;
  user: string;
  text: string;
  ts: string;
  thread_ts?: string;
}): Promise<void> {
  const { channel, user, text, ts, thread_ts } = event;

  // Only process messages from the CA Pro channel
  if (channel !== CA_PRO_CHANNEL_ID) {
    return;
  }

  // Skip if no text
  if (!text || text.trim().length === 0) {
    return;
  }

  const lowerText = text.toLowerCase();

  // Handle thread replies differently
  if (thread_ts) {
    await handleThreadReply(channel, user, text, ts, thread_ts);
    return;
  }

  // Add to recent messages buffer (only non-thread messages)
  addToRecentMessages(user, text, ts);

  // Check if this is someone asking about the topic
  if (isTopicRequest(lowerText)) {
    console.log(`[Topic Watcher] Topic request detected: "${text.substring(0, 60)}..."`);
    pendingTopicRequest = {
      askedBy: user,
      askedAt: new Date(),
      message: text,
    };
    // Also track this message's ts so we can watch for thread replies
    trackTopicRequestMessage(ts, text);
    return; // Don't analyze topic requests as potential topics
  }

  // Check if pending topic request has expired
  if (pendingTopicRequest) {
    const elapsed = Date.now() - pendingTopicRequest.askedAt.getTime();
    if (elapsed > TOPIC_REQUEST_WINDOW_MS) {
      console.log('[Topic Watcher] Topic request window expired');
      pendingTopicRequest = null;
    }
  }

  // Skip obvious non-topics (but be less strict if we're expecting a topic)
  const expectingTopic = pendingTopicRequest !== null;
  if (isObviouslyNotTopic(lowerText, expectingTopic)) {
    return;
  }

  console.log(`[Topic Watcher] Checking message: "${text.substring(0, 80)}..."${expectingTopic ? ' (expecting topic)' : ''}`);

  // Build context for Claude
  const context = buildMessageContext();

  // Check if this looks like a topic announcement
  const topicInfo = await detectTopicAnnouncement(text, context, expectingTopic);

  if (!topicInfo.isTopic) {
    console.log('[Topic Watcher] Not a topic announcement, skipping');
    return;
  }

  console.log(`[Topic Watcher] Detected topic: "${topicInfo.topic}"`);

  // Check for duplicates
  const isDuplicate = checkDuplicate(topicInfo.topic);
  if (isDuplicate) {
    console.log('[Topic Watcher] Duplicate topic detected, skipping');
    return;
  }

  // Determine call type based on timing
  const callType = await determineCallType();

  // Mark as processed and clear the pending request
  markAsProcessed(topicInfo.topic, ts);
  pendingTopicRequest = null;

  // Notify the admin
  await notifyAdminOfTopic(topicInfo.topic, topicInfo.description, callType, text, context);
}

// ===========================================
// Thread Reply Handling
// ===========================================

// Track topic request messages so we can identify thread replies to them
const topicRequestMessages: Map<string, { message: string; timestamp: Date }> = new Map();
const TOPIC_REQUEST_MESSAGE_EXPIRY_MS = 48 * 60 * 60 * 1000; // 48 hours

/**
 * Track a topic request message for thread reply detection
 */
function trackTopicRequestMessage(ts: string, message: string): void {
  // Clean up old entries
  const now = new Date();
  for (const [key, value] of topicRequestMessages.entries()) {
    if (now.getTime() - value.timestamp.getTime() > TOPIC_REQUEST_MESSAGE_EXPIRY_MS) {
      topicRequestMessages.delete(key);
    }
  }

  topicRequestMessages.set(ts, {
    message,
    timestamp: now,
  });
}

/**
 * Handle a thread reply - check if it's a reply to a topic request
 */
async function handleThreadReply(
  channel: string,
  user: string,
  text: string,
  ts: string,
  thread_ts: string
): Promise<void> {
  const lowerText = text.toLowerCase();

  // Check if this thread is a reply to a known topic request
  const parentRequest = topicRequestMessages.get(thread_ts);
  const isReplyToTopicRequest = parentRequest !== null && parentRequest !== undefined;

  // Also check if the parent message looks like a topic request (fetch if needed)
  let parentContext = '';
  if (isReplyToTopicRequest && parentRequest) {
    parentContext = `This is a thread reply to: "${parentRequest.message}"`;
    console.log(`[Topic Watcher] Thread reply to topic request: "${text.substring(0, 80)}..."`);
  } else {
    // We might not have tracked the parent - could try fetching it
    // For now, just check if the reply itself looks like a topic
    console.log(`[Topic Watcher] Thread reply in #ca-pro: "${text.substring(0, 80)}..."`);
  }

  // Skip obvious non-topics (be lenient if replying to topic request)
  if (isObviouslyNotTopic(lowerText, isReplyToTopicRequest)) {
    return;
  }

  // Build context
  const channelContext = buildMessageContext();
  const fullContext = parentContext
    ? `${parentContext}\n\n${channelContext}`
    : channelContext;

  // Analyze with Claude - high confidence if replying to topic request
  const topicInfo = await detectTopicAnnouncement(text, fullContext, isReplyToTopicRequest);

  if (!topicInfo.isTopic) {
    console.log('[Topic Watcher] Thread reply is not a topic announcement');
    return;
  }

  console.log(`[Topic Watcher] Detected topic in thread reply: "${topicInfo.topic}"`);

  // Check for duplicates
  if (checkDuplicate(topicInfo.topic)) {
    console.log('[Topic Watcher] Duplicate topic detected, skipping');
    return;
  }

  // Determine call type
  const callType = await determineCallType();

  // Mark as processed
  markAsProcessed(topicInfo.topic, ts);
  pendingTopicRequest = null;

  // Remove the parent from tracking since we got a response
  topicRequestMessages.delete(thread_ts);

  // Notify admin
  await notifyAdminOfTopic(
    topicInfo.topic,
    topicInfo.description,
    callType,
    text,
    fullContext
  );
}

/**
 * Check if a message is asking about the topic
 */
function isTopicRequest(lowerText: string): boolean {
  const topicRequestPatterns = [
    /what('s| is| will be)?.*(topic|covering|doing)/i,
    /topic for (tomorrow|today|the call|this week|next)/i,
    /whenever you have.*(topic|it)/i,
    /let me know.*(topic|what)/i,
    /what.*(call|training).*(about|on|cover)/i,
    /do you have.*(topic|idea what)/i,
    /any idea.*(topic|what)/i,
  ];

  return topicRequestPatterns.some(pattern => pattern.test(lowerText));
}

/**
 * Add message to recent buffer
 */
function addToRecentMessages(user: string, text: string, ts: string): void {
  recentMessages.push({ user, text, ts });
  if (recentMessages.length > MAX_RECENT_MESSAGES) {
    recentMessages.shift();
  }
}

/**
 * Build context string from recent messages
 */
function buildMessageContext(): string {
  if (recentMessages.length === 0) return '';

  const contextLines = recentMessages
    .map(m => `- "${m.text.substring(0, 150)}${m.text.length > 150 ? '...' : ''}"`)
    .join('\n');

  return `Recent messages in channel (oldest to newest):\n${contextLines}`;
}

/**
 * Quick filter to skip obvious non-topic messages before calling Claude
 * Less strict when we're expecting a topic response
 */
function isObviouslyNotTopic(lowerText: string, expectingTopic: boolean): boolean {
  // Very short messages (but allow shorter if expecting topic)
  const minLength = expectingTopic ? 10 : 20;
  if (lowerText.length < minLength) return true;

  // Always skip these regardless of context
  const alwaysSkipPatterns = [
    /^(thanks|thank you|thx|ty)[\s!.]*$/i,
    /^(ok|okay|k|kk|sounds good|got it|perfect)[\s!.]*$/i,
    /^(lol|lmao|haha|😂|🤣)/,
    /^(yes|no|yeah|nope|yep|nah)[\s!.]*$/i,
    /^(hi|hey|hello|good morning|gm)[\s!.,]*$/i,
    /^(brb|gtg|ttyl)/,
  ];

  for (const pattern of alwaysSkipPatterns) {
    if (pattern.test(lowerText)) return true;
  }

  // If we're expecting a topic, be more lenient - let Claude decide
  if (expectingTopic) {
    return false;
  }

  // Additional filters when NOT expecting a topic
  const skipWhenNotExpecting = [
    /\?$/, // Questions
    /^@\w+\s+(thanks|thank|appreciate)/,
    /will (share|send|post).*(soon|later|tomorrow)/i, // Promises to share later
  ];

  for (const pattern of skipWhenNotExpecting) {
    if (pattern.test(lowerText)) return true;
  }

  return false;
}

/**
 * Use Claude to detect if a message is a topic announcement
 */
async function detectTopicAnnouncement(
  messageText: string,
  context: string,
  expectingTopic: boolean
): Promise<{
  isTopic: boolean;
  topic: string;
  description: string;
}> {
  try {
    const response = await claude.detectTopicInMessage(messageText, context, expectingTopic);
    return response;
  } catch (error) {
    console.error('[Topic Watcher] Error detecting topic:', error);
    return { isTopic: false, topic: '', description: '' };
  }
}

/**
 * Determine if this is for a weekly or monthly call based on Zoom schedule
 */
async function determineCallType(): Promise<'weekly' | 'monthly'> {
  try {
    // Check what's coming up in Zoom
    const weeklyCall = await zoom.getJoinUrlForNextCall('weekly');
    const monthlyCall = await zoom.getJoinUrlForNextCall('monthly');

    if (!weeklyCall && monthlyCall) {
      return 'monthly';
    }

    if (weeklyCall && monthlyCall) {
      // Both scheduled - which is sooner?
      if (monthlyCall.startTime < weeklyCall.startTime) {
        return 'monthly';
      }
    }

    // Default to weekly (most common)
    return 'weekly';
  } catch (error) {
    console.error('[Topic Watcher] Error determining call type:', error);
    return 'weekly';
  }
}

/**
 * Check if we've already processed a similar topic recently
 */
function checkDuplicate(topic: string): boolean {
  const normalizedTopic = topic.toLowerCase().trim();
  const now = new Date();

  // Clean up old entries
  for (const [key, value] of processedTopics.entries()) {
    if (now.getTime() - value.timestamp.getTime() > DUPLICATE_WINDOW_MS) {
      processedTopics.delete(key);
    }
  }

  // Check for similar topics
  for (const [, value] of processedTopics.entries()) {
    const existingNormalized = value.topic.toLowerCase().trim();
    // Simple similarity check - could be enhanced
    if (existingNormalized === normalizedTopic ||
        existingNormalized.includes(normalizedTopic) ||
        normalizedTopic.includes(existingNormalized)) {
      return true;
    }
  }

  return false;
}

/**
 * Mark a topic as processed
 */
function markAsProcessed(topic: string, messageTs: string): void {
  processedTopics.set(messageTs, {
    topic,
    timestamp: new Date(),
  });
}

/**
 * Notify the admin about a detected topic
 */
async function notifyAdminOfTopic(
  topic: string,
  description: string,
  callType: 'weekly' | 'monthly',
  originalMessage: string,
  context?: string
): Promise<void> {
  if (!env.SLACK_WELCOME_USER_ID) {
    console.error('[Topic Watcher] No admin user configured (SLACK_WELCOME_USER_ID)');
    return;
  }

  try {
    const adminChannel = await slack.openDmChannel(env.SLACK_WELCOME_USER_ID);
    const callLabel = callType === 'weekly' ? 'Weekly Training' : 'Monthly Business Owner';

    // Build blocks with the detected topic and action buttons
    const blocks = [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: '📣 New Topic Detected!',
          emoji: true,
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `Stefan just shared a topic in #ca-pro for the *${callLabel} Call*:`,
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
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `_Original message: "${originalMessage.substring(0, 200)}${originalMessage.length > 200 ? '...' : ''}"_`,
          },
        ],
      },
      {
        type: 'divider',
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: 'Would you like me to generate reminders for this topic?',
        },
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: {
              type: 'plain_text',
              text: '✅ Generate Reminders',
              emoji: true,
            },
            style: 'primary',
            action_id: 'generate_reminders_from_topic',
            value: JSON.stringify({ topic, callType }),
          },
          {
            type: 'button',
            text: {
              type: 'plain_text',
              text: '✏️ Edit Topic First',
              emoji: true,
            },
            action_id: 'edit_topic_before_generate',
            value: JSON.stringify({ topic, callType }),
          },
          {
            type: 'button',
            text: {
              type: 'plain_text',
              text: '🚫 Ignore',
              emoji: true,
            },
            action_id: 'ignore_detected_topic',
          },
        ],
      },
    ];

    await slack.postMessage(
      adminChannel,
      `New topic detected: ${topic}`,
      blocks
    );

    console.log(`[Topic Watcher] Notified admin about topic: "${topic}"`);
  } catch (error) {
    console.error('[Topic Watcher] Error notifying admin:', error);
  }
}

/**
 * Check if topic watching is properly configured
 */
export function isTopicWatcherConfigured(): boolean {
  return !!(CA_PRO_CHANNEL_ID && env.SLACK_WELCOME_USER_ID);
}

/**
 * Get configuration status for debugging
 */
export function getTopicWatcherStatus(): {
  configured: boolean;
  channelId: string | undefined;
  adminUserId: string | undefined;
  processedTopicsCount: number;
  recentTopics: string[];
  expectingTopic: boolean;
  pendingTopicRequest: TopicRequestContext | null;
  recentMessagesCount: number;
  trackedThreadsCount: number;
} {
  // Get recent topics for debugging
  const recentTopicsList: string[] = [];
  for (const [, value] of processedTopics.entries()) {
    recentTopicsList.push(value.topic);
  }

  // Check if pending request is still valid
  let validPendingRequest = pendingTopicRequest;
  if (pendingTopicRequest) {
    const elapsed = Date.now() - pendingTopicRequest.askedAt.getTime();
    if (elapsed > TOPIC_REQUEST_WINDOW_MS) {
      validPendingRequest = null;
    }
  }

  // Clean up expired thread trackers and count
  const now = new Date();
  for (const [key, value] of topicRequestMessages.entries()) {
    if (now.getTime() - value.timestamp.getTime() > TOPIC_REQUEST_MESSAGE_EXPIRY_MS) {
      topicRequestMessages.delete(key);
    }
  }

  return {
    configured: isTopicWatcherConfigured(),
    channelId: CA_PRO_CHANNEL_ID,
    adminUserId: env.SLACK_WELCOME_USER_ID,
    processedTopicsCount: processedTopics.size,
    recentTopics: recentTopicsList,
    expectingTopic: validPendingRequest !== null,
    pendingTopicRequest: validPendingRequest,
    recentMessagesCount: recentMessages.length,
    trackedThreadsCount: topicRequestMessages.size,
  };
}
