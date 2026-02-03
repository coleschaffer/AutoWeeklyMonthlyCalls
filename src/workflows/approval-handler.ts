import * as slack from '../services/slack.js';
import * as activeCampaign from '../services/activecampaign.js';
import * as circle from '../services/circle.js';
import * as pendingStore from '../services/pending-store.js';
import { config } from '../config/env.js';
import type { PendingMessage } from '../services/pending-store.js';

// ===========================================
// Approval Handler for Messages
// ===========================================

/**
 * Handle email approval - send via ActiveCampaign
 */
export async function handleEmailApproval(
  pendingId: string,
  channel: string,
  messageTs: string
): Promise<{ success: boolean; error?: string }> {
  const pending = pendingStore.getPending(pendingId);

  if (!pending) {
    return { success: false, error: 'Message not found or expired' };
  }

  try {
    // Determine subject line based on type
    let subject = '';
    if (pending.type === 'reminder') {
      const callLabel = pending.callType === 'weekly' ? 'Weekly Training' : 'Monthly Business Owner';
      const timingLabel = pending.timing === 'dayBefore' ? 'Tomorrow' : 'Today';
      subject = `${timingLabel}: CA Pro ${callLabel} Call`;
    } else {
      // Recap
      const topic = (pending.metadata.topic as string) || 'Training';
      subject = `New Recording: ${topic}`;
    }

    // Determine the correct list ID based on call type
    const listId = pending.callType === 'monthly'
      ? config.activeCampaignMonthlyListId
      : config.activeCampaignWeeklyListId;

    if (!listId || listId === 0) {
      throw new Error(`No ActiveCampaign list configured for ${pending.callType} calls. Set AC_TM_LIST_ID (weekly) or AC_BO_LIST_ID (monthly).`);
    }

    // Send via ActiveCampaign
    const result = await activeCampaign.sendCampaign({
      listId,
      subject,
      body: pending.message,
    });

    if (!result.success) {
      throw new Error(result.error || 'Failed to send email');
    }

    // Update Slack message to show sent status
    const confirmBlocks = slack.buildApprovedConfirmationBlocks('email', pending.message);
    await slack.updateMessage(channel, messageTs, '✅ Email sent!', confirmBlocks);

    // Clean up pending message
    pendingStore.deletePending(pendingId);

    console.log(`Email approved and sent: ${pendingId}`);
    return { success: true };
  } catch (error) {
    console.error('Email approval failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Handle Circle approval - post to Circle community
 */
export async function handleCircleApproval(
  pendingId: string,
  channel: string,
  messageTs: string
): Promise<{ success: boolean; error?: string; postUrl?: string }> {
  const pending = pendingStore.getPending(pendingId);

  if (!pending) {
    return { success: false, error: 'Message not found or expired' };
  }

  try {
    const topic = (pending.metadata.topic as string) || 'Training Call';
    const date = new Date();

    // Format title
    const dateStr = date.toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });
    const typeLabel = pending.callType === 'weekly' ? 'Weekly' : 'Monthly';
    const title = `${dateStr} - CA Pro ${typeLabel} Training: ${topic}`;

    // Create Circle post
    const result = await circle.createPost({
      spaceId: config.circleSpaceId,
      name: title,
      body: pending.message,
    });

    // Update Slack message to show posted status
    const confirmBlocks = slack.buildApprovedConfirmationBlocks('circle', pending.message);
    await slack.updateMessage(channel, messageTs, `✅ Posted to Circle!\n${result.url}`, confirmBlocks);

    // Clean up pending message
    pendingStore.deletePending(pendingId);

    console.log(`Circle post approved and created: ${pendingId} -> ${result.url}`);
    return { success: true, postUrl: result.url };
  } catch (error) {
    console.error('Circle approval failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Handle "Set Message" button click - open modal
 */
export async function handleSetMessage(
  pendingId: string,
  triggerId: string
): Promise<{ success: boolean; error?: string }> {
  const pending = pendingStore.getPending(pendingId);

  if (!pending) {
    return { success: false, error: 'Message not found or expired' };
  }

  try {
    const metadata = {
      pendingId,
      messageType: pending.type,
      channel: pending.channel,
      callType: pending.callType,
      timing: pending.timing,
    };

    const success = await slack.openSetMessageModal(
      triggerId,
      pendingId,
      pending.message,
      metadata
    );

    return { success };
  } catch (error) {
    console.error('Failed to open Set Message modal:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Handle modal submission - update pending message and post preview
 */
export async function handleModalSubmission(
  pendingId: string,
  newMessage: string,
  metadata: {
    channel: string;
    callType: string;
    messageType: string;
    timing?: string;
  }
): Promise<{ success: boolean; error?: string }> {
  // Update the pending message
  const updated = pendingStore.updatePendingMessage(pendingId, newMessage);

  if (!updated) {
    return { success: false, error: 'Message not found or expired' };
  }

  const pending = pendingStore.getPending(pendingId);
  if (!pending) {
    return { success: false, error: 'Message not found after update' };
  }

  // Post updated preview in the original channel
  try {
    let blocks: unknown[];

    if (pending.channel === 'whatsapp') {
      if (pending.type === 'reminder') {
        blocks = slack.buildWhatsAppReminderBlocks(
          newMessage,
          pendingId,
          pending.timing || 'dayOf',
          pending.callType
        );
      } else {
        blocks = slack.buildWhatsAppRecapBlocks(newMessage, pendingId);
      }
    } else if (pending.channel === 'email') {
      if (pending.type === 'reminder') {
        blocks = slack.buildEmailReminderBlocks(
          newMessage,
          pendingId,
          pending.timing || 'dayOf',
          pending.callType
        );
      } else {
        blocks = slack.buildEmailRecapBlocks(newMessage, pendingId);
      }
    } else {
      // Circle
      const topic = (pending.metadata.topic as string) || 'Training';
      blocks = slack.buildCircleRecapBlocks(newMessage, pendingId, topic);
    }

    // Post new message with updated content
    await slack.postMessage(
      pending.slackChannel,
      `Updated ${pending.channel} message`,
      [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*✏️ Updated ${pending.channel.charAt(0).toUpperCase() + pending.channel.slice(1)} Message*`,
          },
        },
        ...blocks,
      ],
      undefined,
      pending.slackMessageTs
    );

    return { success: true };
  } catch (error) {
    console.error('Failed to post updated preview:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Mark a WhatsApp message as copied (update the Slack message)
 */
export async function markAsCopied(
  pendingId: string,
  channel: string,
  messageTs: string
): Promise<void> {
  const pending = pendingStore.getPending(pendingId);

  if (!pending) {
    console.log(`Cannot mark as copied - pending message not found: ${pendingId}`);
    return;
  }

  // Update the Slack message to show "Copied" status
  const confirmBlocks = slack.buildCopiedConfirmationBlocks(pending.message, 'whatsapp');
  await slack.updateMessage(channel, messageTs, '📋 Copied!', confirmBlocks);

  console.log(`Marked as copied: ${pendingId}`);
}
