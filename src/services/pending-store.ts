import type { CallType } from '../types/index.js';
import type { MessageChannel, MessageType, ReminderTiming } from '../config/templates.js';

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

// ===========================================
// In-Memory Store
// ===========================================

const pendingMessages: Map<string, PendingMessage> = new Map();

// Auto-expiry: 24 hours
const EXPIRY_MS = 24 * 60 * 60 * 1000;

// Cleanup interval: every hour
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

// ===========================================
// Store Operations
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
    expiresAt: new Date(now.getTime() + EXPIRY_MS),
  };

  pendingMessages.set(id, pending);
  console.log(`Stored pending message: ${id} (${input.type}/${input.channel})`);

  return id;
}

/**
 * Get a pending message by ID
 */
export function getPending(id: string): PendingMessage | null {
  const pending = pendingMessages.get(id);

  if (!pending) {
    return null;
  }

  // Check if expired
  if (new Date() > pending.expiresAt) {
    pendingMessages.delete(id);
    console.log(`Pending message expired: ${id}`);
    return null;
  }

  return pending;
}

/**
 * Update the message content for a pending message
 */
export function updatePendingMessage(id: string, newMessage: string): boolean {
  const pending = pendingMessages.get(id);

  if (!pending) {
    return false;
  }

  // Check if expired
  if (new Date() > pending.expiresAt) {
    pendingMessages.delete(id);
    return false;
  }

  pending.message = newMessage;
  pendingMessages.set(id, pending);
  console.log(`Updated pending message: ${id}`);

  return true;
}

/**
 * Update metadata for a pending message
 */
export function updatePendingMetadata(
  id: string,
  metadata: Record<string, unknown>
): boolean {
  const pending = pendingMessages.get(id);

  if (!pending) {
    return false;
  }

  pending.metadata = { ...pending.metadata, ...metadata };
  pendingMessages.set(id, pending);

  return true;
}

/**
 * Delete a pending message
 */
export function deletePending(id: string): boolean {
  const deleted = pendingMessages.delete(id);
  if (deleted) {
    console.log(`Deleted pending message: ${id}`);
  }
  return deleted;
}

/**
 * Get all pending messages (for debugging)
 */
export function getAllPending(): PendingMessage[] {
  cleanupExpired();
  return Array.from(pendingMessages.values());
}

/**
 * Get pending messages by Slack message timestamp
 */
export function getPendingBySlackTs(
  slackChannel: string,
  slackMessageTs: string
): PendingMessage | null {
  for (const pending of pendingMessages.values()) {
    if (
      pending.slackChannel === slackChannel &&
      pending.slackMessageTs === slackMessageTs
    ) {
      // Check if expired
      if (new Date() > pending.expiresAt) {
        pendingMessages.delete(pending.id);
        return null;
      }
      return pending;
    }
  }
  return null;
}

/**
 * Clean up expired messages
 */
export function cleanupExpired(): number {
  const now = new Date();
  let cleaned = 0;

  for (const [id, pending] of pendingMessages.entries()) {
    if (now > pending.expiresAt) {
      pendingMessages.delete(id);
      cleaned++;
    }
  }

  if (cleaned > 0) {
    console.log(`Cleaned up ${cleaned} expired pending messages`);
  }

  return cleaned;
}

/**
 * Get store stats (for debugging/monitoring)
 */
export function getStoreStats(): {
  total: number;
  byType: Record<string, number>;
  byChannel: Record<string, number>;
} {
  cleanupExpired();

  const stats = {
    total: pendingMessages.size,
    byType: {} as Record<string, number>,
    byChannel: {} as Record<string, number>,
  };

  for (const pending of pendingMessages.values()) {
    stats.byType[pending.type] = (stats.byType[pending.type] || 0) + 1;
    stats.byChannel[pending.channel] = (stats.byChannel[pending.channel] || 0) + 1;
  }

  return stats;
}

// ===========================================
// Auto-cleanup on module load
// ===========================================

// Start periodic cleanup
setInterval(() => {
  cleanupExpired();
}, CLEANUP_INTERVAL_MS);

console.log('Pending message store initialized');
