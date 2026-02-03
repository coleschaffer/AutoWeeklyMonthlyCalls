import { query } from './client.js';

/**
 * Initialize database schema
 * Creates all necessary tables if they don't exist
 */
export async function initializeSchema(): Promise<void> {
  console.log('Initializing database schema...');

  // Pending messages - messages awaiting approval
  await query(`
    CREATE TABLE IF NOT EXISTS pending_messages (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      channel TEXT NOT NULL,
      call_type TEXT NOT NULL,
      timing TEXT,
      message TEXT NOT NULL,
      metadata JSONB DEFAULT '{}',
      slack_message_ts TEXT,
      slack_channel TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      expires_at TIMESTAMP WITH TIME ZONE NOT NULL
    )
  `);

  // Reminder topics - links reminder topics to recaps
  await query(`
    CREATE TABLE IF NOT EXISTS reminder_topics (
      id SERIAL PRIMARY KEY,
      call_type TEXT NOT NULL,
      call_date DATE NOT NULL,
      topic TEXT NOT NULL,
      presenter TEXT DEFAULT 'Stefan',
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      UNIQUE(call_type, call_date)
    )
  `);

  // Call history - log of all calls processed
  await query(`
    CREATE TABLE IF NOT EXISTS call_history (
      id SERIAL PRIMARY KEY,
      meeting_id TEXT UNIQUE,
      call_type TEXT NOT NULL,
      topic TEXT NOT NULL,
      presenter TEXT DEFAULT 'Stefan',
      call_date TIMESTAMP WITH TIME ZONE NOT NULL,

      -- Processing status
      status TEXT DEFAULT 'pending',
      error_message TEXT,

      -- Generated links
      youtube_url TEXT,
      youtube_id TEXT,
      circle_url TEXT,
      drive_video_url TEXT,
      drive_transcript_url TEXT,
      drive_chat_url TEXT,

      -- Timestamps
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      processed_at TIMESTAMP WITH TIME ZONE,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `);

  // Sent messages - audit log of sent content
  await query(`
    CREATE TABLE IF NOT EXISTS sent_messages (
      id SERIAL PRIMARY KEY,
      call_history_id INTEGER REFERENCES call_history(id),

      -- Message details
      message_type TEXT NOT NULL,
      channel TEXT NOT NULL,
      subject TEXT,
      content TEXT NOT NULL,

      -- Delivery status
      status TEXT DEFAULT 'sent',
      external_id TEXT,
      error_message TEXT,

      -- Who approved it
      approved_by TEXT,
      approved_at TIMESTAMP WITH TIME ZONE,

      -- Timestamps
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `);

  // Processed mentions - dedup tracking for @mentions
  await query(`
    CREATE TABLE IF NOT EXISTS processed_mentions (
      id SERIAL PRIMARY KEY,
      mention_key TEXT UNIQUE NOT NULL,
      processed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `);

  // Create indexes for common queries
  await query(`CREATE INDEX IF NOT EXISTS idx_pending_expires ON pending_messages(expires_at)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_pending_channel ON pending_messages(slack_channel, slack_message_ts)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_reminder_topics_lookup ON reminder_topics(call_type, call_date)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_call_history_date ON call_history(call_date DESC)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_call_history_meeting ON call_history(meeting_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_sent_messages_call ON sent_messages(call_history_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_processed_mentions_key ON processed_mentions(mention_key)`);

  console.log('Database schema initialized');
}

/**
 * Clean up expired data
 */
export async function cleanupExpiredData(): Promise<{
  pendingMessages: number;
  reminderTopics: number;
  processedMentions: number;
}> {
  // Delete expired pending messages
  const pendingResult = await query(
    `DELETE FROM pending_messages WHERE expires_at < NOW() RETURNING id`
  );

  // Delete old reminder topics (older than 7 days)
  const topicsResult = await query(
    `DELETE FROM reminder_topics WHERE created_at < NOW() - INTERVAL '7 days' RETURNING id`
  );

  // Delete old processed mentions (older than 1 hour)
  const mentionsResult = await query(
    `DELETE FROM processed_mentions WHERE processed_at < NOW() - INTERVAL '1 hour' RETURNING id`
  );

  const cleaned = {
    pendingMessages: pendingResult.rowCount || 0,
    reminderTopics: topicsResult.rowCount || 0,
    processedMentions: mentionsResult.rowCount || 0,
  };

  if (cleaned.pendingMessages + cleaned.reminderTopics + cleaned.processedMentions > 0) {
    console.log('Cleaned up expired data:', cleaned);
  }

  return cleaned;
}
