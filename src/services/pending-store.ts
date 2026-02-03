import type { CallType } from '../types/index.js';
import type { MessageChannel, MessageType, ReminderTiming } from '../config/templates.js';
import { query, isDatabaseConfigured } from '../db/client.js';

// ===========================================
// Pending Message Types
// ===========================================

export interface PendingMessage {
  id: string;
  type: MessageType;
  channel: MessageChannel;
  callType: CallType;
  timing?: ReminderTiming;
  message: string;
  metadata: Record<string, unknown>;
  slackMessageTs: string;
  slackChannel: string;
  createdAt: Date;
  expiresAt: Date;
}

export interface CreatePendingInput {
  type: MessageType;
  channel: MessageChannel;
  callType: CallType;
  timing?: ReminderTiming;
  message: string;
  metadata?: Record<string, unknown>;
  slackMessageTs: string;
  slackChannel: string;
}

// Auto-expiry: 24 hours
const EXPIRY_MS = 24 * 60 * 60 * 1000;

// In-memory cache (used as primary when no database, as cache when database exists)
const pendingCache = new Map<string, PendingMessage>();

// ===========================================
// Pending Message Operations
// ===========================================

/**
 * Generate a unique ID for pending messages
 */
function generateId(): string {
  return `pending_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Store a new pending message
 */
export function storePending(input: CreatePendingInput): string {
  const id = generateId();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + EXPIRY_MS);

  // Create the pending message object
  const pending: PendingMessage = {
    id,
    type: input.type,
    channel: input.channel,
    callType: input.callType,
    timing: input.timing,
    message: input.message,
    metadata: input.metadata || {},
    slackMessageTs: input.slackMessageTs,
    slackChannel: input.slackChannel,
    createdAt: now,
    expiresAt,
  };

  // Always store in cache first (fixes race condition)
  pendingCache.set(id, pending);

  // Also persist to database if configured
  if (isDatabaseConfigured()) {
    query(
      `INSERT INTO pending_messages (id, type, channel, call_type, timing, message, metadata, slack_message_ts, slack_channel, created_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        id,
        input.type,
        input.channel,
        input.callType,
        input.timing || null,
        input.message,
        JSON.stringify(input.metadata || {}),
        input.slackMessageTs,
        input.slackChannel,
        now,
        expiresAt,
      ]
    ).catch(err => console.error('Failed to persist pending message to database:', err));
  }

  console.log(`Stored pending message: ${id} (${input.type}/${input.channel})`);
  return id;
}

/**
 * Get a pending message by ID from database
 */
export async function getPendingAsync(id: string): Promise<PendingMessage | null> {
  if (!isDatabaseConfigured()) {
    return null;
  }

  const result = await query<{
    id: string;
    type: string;
    channel: string;
    call_type: string;
    timing: string | null;
    message: string;
    metadata: Record<string, unknown>;
    slack_message_ts: string;
    slack_channel: string;
    created_at: Date;
    expires_at: Date;
  }>(
    `SELECT * FROM pending_messages WHERE id = $1 AND expires_at > NOW()`,
    [id]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];
  return {
    id: row.id,
    type: row.type as MessageType,
    channel: row.channel as MessageChannel,
    callType: row.call_type as CallType,
    timing: row.timing as ReminderTiming | undefined,
    message: row.message,
    metadata: row.metadata,
    slackMessageTs: row.slack_message_ts,
    slackChannel: row.slack_channel,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

/**
 * Sync version - uses cache for immediate return
 */
export function getPending(id: string): PendingMessage | null {
  // Check cache first
  const cached = pendingCache.get(id);
  if (cached) {
    if (new Date() > cached.expiresAt) {
      pendingCache.delete(id);
      return null;
    }
    return cached;
  }

  // Trigger async fetch to populate cache for next call
  getPendingAsync(id).then(pending => {
    if (pending) {
      pendingCache.set(id, pending);
    }
  });

  return null;
}

/**
 * Get pending with async fallback (for approval handlers)
 */
export async function getPendingWithFallback(id: string): Promise<PendingMessage | null> {
  // Check cache first
  const cached = pendingCache.get(id);
  if (cached) {
    if (new Date() > cached.expiresAt) {
      pendingCache.delete(id);
      return getPendingAsync(id);
    }
    return cached;
  }

  // Fetch from database
  const pending = await getPendingAsync(id);
  if (pending) {
    pendingCache.set(id, pending);
  }
  return pending;
}

/**
 * Update the message content for a pending message
 */
export async function updatePendingMessage(id: string, newMessage: string): Promise<boolean> {
  // Update cache
  const cached = pendingCache.get(id);
  if (cached) {
    cached.message = newMessage;
  }

  // Update database if configured
  if (isDatabaseConfigured()) {
    try {
      await query(
        `UPDATE pending_messages SET message = $1 WHERE id = $2 AND expires_at > NOW()`,
        [newMessage, id]
      );
    } catch (err) {
      console.error('Failed to update pending message in database:', err);
    }
  }

  if (cached) {
    console.log(`Updated pending message: ${id}`);
    return true;
  }

  return false;
}

/**
 * Update metadata for a pending message
 */
export async function updatePendingMetadata(
  id: string,
  metadata: Record<string, unknown>
): Promise<boolean> {
  const pending = await getPendingAsync(id);
  if (!pending) return false;

  const newMetadata = { ...pending.metadata, ...metadata };

  const result = await query(
    `UPDATE pending_messages SET metadata = $1 WHERE id = $2`,
    [JSON.stringify(newMetadata), id]
  );

  if (result.rowCount && result.rowCount > 0) {
    // Update cache
    const cached = pendingCache.get(id);
    if (cached) {
      cached.metadata = newMetadata;
    }
    return true;
  }

  return false;
}

/**
 * Delete a pending message
 */
export async function deletePending(id: string): Promise<boolean> {
  const existed = pendingCache.has(id);
  pendingCache.delete(id);

  // Delete from database if configured
  if (isDatabaseConfigured()) {
    try {
      await query(
        `DELETE FROM pending_messages WHERE id = $1`,
        [id]
      );
    } catch (err) {
      console.error('Failed to delete pending message from database:', err);
    }
  }

  if (existed) {
    console.log(`Deleted pending message: ${id}`);
    return true;
  }

  return false;
}

/**
 * Get all pending messages (for debugging)
 */
export async function getAllPending(): Promise<PendingMessage[]> {
  // Clean expired from cache
  const now = new Date();
  for (const [id, pending] of pendingCache.entries()) {
    if (now > pending.expiresAt) {
      pendingCache.delete(id);
    }
  }

  // Return from cache if no database
  if (!isDatabaseConfigured()) {
    return Array.from(pendingCache.values());
  }

  const result = await query<{
    id: string;
    type: string;
    channel: string;
    call_type: string;
    timing: string | null;
    message: string;
    metadata: Record<string, unknown>;
    slack_message_ts: string;
    slack_channel: string;
    created_at: Date;
    expires_at: Date;
  }>(
    `SELECT * FROM pending_messages WHERE expires_at > NOW() ORDER BY created_at DESC`
  );

  return result.rows.map(row => ({
    id: row.id,
    type: row.type as MessageType,
    channel: row.channel as MessageChannel,
    callType: row.call_type as CallType,
    timing: row.timing as ReminderTiming | undefined,
    message: row.message,
    metadata: row.metadata,
    slackMessageTs: row.slack_message_ts,
    slackChannel: row.slack_channel,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  }));
}

/**
 * Get pending messages by Slack message timestamp
 */
export async function getPendingBySlackTs(
  slackChannel: string,
  slackMessageTs: string
): Promise<PendingMessage | null> {
  const result = await query<{
    id: string;
    type: string;
    channel: string;
    call_type: string;
    timing: string | null;
    message: string;
    metadata: Record<string, unknown>;
    slack_message_ts: string;
    slack_channel: string;
    created_at: Date;
    expires_at: Date;
  }>(
    `SELECT * FROM pending_messages
     WHERE slack_channel = $1 AND slack_message_ts = $2 AND expires_at > NOW()
     LIMIT 1`,
    [slackChannel, slackMessageTs]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];
  return {
    id: row.id,
    type: row.type as MessageType,
    channel: row.channel as MessageChannel,
    callType: row.call_type as CallType,
    timing: row.timing as ReminderTiming | undefined,
    message: row.message,
    metadata: row.metadata,
    slackMessageTs: row.slack_message_ts,
    slackChannel: row.slack_channel,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

/**
 * Get store stats (for debugging/monitoring)
 */
export async function getStoreStats(): Promise<{
  total: number;
  byType: Record<string, number>;
  byChannel: Record<string, number>;
}> {
  const stats = {
    total: 0,
    byType: {} as Record<string, number>,
    byChannel: {} as Record<string, number>,
  };

  // If no database, compute from cache
  if (!isDatabaseConfigured()) {
    const now = new Date();
    for (const pending of pendingCache.values()) {
      if (now <= pending.expiresAt) {
        stats.total++;
        stats.byType[pending.type] = (stats.byType[pending.type] || 0) + 1;
        stats.byChannel[pending.channel] = (stats.byChannel[pending.channel] || 0) + 1;
      }
    }
    return stats;
  }

  const result = await query<{ type: string; channel: string; count: string }>(
    `SELECT type, channel, COUNT(*) as count
     FROM pending_messages
     WHERE expires_at > NOW()
     GROUP BY type, channel`
  );

  for (const row of result.rows) {
    const count = parseInt(row.count, 10);
    stats.total += count;
    stats.byType[row.type] = (stats.byType[row.type] || 0) + count;
    stats.byChannel[row.channel] = (stats.byChannel[row.channel] || 0) + count;
  }

  return stats;
}

// ===========================================
// Reminder Topic Store
// ===========================================

// In-memory fallback for reminder topics
const reminderTopicCache = new Map<string, { topic: string; presenter: string; storedAt: Date }>();

function getTopicKey(callType: string, date: Date): string {
  const dateStr = date.toISOString().split('T')[0];
  return `${callType}:${dateStr}`;
}

/**
 * Store the topic used for a reminder
 */
export async function storeReminderTopic(
  callType: 'weekly' | 'monthly',
  callDate: Date,
  topic: string,
  presenter: string = 'Stefan'
): Promise<void> {
  const dateStr = callDate.toISOString().split('T')[0];
  const key = getTopicKey(callType, callDate);

  // Always store in memory cache
  reminderTopicCache.set(key, { topic, presenter, storedAt: new Date() });

  // Also persist to database if configured
  if (isDatabaseConfigured()) {
    try {
      await query(
        `INSERT INTO reminder_topics (call_type, call_date, topic, presenter)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (call_type, call_date) DO UPDATE SET topic = $3, presenter = $4`,
        [callType, dateStr, topic, presenter]
      );
    } catch (err) {
      console.error('Failed to persist reminder topic to database:', err);
    }
  }

  console.log(`Stored reminder topic: ${callType}:${dateStr} -> "${topic}" (presenter: ${presenter})`);
}

/**
 * Get the topic that was used for a reminder
 */
export async function getReminderTopic(
  callType: 'weekly' | 'monthly',
  callDate: Date
): Promise<{ topic: string; presenter: string } | null> {
  const dateStr = callDate.toISOString().split('T')[0];
  const key = getTopicKey(callType, callDate);

  // Check in-memory cache first (also checks adjacent days)
  const cached = reminderTopicCache.get(key);
  if (cached) {
    console.log(`Found cached reminder topic for ${key}: "${cached.topic}"`);
    return { topic: cached.topic, presenter: cached.presenter };
  }

  // Check adjacent days in cache
  const yesterday = new Date(callDate);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayKey = getTopicKey(callType, yesterday);
  const yesterdayCached = reminderTopicCache.get(yesterdayKey);
  if (yesterdayCached) {
    console.log(`Found cached reminder topic for ${yesterdayKey}: "${yesterdayCached.topic}"`);
    return { topic: yesterdayCached.topic, presenter: yesterdayCached.presenter };
  }

  const tomorrow = new Date(callDate);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowKey = getTopicKey(callType, tomorrow);
  const tomorrowCached = reminderTopicCache.get(tomorrowKey);
  if (tomorrowCached) {
    console.log(`Found cached reminder topic for ${tomorrowKey}: "${tomorrowCached.topic}"`);
    return { topic: tomorrowCached.topic, presenter: tomorrowCached.presenter };
  }

  // Try database if configured
  if (isDatabaseConfigured()) {
    try {
      const result = await query<{ topic: string; presenter: string }>(
        `SELECT topic, presenter FROM reminder_topics
         WHERE call_type = $1
         AND call_date BETWEEN ($2::date - INTERVAL '1 day') AND ($2::date + INTERVAL '1 day')
         ORDER BY ABS(EXTRACT(EPOCH FROM (call_date - $2::date)))
         LIMIT 1`,
        [callType, dateStr]
      );

      if (result.rows.length > 0) {
        console.log(`Found stored reminder topic for ${callType}:${dateStr}: "${result.rows[0].topic}"`);
        // Cache it
        reminderTopicCache.set(key, { ...result.rows[0], storedAt: new Date() });
        return result.rows[0];
      }
    } catch (err) {
      console.error('Failed to fetch reminder topic from database:', err);
    }
  }

  console.log(`No stored reminder topic found for ${callType}:${dateStr}`);
  return null;
}

// ===========================================
// Processed Mentions (Dedup)
// ===========================================

// In-memory fallback for processed mentions
const processedMentionsCache = new Map<string, Date>();
const MENTION_DEDUP_WINDOW_MS = 60 * 1000; // 1 minute

/**
 * Check if a mention has been processed recently
 */
export async function hasMentionBeenProcessed(mentionKey: string): Promise<boolean> {
  // Check in-memory cache first
  const cachedTime = processedMentionsCache.get(mentionKey);
  if (cachedTime && Date.now() - cachedTime.getTime() < MENTION_DEDUP_WINDOW_MS) {
    return true;
  }

  // Check database if configured
  if (isDatabaseConfigured()) {
    try {
      const result = await query(
        `SELECT 1 FROM processed_mentions
         WHERE mention_key = $1
         AND processed_at > NOW() - INTERVAL '1 minute'`,
        [mentionKey]
      );
      return result.rows.length > 0;
    } catch (err) {
      console.error('Failed to check processed mentions in database:', err);
    }
  }

  return false;
}

/**
 * Mark a mention as processed
 */
export async function markMentionProcessed(mentionKey: string): Promise<void> {
  // Always update in-memory cache
  processedMentionsCache.set(mentionKey, new Date());

  // Clean up old entries from cache
  const cutoff = Date.now() - MENTION_DEDUP_WINDOW_MS;
  for (const [key, time] of processedMentionsCache.entries()) {
    if (time.getTime() < cutoff) {
      processedMentionsCache.delete(key);
    }
  }

  // Persist to database if configured
  if (isDatabaseConfigured()) {
    try {
      await query(
        `INSERT INTO processed_mentions (mention_key) VALUES ($1)
         ON CONFLICT (mention_key) DO UPDATE SET processed_at = NOW()`,
        [mentionKey]
      );
    } catch (err) {
      console.error('Failed to persist processed mention to database:', err);
    }
  }
}

// ===========================================
// Call History
// ===========================================

export interface CallHistoryEntry {
  id: number;
  meetingId: string;
  callType: CallType;
  topic: string;
  presenter: string;
  callDate: Date;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  errorMessage?: string;
  youtubeUrl?: string;
  youtubeId?: string;
  circleUrl?: string;
  driveVideoUrl?: string;
  driveTranscriptUrl?: string;
  driveChatUrl?: string;
  createdAt: Date;
  processedAt?: Date;
}

/**
 * Create or update a call history entry
 */
export async function upsertCallHistory(entry: {
  meetingId: string;
  callType: CallType;
  topic: string;
  presenter?: string;
  callDate: Date;
  status?: string;
  errorMessage?: string;
  youtubeUrl?: string;
  youtubeId?: string;
  circleUrl?: string;
  driveVideoUrl?: string;
  driveTranscriptUrl?: string;
  driveChatUrl?: string;
}): Promise<number> {
  if (!isDatabaseConfigured()) {
    console.log('Database not configured - skipping call history logging');
    return 0;
  }

  const result = await query<{ id: number }>(
    `INSERT INTO call_history (
      meeting_id, call_type, topic, presenter, call_date, status, error_message,
      youtube_url, youtube_id, circle_url, drive_video_url, drive_transcript_url, drive_chat_url
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    ON CONFLICT (meeting_id) DO UPDATE SET
      topic = COALESCE($3, call_history.topic),
      presenter = COALESCE($4, call_history.presenter),
      status = COALESCE($6, call_history.status),
      error_message = $7,
      youtube_url = COALESCE($8, call_history.youtube_url),
      youtube_id = COALESCE($9, call_history.youtube_id),
      circle_url = COALESCE($10, call_history.circle_url),
      drive_video_url = COALESCE($11, call_history.drive_video_url),
      drive_transcript_url = COALESCE($12, call_history.drive_transcript_url),
      drive_chat_url = COALESCE($13, call_history.drive_chat_url),
      updated_at = NOW(),
      processed_at = CASE WHEN $6 = 'completed' THEN NOW() ELSE call_history.processed_at END
    RETURNING id`,
    [
      entry.meetingId,
      entry.callType,
      entry.topic,
      entry.presenter || 'Stefan',
      entry.callDate,
      entry.status || 'pending',
      entry.errorMessage || null,
      entry.youtubeUrl || null,
      entry.youtubeId || null,
      entry.circleUrl || null,
      entry.driveVideoUrl || null,
      entry.driveTranscriptUrl || null,
      entry.driveChatUrl || null,
    ]
  );

  return result.rows[0].id;
}

/**
 * Get recent call history
 */
export async function getRecentCallHistory(limit: number = 10): Promise<CallHistoryEntry[]> {
  if (!isDatabaseConfigured()) {
    return [];
  }

  const result = await query<{
    id: number;
    meeting_id: string;
    call_type: string;
    topic: string;
    presenter: string;
    call_date: Date;
    status: string;
    error_message: string | null;
    youtube_url: string | null;
    youtube_id: string | null;
    circle_url: string | null;
    drive_video_url: string | null;
    drive_transcript_url: string | null;
    drive_chat_url: string | null;
    created_at: Date;
    processed_at: Date | null;
  }>(
    `SELECT * FROM call_history ORDER BY call_date DESC LIMIT $1`,
    [limit]
  );

  return result.rows.map(row => ({
    id: row.id,
    meetingId: row.meeting_id,
    callType: row.call_type as CallType,
    topic: row.topic,
    presenter: row.presenter,
    callDate: row.call_date,
    status: row.status as 'pending' | 'processing' | 'completed' | 'failed',
    errorMessage: row.error_message || undefined,
    youtubeUrl: row.youtube_url || undefined,
    youtubeId: row.youtube_id || undefined,
    circleUrl: row.circle_url || undefined,
    driveVideoUrl: row.drive_video_url || undefined,
    driveTranscriptUrl: row.drive_transcript_url || undefined,
    driveChatUrl: row.drive_chat_url || undefined,
    createdAt: row.created_at,
    processedAt: row.processed_at || undefined,
  }));
}

// ===========================================
// Sent Messages Audit Log
// ===========================================

export interface SentMessage {
  id: number;
  callHistoryId?: number;
  messageType: string;
  channel: string;
  subject?: string;
  content: string;
  status: string;
  externalId?: string;
  errorMessage?: string;
  approvedBy?: string;
  approvedAt?: Date;
  createdAt: Date;
}

/**
 * Log a sent message
 */
export async function logSentMessage(entry: {
  callHistoryId?: number;
  messageType: string;
  channel: string;
  subject?: string;
  content: string;
  status?: string;
  externalId?: string;
  errorMessage?: string;
  approvedBy?: string;
}): Promise<number> {
  if (!isDatabaseConfigured()) {
    console.log('Database not configured - skipping sent message logging');
    return 0;
  }

  const result = await query<{ id: number }>(
    `INSERT INTO sent_messages (
      call_history_id, message_type, channel, subject, content, status, external_id, error_message, approved_by, approved_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    RETURNING id`,
    [
      entry.callHistoryId || null,
      entry.messageType,
      entry.channel,
      entry.subject || null,
      entry.content,
      entry.status || 'sent',
      entry.externalId || null,
      entry.errorMessage || null,
      entry.approvedBy || null,
      entry.approvedBy ? new Date() : null,
    ]
  );

  return result.rows[0].id;
}

// Log initialization status
if (isDatabaseConfigured()) {
  console.log('Pending message store initialized (PostgreSQL + in-memory cache)');
} else {
  console.log('Pending message store initialized (in-memory only - data will not persist across restarts)');
}
