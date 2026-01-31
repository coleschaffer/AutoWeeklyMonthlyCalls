import type { CallSchedule, CallType } from '../types/index.js';
import { config } from './env.js';

// Weekly call: Tuesday at 1 PM
export const WEEKLY_CALL_SCHEDULE: CallSchedule = {
  type: 'weekly',
  dayOfWeek: config.weeklyCall.day, // Tuesday (2)
  hour: config.weeklyCall.hour, // 1 PM
  minute: 0,
};

// Monthly call: Every 4 weeks (on Monday) at 2 PM
// Uses a 4-week cycle from anchor date (Feb 16, 2026), NOT "4th Monday of month"
export const MONTHLY_CALL_SCHEDULE: CallSchedule = {
  type: 'monthly',
  dayOfWeek: config.monthlyCall.day, // Monday (1)
  hour: config.monthlyCall.hour, // 2 PM
  minute: 0,
  weekOfMonth: config.monthlyCall.week, // Legacy - now uses 4-week cycle from anchor
};

// Cron expressions for reminders
export const CRON_SCHEDULES = {
  // Weekly reminders
  weeklyDayBefore: '0 13 * * 1', // Monday 1 PM (day before Tuesday call)
  weeklyHourBefore: '0 12 * * 2', // Tuesday 12 PM (hour before 1 PM call)

  // Monthly reminders - these run and check if it's a monthly call week (4-week cycle)
  monthlyWeekBefore: '0 9 * * 1', // Every Monday 9 AM - check if next week is monthly call
  monthlyDayBefore: '0 13 * * 0', // Every Sunday 1 PM - check if tomorrow is monthly call
  monthlyDayOf: '0 13 * * 1', // Every Monday 1 PM - check if today is monthly call
};

// Email templates
export const EMAIL_TEMPLATES = {
  weekly: {
    dayBefore: {
      subject: 'Reminder: CA Pro Weekly Training Tomorrow at 1 PM ET',
      body: `
Hi there!

Just a friendly reminder that our CA Pro Weekly Training call is tomorrow (Tuesday) at 1 PM ET.

Join us on Zoom to discuss strategies, get your questions answered, and connect with fellow team owners.

See you there!

Best,
The CA Pro Team
      `.trim(),
    },
    hourBefore: {
      subject: 'Starting Soon: CA Pro Weekly Training in 1 Hour',
      body: `
Hi there!

Our CA Pro Weekly Training call starts in just 1 hour at 1 PM ET.

Don't miss out - join us on Zoom!

See you soon!

Best,
The CA Pro Team
      `.trim(),
    },
  },
  monthly: {
    weekBefore: {
      subject: 'Save the Date: CA Pro Monthly Training Next Week',
      body: `
Hi there!

Mark your calendar - our CA Pro Monthly Training call is coming up next Monday at 2 PM ET.

This is our comprehensive monthly session for team owners and business owners. Come prepared with your questions!

See you next week!

Best,
The CA Pro Team
      `.trim(),
    },
    dayBefore: {
      subject: 'Reminder: CA Pro Monthly Training Tomorrow at 2 PM ET',
      body: `
Hi there!

Just a friendly reminder that our CA Pro Monthly Training call is tomorrow (Monday) at 2 PM ET.

This is our comprehensive monthly session - don't miss it!

See you there!

Best,
The CA Pro Team
      `.trim(),
    },
    dayOf: {
      subject: 'Today: CA Pro Monthly Training at 2 PM ET',
      body: `
Hi there!

Today's the day! Our CA Pro Monthly Training call is at 2 PM ET.

Join us on Zoom for this comprehensive monthly session.

See you soon!

Best,
The CA Pro Team
      `.trim(),
    },
  },
};

// Determine call type from meeting topic
export function detectCallType(topic: string): CallType {
  const lowerTopic = topic.toLowerCase();
  if (lowerTopic.includes('monthly')) {
    return 'monthly';
  }
  return 'weekly';
}
