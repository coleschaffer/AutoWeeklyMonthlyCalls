import * as slack from '../services/slack.js';
import * as activeCampaign from '../services/activecampaign.js';
import * as circle from '../services/circle.js';
import * as claude from '../services/claude.js';
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
  const pending = await pendingStore.getPendingWithFallback(pendingId);

  if (!pending) {
    return { success: false, error: 'Message not found or expired' };
  }

  try {
    // Use subject from metadata if available, otherwise generate one
    let subject = pending.metadata.subject as string | undefined;

    if (!subject) {
      if (pending.type === 'reminder') {
        // Fallback subjects for reminders
        if (pending.callType === 'weekly') {
          subject = pending.timing === 'dayBefore'
            ? 'CA Pro Weekly Call Tomorrow'
            : 'CA Pro Weekly Call Today';
        } else {
          subject = 'CA Pro Monthly Call Today';
        }
      } else {
        // Fallback subjects for recaps
        subject = pending.callType === 'weekly'
          ? 'CA Pro Weekly Call Recap'
          : 'CA Pro Monthly Call Recap';
      }
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
    await pendingStore.deletePending(pendingId);

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
  const pending = await pendingStore.getPendingWithFallback(pendingId);

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
    await pendingStore.deletePending(pendingId);

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
  const pending = await pendingStore.getPendingWithFallback(pendingId);

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
 * Handle "Edit with AI" button click - open feedback modal
 */
export async function handleEditWithAi(
  pendingId: string,
  triggerId: string
): Promise<{ success: boolean; error?: string }> {
  const pending = await pendingStore.getPendingWithFallback(pendingId);

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
      topic: pending.metadata.topic as string | undefined,
    };

    const success = await slack.openEditWithAiModal(
      triggerId,
      pendingId,
      pending.message,
      metadata
    );

    return { success };
  } catch (error) {
    console.error('Failed to open AI edit modal:', error);
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
  const updated = await pendingStore.updatePendingMessage(pendingId, newMessage);

  if (!updated) {
    return { success: false, error: 'Message not found or expired' };
  }

  const pending = await pendingStore.getPendingWithFallback(pendingId);
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
 * Handle AI edit modal submission - regenerate message with Claude
 */
export async function handleAiEditModalSubmission(
  pendingId: string,
  feedback: string,
  metadata: {
    channel: string;
    callType: string;
    messageType: string;
    timing?: string;
    topic?: string;
    originalTopic?: string;
  }
): Promise<{ success: boolean; error?: string }> {
  const pending = await pendingStore.getPendingWithFallback(pendingId);

  if (!pending) {
    return { success: false, error: 'Message not found or expired' };
  }

  try {
    // Regenerate the message using Claude with the feedback
    const regeneratedMessage = await claude.regenerateMessageWithFeedback(
      pending.message,
      feedback,
      {
        messageType: metadata.messageType as 'reminder' | 'recap',
        channel: metadata.channel as 'whatsapp' | 'email' | 'circle',
        callType: metadata.callType as 'weekly' | 'monthly',
        topic: metadata.topic,
        originalTopic: metadata.originalTopic,
      }
    );

    // Update the pending message
    await pendingStore.updatePendingMessage(pendingId, regeneratedMessage);

    // Build the appropriate blocks for the regenerated message
    let blocks: unknown[];

    if (pending.channel === 'whatsapp') {
      if (pending.type === 'reminder') {
        blocks = slack.buildWhatsAppReminderBlocks(
          regeneratedMessage,
          pendingId,
          pending.timing || 'dayOf',
          pending.callType
        );
      } else {
        blocks = slack.buildWhatsAppRecapBlocks(regeneratedMessage, pendingId);
      }
    } else if (pending.channel === 'email') {
      if (pending.type === 'reminder') {
        blocks = slack.buildEmailReminderBlocks(
          regeneratedMessage,
          pendingId,
          pending.timing || 'dayOf',
          pending.callType
        );
      } else {
        blocks = slack.buildEmailRecapBlocks(regeneratedMessage, pendingId);
      }
    } else {
      // Circle
      const topic = (pending.metadata.topic as string) || 'Training';
      blocks = slack.buildCircleRecapBlocks(regeneratedMessage, pendingId, topic);
    }

    // Post the regenerated message as a new message in the thread
    await slack.postMessage(
      pending.slackChannel,
      `🤖 Regenerated ${pending.channel} message`,
      [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*🤖 Regenerated ${pending.channel.charAt(0).toUpperCase() + pending.channel.slice(1)} Message*\n_Feedback: "${feedback}"_`,
          },
        },
        ...blocks,
      ],
      undefined,
      pending.slackMessageTs
    );

    console.log(`AI regenerated message for ${pendingId}`);
    return { success: true };
  } catch (error) {
    console.error('Failed to regenerate message with AI:', error);
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
  const pending = await pendingStore.getPendingWithFallback(pendingId);

  if (!pending) {
    console.log(`Cannot mark as copied - pending message not found: ${pendingId}`);
    return;
  }

  // Update the Slack message to show "Copied" status
  const confirmBlocks = slack.buildCopiedConfirmationBlocks(pending.message, 'whatsapp');
  await slack.updateMessage(channel, messageTs, '📋 Copied!', confirmBlocks);

  console.log(`Marked as copied: ${pendingId}`);
}
