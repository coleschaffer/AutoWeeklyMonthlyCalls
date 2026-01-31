import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import crypto from 'crypto';
import { config, env } from './config/env.js';
import type { ApiResponse } from './types/index.js';

const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

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
        twilio: !!env.TWILIO_ACCOUNT_SID,
        circle: !!env.CIRCLE_API_KEY,
        anthropic: !!env.ANTHROPIC_API_KEY,
      },
    },
    timestamp: new Date().toISOString(),
  });
});

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
  console.log('===========================================');

  // Setup cron jobs after server starts (non-blocking)
  setupCronJobs();
});

export default app;
