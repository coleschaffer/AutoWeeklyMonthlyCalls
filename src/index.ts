import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import cron from 'node-cron';
import { config, env } from './config/env.js';
import { CRON_SCHEDULES } from './config/schedule.js';
import {
  validateWebhook,
  handleUrlValidation,
} from './services/zoom.js';
import {
  processRecording,
  processRecordingManual,
} from './workflows/post-call-process.js';
import {
  sendWeeklyDayBeforeReminder,
  sendWeeklyHourBeforeReminder,
  sendMonthlyWeekBeforeReminder,
  sendMonthlyDayBeforeReminder,
  sendMonthlyDayOfReminder,
} from './workflows/pre-call-reminder.js';
import type { ApiResponse, ZoomWebhookPayload } from './types/index.js';

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
  const signature = req.headers['x-zm-signature'] as string;
  const timestamp = req.headers['x-zm-request-timestamp'] as string;

  // Handle URL validation challenge from Zoom
  if (req.body.event === 'endpoint.url_validation') {
    const plainToken = req.body.payload.plainToken;
    const response = handleUrlValidation(plainToken);
    console.log('Zoom URL validation challenge received');
    return res.json(response);
  }

  // Validate webhook signature
  const validation = validateWebhook(
    JSON.stringify(req.body),
    signature,
    timestamp
  );

  if (!validation.isValid) {
    console.error('Invalid Zoom webhook signature:', validation.error);
    return res.status(401).json({
      success: false,
      error: 'Invalid signature',
      timestamp: new Date().toISOString(),
    });
  }

  const payload = validation.payload as ZoomWebhookPayload;

  // Handle recording completed event
  if (payload.event === 'recording.completed') {
    console.log('Recording completed webhook received');
    console.log(`Meeting: ${payload.payload.object.topic}`);

    // Process asynchronously (don't block webhook response)
    processRecording(payload)
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

  // Process asynchronously
  processRecordingManual(meetingId)
    .then(result => {
      console.log(`Manual processing result:`, result);
    })
    .catch(error => {
      console.error('Manual processing error:', error);
    });

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

app.post('/api/reminders/weekly/day-before', async (_req: Request, res: Response) => {
  console.log('Manual trigger: Weekly day-before reminder');
  const result = await sendWeeklyDayBeforeReminder();
  res.json({
    success: result.success,
    data: result,
    timestamp: new Date().toISOString(),
  });
});

app.post('/api/reminders/weekly/hour-before', async (_req: Request, res: Response) => {
  console.log('Manual trigger: Weekly hour-before reminder');
  const result = await sendWeeklyHourBeforeReminder();
  res.json({
    success: result.success,
    data: result,
    timestamp: new Date().toISOString(),
  });
});

app.post('/api/reminders/monthly/week-before', async (_req: Request, res: Response) => {
  console.log('Manual trigger: Monthly week-before reminder');
  const result = await sendMonthlyWeekBeforeReminder();
  res.json({
    success: result.success,
    data: result,
    timestamp: new Date().toISOString(),
  });
});

app.post('/api/reminders/monthly/day-before', async (_req: Request, res: Response) => {
  console.log('Manual trigger: Monthly day-before reminder');
  const result = await sendMonthlyDayBeforeReminder();
  res.json({
    success: result.success,
    data: result,
    timestamp: new Date().toISOString(),
  });
});

app.post('/api/reminders/monthly/day-of', async (_req: Request, res: Response) => {
  console.log('Manual trigger: Monthly day-of reminder');
  const result = await sendMonthlyDayOfReminder();
  res.json({
    success: result.success,
    data: result,
    timestamp: new Date().toISOString(),
  });
});

// ===========================================
// Status/Info Endpoints
// ===========================================

app.get('/api/status', (_req: Request, res: Response) => {
  res.json({
    success: true,
    data: {
      environment: env.NODE_ENV,
      schedules: {
        weeklyCall: {
          day: config.weeklyCall.day,
          hour: config.weeklyCall.hour,
        },
        monthlyCall: {
          week: config.monthlyCall.week,
          day: config.monthlyCall.day,
          hour: config.monthlyCall.hour,
        },
      },
      cronJobs: CRON_SCHEDULES,
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
// Cron Jobs Setup
// ===========================================

function setupCronJobs() {
  console.log('Setting up cron jobs...');

  // Weekly day-before reminder: Monday 1 PM
  cron.schedule(CRON_SCHEDULES.weeklyDayBefore, async () => {
    console.log('Cron: Weekly day-before reminder');
    await sendWeeklyDayBeforeReminder();
  }, {
    timezone: env.TIMEZONE,
  });

  // Weekly hour-before reminder: Tuesday 12 PM
  cron.schedule(CRON_SCHEDULES.weeklyHourBefore, async () => {
    console.log('Cron: Weekly hour-before reminder');
    await sendWeeklyHourBeforeReminder();
  }, {
    timezone: env.TIMEZONE,
  });

  // Monthly week-before check: Monday 9 AM
  cron.schedule(CRON_SCHEDULES.monthlyWeekBefore, async () => {
    console.log('Cron: Monthly week-before check');
    await sendMonthlyWeekBeforeReminder();
  }, {
    timezone: env.TIMEZONE,
  });

  // Monthly day-before check: Sunday 1 PM
  cron.schedule(CRON_SCHEDULES.monthlyDayBefore, async () => {
    console.log('Cron: Monthly day-before check');
    await sendMonthlyDayBeforeReminder();
  }, {
    timezone: env.TIMEZONE,
  });

  // Monthly day-of check: Monday 1 PM
  cron.schedule(CRON_SCHEDULES.monthlyDayOf, async () => {
    console.log('Cron: Monthly day-of check');
    await sendMonthlyDayOfReminder();
  }, {
    timezone: env.TIMEZONE,
  });

  console.log('Cron jobs configured:');
  console.log(`  - Weekly day-before: ${CRON_SCHEDULES.weeklyDayBefore}`);
  console.log(`  - Weekly hour-before: ${CRON_SCHEDULES.weeklyHourBefore}`);
  console.log(`  - Monthly week-before: ${CRON_SCHEDULES.monthlyWeekBefore}`);
  console.log(`  - Monthly day-before: ${CRON_SCHEDULES.monthlyDayBefore}`);
  console.log(`  - Monthly day-of: ${CRON_SCHEDULES.monthlyDayOf}`);
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
  console.log(`Timezone: ${env.TIMEZONE}`);
  console.log('');

  // Setup cron jobs
  setupCronJobs();

  console.log('');
  console.log('Endpoints:');
  console.log(`  GET  /health - Health check`);
  console.log(`  POST /webhooks/zoom - Zoom webhook receiver`);
  console.log(`  POST /api/process-call?meetingId=XXX - Manual trigger`);
  console.log(`  POST /api/reminders/* - Manual reminder triggers`);
  console.log(`  GET  /api/status - System status`);
  console.log('===========================================');
});

export default app;
