import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import crypto from 'crypto';
import { config, env } from './config/env.js';
import type { ApiResponse } from './types/index.js';

const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Serve static files (for copy.html) - use process.cwd() for ESM compatibility
app.use(express.static(process.cwd() + '/public'));

// Request logging
app.use((req: Request, _res: Response, next: NextFunction) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
  next();
});

// ===========================================
// Health Check
// ===========================================

app.get('/health', (_req: Request, res: Response) => {
  const response: ApiResponse = {
    success: true,
    data: {
      status: 'healthy',
      environment: env.NODE_ENV,
      uptime: process.uptime(),
    },
    timestamp: new Date().toISOString(),
  };
  res.json(response);
});

// ===========================================
// Zoom Webhook Endpoint
// ===========================================

app.post('/webhooks/zoom', async (req: Request, res: Response) => {
  console.log('Zoom webhook received:', req.body?.event);

  // Handle URL validation challenge from Zoom
  if (req.body.event === 'endpoint.url_validation') {
    const plainToken = req.body.payload.plainToken;
    console.log('Zoom URL validation challenge received');

    // Generate encrypted token using webhook secret
    const encryptedToken = crypto
      .createHmac('sha256', env.ZOOM_WEBHOOK_SECRET)
      .update(plainToken)
      .digest('hex');

    return res.json({ plainToken, encryptedToken });
  }

  // Validate webhook signature for other events
  const signature = req.headers['x-zm-signature'] as string;
  const timestamp = req.headers['x-zm-request-timestamp'] as string;

  if (signature && timestamp && env.ZOOM_WEBHOOK_SECRET) {
    const message = `v0:${timestamp}:${JSON.stringify(req.body)}`;
    const hashForVerify = crypto
      .createHmac('sha256', env.ZOOM_WEBHOOK_SECRET)
      .update(message)
      .digest('hex');
    const expectedSignature = `v0=${hashForVerify}`;

    if (signature !== expectedSignature) {
      console.error('Invalid Zoom webhook signature');
      return res.status(401).json({
        success: false,
        error: 'Invalid signature',
        timestamp: new Date().toISOString(),
      });
    }
  }

  // Handle recording completed event
  if (req.body.event === 'recording.completed') {
    console.log('Recording completed webhook received');
    console.log(`Meeting: ${req.body.payload?.object?.topic}`);

    // Dynamically import and process (lazy load)
    try {
      const { processRecording } = await import('./workflows/post-call-process.js');
      processRecording(req.body)
        .then(result => {
          if (result.success) {
            console.log(`Processing complete for ${result.meetingId}`);
          } else {
            console.error(`Processing failed: ${result.error}`);
          }
        })
        .catch(error => {
          console.error('Processing error:', error);
        });
    } catch (error) {
      console.error('Failed to load processing module:', error);
    }

    // Acknowledge webhook immediately
    return res.json({
      success: true,
      message: 'Processing started',
      timestamp: new Date().toISOString(),
    });
  }

  // Unknown event type
  res.json({
    success: true,
    message: 'Event received',
    timestamp: new Date().toISOString(),
  });
});

// ===========================================
// Manual Trigger Endpoints
// ===========================================

app.post('/api/process-call', async (req: Request, res: Response) => {
  const { meetingId } = req.query;

  if (!meetingId || typeof meetingId !== 'string') {
    return res.status(400).json({
      success: false,
      error: 'meetingId query parameter required',
      timestamp: new Date().toISOString(),
    });
  }

  console.log(`Manual processing triggered for: ${meetingId}`);

  try {
    const { processRecordingManual } = await import('./workflows/post-call-process.js');
    processRecordingManual(meetingId)
      .then(result => {
        console.log(`Manual processing result:`, result);
      })
      .catch(error => {
        console.error('Manual processing error:', error);
      });
  } catch (error) {
    console.error('Failed to load processing module:', error);
  }

  res.json({
    success: true,
    message: 'Processing started',
    meetingId,
    timestamp: new Date().toISOString(),
  });
});

// ===========================================
// Reminder Trigger Endpoints (for testing)
// ===========================================

app.post('/api/reminders/:type/:timing', async (req: Request, res: Response) => {
  const { type, timing } = req.params;
  console.log(`Manual trigger: ${type} ${timing} reminder`);

  try {
    const reminders = await import('./workflows/pre-call-reminder.js');

    let result;
    if (type === 'weekly' && timing === 'day-before') {
      result = await reminders.sendWeeklyDayBeforeReminder();
    } else if (type === 'weekly' && timing === 'hour-before') {
      result = await reminders.sendWeeklyHourBeforeReminder();
    } else if (type === 'monthly' && timing === 'week-before') {
      result = await reminders.sendMonthlyWeekBeforeReminder();
    } else if (type === 'monthly' && timing === 'day-before') {
      result = await reminders.sendMonthlyDayBeforeReminder();
    } else if (type === 'monthly' && timing === 'day-of') {
      result = await reminders.sendMonthlyDayOfReminder();
    } else {
      return res.status(400).json({
        success: false,
        error: 'Invalid reminder type/timing',
        timestamp: new Date().toISOString(),
      });
    }

    res.json({
      success: result.success,
      data: result,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Reminder error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to send reminder',
      timestamp: new Date().toISOString(),
    });
  }
});

// ===========================================
// Status/Info Endpoints
// ===========================================

app.get('/api/status', (_req: Request, res: Response) => {
  res.json({
    success: true,
    data: {
      environment: env.NODE_ENV,
      configured: {
        zoom: !!env.ZOOM_WEBHOOK_SECRET,
        google: !!env.GOOGLE_REFRESH_TOKEN,
        activeCampaign: !!env.ACTIVECAMPAIGN_API_KEY,
        circle: !!env.CIRCLE_API_KEY,
        anthropic: !!env.ANTHROPIC_API_KEY,
        slack: !!(env.SLACK_BOT_TOKEN && env.SLACK_SIGNING_SECRET),
      },
    },
    timestamp: new Date().toISOString(),
  });
});

// Get upcoming scheduled calls from Zoom
app.get('/api/upcoming-calls', async (_req: Request, res: Response) => {
  try {
    const reminders = await import('./workflows/pre-call-reminder.js');
    const status = await reminders.getUpcomingCallsStatus();

    res.json({
      success: true,
      data: {
        upcomingCalls: status.upcomingCalls.map(call => ({
          id: call.id,
          topic: call.topic,
          type: call.type,
          startTime: call.startTime.toISOString(),
          startTimeLocal: call.startTime.toLocaleString('en-US', {
            timeZone: 'America/New_York',
            weekday: 'long',
            month: 'long',
            day: 'numeric',
            year: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
          }),
        })),
        nextWeeklyCall: status.nextWeeklyCall ? {
          topic: status.nextWeeklyCall.topic,
          startTime: status.nextWeeklyCall.startTime.toISOString(),
          startTimeLocal: status.nextWeeklyCall.startTime.toLocaleString('en-US', {
            timeZone: 'America/New_York',
            weekday: 'long',
            month: 'long',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
          }),
        } : null,
        nextMonthlyCall: status.nextMonthlyCall ? {
          topic: status.nextMonthlyCall.topic,
          startTime: status.nextMonthlyCall.startTime.toISOString(),
          startTimeLocal: status.nextMonthlyCall.startTime.toLocaleString('en-US', {
            timeZone: 'America/New_York',
            weekday: 'long',
            month: 'long',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
          }),
        } : null,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Failed to fetch upcoming calls:', errorMessage);
    res.status(500).json({
      success: false,
      error: `Failed to fetch upcoming calls: ${errorMessage}`,
      timestamp: new Date().toISOString(),
    });
  }
});

// ===========================================
// Slack Endpoints
// ===========================================

// Slack event subscription endpoint (for DMs, channel messages, and thread replies)
app.post('/api/slack/events', async (req: Request, res: Response) => {
  try {
    const payload = req.body;

    // Handle URL verification challenge
    if (payload.type === 'url_verification') {
      console.log('Slack URL verification challenge received');
      return res.json({ challenge: payload.challenge });
    }

    // For signature verification, we need the raw body - skip for now since express.json() already parsed
    // In production, you'd use a custom middleware to preserve raw body
    const slack = await import('./services/slack.js');

    // Handle message events
    if (payload.event?.type === 'message') {
      const event = payload.event;

      // Skip bot messages and message_changed events
      if (event.bot_id || event.subtype) {
        return res.json({ ok: true });
      }

      // Handle DM messages (for reminder generation flow)
      if (event.channel_type === 'im' && !event.thread_ts) {
        console.log('Slack DM received for reminder generation');

        // Handle DM in background
        const reminderHandler = await import('./workflows/reminder-dm-handler.js');
        reminderHandler.handleUserDm(event).catch(err => {
          console.error('Error handling DM:', err);
        });
      }

      // Handle channel messages (for topic detection in #ca-pro)
      // This includes both regular messages AND thread replies in the channel
      if (event.channel_type === 'channel') {
        // Check if topic watcher is configured
        const topicWatcher = await import('./workflows/topic-watcher.js');
        if (topicWatcher.isTopicWatcherConfigured()) {
          // Process in background - topic watcher handles both regular and thread messages
          topicWatcher.handleChannelMessage(event).catch(err => {
            console.error('Error handling channel message for topic detection:', err);
          });
        }
      }

      // Handle thread replies in DMs (for edit requests)
      if (event.thread_ts && event.channel_type === 'im') {
        console.log('Slack DM thread reply received');

        // Handle edit request in background
        handleSlackThreadReply(event).catch(err => {
          console.error('Error handling thread reply:', err);
        });
      }
    }

    res.json({ ok: true });
  } catch (error) {
    console.error('Slack events error:', error);
    res.status(500).json({ error: 'Internal error' });
  }
});

// Slack interactions endpoint (button clicks and modal submissions)
app.post('/api/slack/interactions', express.urlencoded({ extended: true }), async (req: Request, res: Response) => {
  try {
    const payload = JSON.parse(req.body.payload);
    console.log('Slack interaction:', payload.type, payload.actions?.[0]?.action_id || payload.view?.callback_id);

    const slack = await import('./services/slack.js');
    const approvalHandler = await import('./workflows/approval-handler.js');
    const reminderHandler = await import('./workflows/reminder-dm-handler.js');

    // Handle button actions
    if (payload.type === 'block_actions') {
      const action = payload.actions[0];
      const actionId = action.action_id;
      const pendingId = action.value;

      // Weekly/Monthly selection buttons
      if (actionId === 'select_weekly' || actionId === 'select_monthly') {
        const callType = actionId === 'select_weekly' ? 'weekly' : 'monthly';
        const topic = action.value;

        // Update the original message to show selection made
        await slack.updateMessage(
          payload.channel.id,
          payload.message.ts,
          `✅ Selected: ${callType === 'weekly' ? 'Weekly' : 'Monthly'} call for "${topic}"`
        );

        // Handle the selection in background
        reminderHandler.handleCallTypeSelection(
          payload.channel.id,
          payload.user.id,
          topic,
          callType,
          payload.trigger_id
        ).catch(err => {
          console.error('Error handling call type selection:', err);
        });

        return res.json({ ok: true });
      }

      // Cancel button
      if (actionId === 'cancel_reminder') {
        await reminderHandler.handleCancelReminder(
          payload.channel.id,
          payload.message.ts
        );
        return res.json({ ok: true });
      }

      // Generate reminders from detected topic (topic watcher)
      if (actionId === 'generate_reminders_from_topic') {
        try {
          const { topic, callType } = JSON.parse(action.value);

          // Update the message to show we're processing
          await slack.updateMessage(
            payload.channel.id,
            payload.message.ts,
            `✅ Generating ${callType} reminders for "${topic}"...`
          );

          // Generate reminders
          reminderHandler.handleCallTypeSelection(
            payload.channel.id,
            payload.user.id,
            topic,
            callType,
            payload.trigger_id
          ).catch(err => {
            console.error('Error generating reminders from topic:', err);
          });
        } catch (err) {
          console.error('Error parsing topic data:', err);
        }
        return res.json({ ok: true });
      }

      // Edit topic before generating (topic watcher)
      if (actionId === 'edit_topic_before_generate') {
        try {
          const { topic, callType } = JSON.parse(action.value);

          // Open a modal to edit the topic
          const editTopicModal = {
            type: 'modal',
            callback_id: 'edit_topic_modal',
            private_metadata: JSON.stringify({ callType }),
            title: {
              type: 'plain_text',
              text: 'Edit Topic',
              emoji: true,
            },
            submit: {
              type: 'plain_text',
              text: 'Generate Reminders',
              emoji: true,
            },
            close: {
              type: 'plain_text',
              text: 'Cancel',
              emoji: true,
            },
            blocks: [
              {
                type: 'input',
                block_id: 'topic_input_block',
                label: {
                  type: 'plain_text',
                  text: 'Topic',
                  emoji: true,
                },
                element: {
                  type: 'plain_text_input',
                  action_id: 'topic_input',
                  initial_value: topic,
                  placeholder: {
                    type: 'plain_text',
                    text: 'Enter the call topic...',
                  },
                },
              },
              {
                type: 'section',
                text: {
                  type: 'mrkdwn',
                  text: `*Call Type:* ${callType === 'weekly' ? 'Weekly Training' : 'Monthly Business Owner'}`,
                },
              },
            ],
          };

          await slack.openModal(payload.trigger_id, editTopicModal);
        } catch (err) {
          console.error('Error opening edit topic modal:', err);
        }
        return res.json({ ok: true });
      }

      // Ignore detected topic
      if (actionId === 'ignore_detected_topic') {
        await slack.updateMessage(
          payload.channel.id,
          payload.message.ts,
          '🚫 Topic ignored.'
        );
        return res.json({ ok: true });
      }

      // Set Message button - open modal
      if (actionId === 'set_message') {
        const result = await approvalHandler.handleSetMessage(
          pendingId,
          payload.trigger_id
        );

        if (!result.success) {
          await slack.postMessage(
            payload.channel.id,
            `⚠️ Could not open edit modal: ${result.error}`,
            undefined,
            undefined,
            payload.message.ts
          );
        }

        return res.json({ ok: true });
      }

      // Approve Email button
      if (actionId === 'approve_email') {
        const result = await approvalHandler.handleEmailApproval(
          pendingId,
          payload.channel.id,
          payload.message.ts
        );

        if (!result.success) {
          await slack.postMessage(
            payload.channel.id,
            `⚠️ Email send failed: ${result.error}`,
            undefined,
            undefined,
            payload.message.ts
          );
        }

        return res.json({ ok: true });
      }

      // Approve Circle button
      if (actionId === 'approve_circle') {
        const result = await approvalHandler.handleCircleApproval(
          pendingId,
          payload.channel.id,
          payload.message.ts
        );

        if (!result.success) {
          await slack.postMessage(
            payload.channel.id,
            `⚠️ Circle post failed: ${result.error}`,
            undefined,
            undefined,
            payload.message.ts
          );
        }

        return res.json({ ok: true });
      }

      // Legacy edit_message button
      if (actionId === 'edit_message') {
        await slack.postMessage(
          payload.channel.id,
          'Reply to this thread with your edit request (e.g., "make it shorter" or "add their experience")',
          undefined,
          undefined,
          payload.message.ts
        );
        return res.json({ ok: true });
      }

      // Copy buttons (link buttons don't need server handling, but we can track them)
      if (actionId.startsWith('copy_')) {
        // These are URL buttons - clicking them opens the copy.html page
        // We could optionally track this or update the message to show "Copied"
        console.log(`Copy button clicked: ${actionId}`);
        return res.json({ ok: true });
      }
    }

    // Handle modal submissions
    if (payload.type === 'view_submission') {
      const callbackId = payload.view.callback_id;

      if (callbackId === 'set_message_modal') {
        // Get the new message content from the modal
        const values = payload.view.state.values;
        const newMessage = values.message_input_block?.message_input?.value || '';

        // Get the metadata
        const metadata = JSON.parse(payload.view.private_metadata);

        // Handle the modal submission
        const result = await approvalHandler.handleModalSubmission(
          metadata.pendingId,
          newMessage,
          metadata
        );

        if (!result.success) {
          // Return an error to show in the modal
          return res.json({
            response_action: 'errors',
            errors: {
              message_input_block: result.error || 'Failed to update message',
            },
          });
        }

        // Close the modal (empty response)
        return res.json({});
      }

      // Handle edit topic modal submission (from topic watcher)
      if (callbackId === 'edit_topic_modal') {
        const values = payload.view.state.values;
        const topic = values.topic_input_block?.topic_input?.value || '';
        const metadata = JSON.parse(payload.view.private_metadata);
        const callType = metadata.callType || 'weekly';

        if (!topic.trim()) {
          return res.json({
            response_action: 'errors',
            errors: {
              topic_input_block: 'Please enter a topic',
            },
          });
        }

        // Open DM channel with user and generate reminders
        const userChannel = await slack.openDmChannel(payload.user.id);

        // Post a message that we're generating
        await slack.postMessage(
          userChannel,
          `✅ Generating ${callType} reminders for "${topic}"...`
        );

        // Generate reminders in background
        reminderHandler.handleCallTypeSelection(
          userChannel,
          payload.user.id,
          topic.trim(),
          callType,
          '' // No trigger_id needed since we're posting directly
        ).catch(err => {
          console.error('Error generating reminders from edited topic:', err);
        });

        // Close the modal
        return res.json({});
      }
    }

    res.json({ ok: true });
  } catch (error) {
    console.error('Slack interactions error:', error);
    res.status(500).json({ error: 'Internal error' });
  }
});

// Send recap to Slack admin
app.post('/api/slack/send-recap', async (req: Request, res: Response) => {
  try {
    const slack = await import('./services/slack.js');

    if (!slack.isSlackConfigured()) {
      return res.status(400).json({
        success: false,
        error: 'Slack not configured',
        timestamp: new Date().toISOString(),
      });
    }

    const { callType, topic, description, keyTakeaways, circleUrl, youtubeUrl, callDate } = req.body;

    if (!callType || !topic || !description || !circleUrl) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields',
        timestamp: new Date().toISOString(),
      });
    }

    const result = await slack.sendRecapToAdmin(
      callType,
      callDate ? new Date(callDate) : new Date(),
      topic,
      description,
      keyTakeaways || [],
      circleUrl,
      youtubeUrl || circleUrl
    );

    res.json({
      success: true,
      data: result,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Send recap error:', errorMessage);
    res.status(500).json({
      success: false,
      error: errorMessage,
      timestamp: new Date().toISOString(),
    });
  }
});

// List Slack users
app.get('/api/slack/users', async (_req: Request, res: Response) => {
  try {
    const slack = await import('./services/slack.js');

    if (!slack.isSlackConfigured()) {
      return res.status(400).json({
        success: false,
        error: 'Slack not configured',
        timestamp: new Date().toISOString(),
      });
    }

    const users = await slack.listUsers();

    res.json({
      success: true,
      data: users,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('List users error:', errorMessage);
    res.status(500).json({
      success: false,
      error: errorMessage,
      timestamp: new Date().toISOString(),
    });
  }
});

// Topic watcher status
app.get('/api/slack/topic-watcher', async (_req: Request, res: Response) => {
  try {
    const topicWatcher = await import('./workflows/topic-watcher.js');
    const status = topicWatcher.getTopicWatcherStatus();

    res.json({
      success: true,
      data: status,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({
      success: false,
      error: errorMessage,
      timestamp: new Date().toISOString(),
    });
  }
});

// Manual test for topic detection (for debugging)
app.post('/api/slack/test-topic-detection', async (req: Request, res: Response) => {
  try {
    const { message } = req.body;

    if (!message) {
      return res.status(400).json({
        success: false,
        error: 'message field required',
        timestamp: new Date().toISOString(),
      });
    }

    const claude = await import('./services/claude.js');
    const result = await claude.detectTopicInMessage(message);

    res.json({
      success: true,
      data: result,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({
      success: false,
      error: errorMessage,
      timestamp: new Date().toISOString(),
    });
  }
});

// Helper function to handle thread replies (edit requests)
async function handleSlackThreadReply(event: {
  channel: string;
  thread_ts: string;
  text: string;
  user: string;
  ts: string;
}) {
  try {
    const slack = await import('./services/slack.js');
    const claude = await import('./services/claude.js');

    // Get thread history to find the original message
    const threadMessages = await slack.getThreadReplies(event.channel, event.thread_ts);
    const originalMessage = threadMessages[0];

    if (!originalMessage) {
      console.error('Could not find original message');
      return;
    }

    // Get the original message with metadata
    const fullMessage = await slack.getMessage(event.channel, event.thread_ts);
    const metadata = (fullMessage as Record<string, unknown>)?.metadata as { event_payload?: Record<string, unknown> } | undefined;

    if (!metadata?.event_payload) {
      // No metadata, can't do smart edit - just acknowledge
      await slack.postMessage(
        event.channel,
        "I couldn't find the original context. Please try again.",
        undefined,
        undefined,
        event.thread_ts
      );
      return;
    }

    // Use Claude to edit the message
    const editRequest = event.text;
    const originalContent = metadata.event_payload;

    const editPrompt = `You are editing a WhatsApp message for CA Pro training.

Original message context:
- Topic: ${originalContent.topic}
- Description: ${originalContent.description}
- Circle URL: ${originalContent.circleUrl}

User's edit request: "${editRequest}"

Generate ONLY the new WhatsApp message text. Keep it concise and mobile-friendly. Include emojis. Format:
🎬 New CA Pro [Weekly/Monthly] Training Available!

📚 [Topic]

[Description - keep it 1-2 sentences]

🔗 Watch now: [URL]`;

    const response = await claude.generateCallSummary(editPrompt, 'Edit Request');
    const editedMessage = response.description || 'Could not generate edited message';

    // Build the copy URL for the edited message
    const encodedMessage = encodeURIComponent(editedMessage);
    const baseUrl = env.RAILWAY_PUBLIC_DOMAIN
      ? `https://${env.RAILWAY_PUBLIC_DOMAIN}`
      : 'https://autoweeklymonthlycalls-production.up.railway.app';
    const copyUrl = `${baseUrl}/copy.html?text=${encodedMessage}`;

    // Post the edited version in thread
    await slack.postMessage(
      event.channel,
      editedMessage,
      [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '*Edited version:*',
          },
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: editedMessage,
          },
        },
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: {
                type: 'plain_text',
                text: '📋 Copy This Version',
                emoji: true,
              },
              url: copyUrl,
              action_id: 'copy_edited',
            },
          ],
        },
      ],
      undefined,
      event.thread_ts
    );
  } catch (error) {
    console.error('Error in handleSlackThreadReply:', error);
  }
}

// ===========================================
// Error Handler
// ===========================================

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    success: false,
    error: config.isDev ? err.message : 'Internal server error',
    timestamp: new Date().toISOString(),
  });
});

// ===========================================
// Cron Jobs Setup (lazy loaded)
// ===========================================

async function setupCronJobs() {
  try {
    const cron = await import('node-cron');
    const { CRON_SCHEDULES } = await import('./config/schedule.js');
    const reminders = await import('./workflows/pre-call-reminder.js');

    console.log('Setting up cron jobs...');

    // Weekly day-before reminder: Monday 1 PM
    cron.default.schedule(CRON_SCHEDULES.weeklyDayBefore, async () => {
      console.log('Cron: Weekly day-before reminder');
      await reminders.sendWeeklyDayBeforeReminder();
    }, { timezone: env.TIMEZONE });

    // Weekly hour-before reminder: Tuesday 12 PM
    cron.default.schedule(CRON_SCHEDULES.weeklyHourBefore, async () => {
      console.log('Cron: Weekly hour-before reminder');
      await reminders.sendWeeklyHourBeforeReminder();
    }, { timezone: env.TIMEZONE });

    // Monthly week-before check: Monday 9 AM
    cron.default.schedule(CRON_SCHEDULES.monthlyWeekBefore, async () => {
      console.log('Cron: Monthly week-before check');
      await reminders.sendMonthlyWeekBeforeReminder();
    }, { timezone: env.TIMEZONE });

    // Monthly day-before check: Sunday 1 PM
    cron.default.schedule(CRON_SCHEDULES.monthlyDayBefore, async () => {
      console.log('Cron: Monthly day-before check');
      await reminders.sendMonthlyDayBeforeReminder();
    }, { timezone: env.TIMEZONE });

    // Monthly day-of check: Monday 1 PM
    cron.default.schedule(CRON_SCHEDULES.monthlyDayOf, async () => {
      console.log('Cron: Monthly day-of check');
      await reminders.sendMonthlyDayOfReminder();
    }, { timezone: env.TIMEZONE });

    console.log('Cron jobs configured');
  } catch (error) {
    console.error('Failed to setup cron jobs:', error);
  }
}

// ===========================================
// Start Server
// ===========================================

const PORT = config.port;

app.listen(PORT, () => {
  console.log('===========================================');
  console.log('CA Pro Call Automation System');
  console.log('===========================================');
  console.log(`Server running on port ${PORT}`);
  console.log(`Environment: ${env.NODE_ENV}`);
  console.log('');
  console.log('Endpoints:');
  console.log(`  GET  /health - Health check`);
  console.log(`  POST /webhooks/zoom - Zoom webhook receiver`);
  console.log(`  POST /api/process-call?meetingId=XXX - Manual trigger`);
  console.log(`  POST /api/reminders/:type/:timing - Manual reminder triggers`);
  console.log(`  GET  /api/status - System status`);
  console.log(`  GET  /api/upcoming-calls - Upcoming Zoom calls`);
  console.log('');
  console.log('Slack Bot Flow:');
  console.log(`  POST /api/slack/events - DM + channel + thread handlers`);
  console.log(`  POST /api/slack/interactions - Buttons + modals`);
  console.log(`  POST /api/slack/send-recap - Send recap to admin`);
  console.log(`  GET  /api/slack/users - List Slack users`);
  console.log(`  GET  /api/slack/topic-watcher - Topic watcher status`);
  console.log(`  POST /api/slack/test-topic-detection - Test topic detection`);
  console.log('');
  console.log('Bot Features:');
  console.log(`  - DM topic -> generates Weekly/Monthly reminders`);
  console.log(`  - #ca-pro channel watcher -> detects Stefan's topic announcements`);
  console.log(`  - Auto-recap after Zoom -> Circle/WhatsApp/Email approval`);
  console.log(`  - Set Message modal for custom edits`);
  console.log('===========================================');

  // Setup cron jobs after server starts (non-blocking)
  setupCronJobs();
});

export default app;
