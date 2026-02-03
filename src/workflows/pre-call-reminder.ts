import * as activeCampaign from '../services/activecampaign.js';
import * as zoom from '../services/zoom.js';
import { EMAIL_TEMPLATES } from '../config/schedule.js';
import { getCurrentTime } from '../utils/date-helpers.js';
import { addDays } from 'date-fns';
import type { CallType } from '../types/index.js';

type ReminderType = 'dayBefore' | 'hourBefore' | 'weekBefore' | 'dayOf';

interface ReminderResult {
  success: boolean;
  callType: CallType;
  reminderType: ReminderType;
  emailSent: boolean;
  scheduledCall?: {
    topic: string;
    startTime: Date;
  };
  errors: string[];
}

/**
 * Send weekly call reminder (day before - Monday)
 * Checks Zoom schedule for tomorrow's call
 */
export async function sendWeeklyDayBeforeReminder(): Promise<ReminderResult> {
  try {
    const tomorrowsCall = await zoom.getTomorrowsCall();

    if (!tomorrowsCall || tomorrowsCall.type !== 'weekly') {
      return {
        success: true,
        callType: 'weekly',
        reminderType: 'dayBefore',
        emailSent: false,
        errors: ['No weekly call scheduled for tomorrow in Zoom'],
      };
    }

    const result = await sendReminder('weekly', 'dayBefore');
    return {
      ...result,
      scheduledCall: {
        topic: tomorrowsCall.topic,
        startTime: tomorrowsCall.startTime,
      },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Failed to check Zoom schedule:', errorMessage);

    // Fallback: send reminder anyway if Zoom API fails
    console.log('Falling back to sending reminder without Zoom check');
    return sendReminder('weekly', 'dayBefore');
  }
}

/**
 * Send weekly call reminder (hour before - Tuesday)
 * Checks Zoom schedule for today's call
 */
export async function sendWeeklyHourBeforeReminder(): Promise<ReminderResult> {
  try {
    const meetings = await zoom.getUpcomingMeetings(1);
    const today = getCurrentTime();

    const todaysWeeklyCall = meetings.find(m => {
      const meetingDate = m.startTime;
      return m.type === 'weekly' &&
             meetingDate.getFullYear() === today.getFullYear() &&
             meetingDate.getMonth() === today.getMonth() &&
             meetingDate.getDate() === today.getDate();
    });

    if (!todaysWeeklyCall) {
      return {
        success: true,
        callType: 'weekly',
        reminderType: 'hourBefore',
        emailSent: false,
        errors: ['No weekly call scheduled for today in Zoom'],
      };
    }

    const result = await sendReminder('weekly', 'hourBefore');
    return {
      ...result,
      scheduledCall: {
        topic: todaysWeeklyCall.topic,
        startTime: todaysWeeklyCall.startTime,
      },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Failed to check Zoom schedule:', errorMessage);
    return sendReminder('weekly', 'hourBefore');
  }
}

/**
 * Send monthly call reminder (week before)
 * Checks if there's a monthly call scheduled within the next 7-10 days
 */
export async function sendMonthlyWeekBeforeReminder(): Promise<ReminderResult> {
  try {
    const meetings = await zoom.getUpcomingMeetings(10);
    const now = getCurrentTime();
    const weekFromNow = addDays(now, 7);

    // Find monthly call happening 5-10 days from now
    const upcomingMonthlyCall = meetings.find(m => {
      if (m.type !== 'monthly') return false;
      const daysUntil = Math.floor((m.startTime.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      return daysUntil >= 5 && daysUntil <= 10;
    });

    if (!upcomingMonthlyCall) {
      return {
        success: true,
        callType: 'monthly',
        reminderType: 'weekBefore',
        emailSent: false,
        errors: ['No monthly call scheduled within next week in Zoom'],
      };
    }

    const result = await sendReminder('monthly', 'weekBefore');
    return {
      ...result,
      scheduledCall: {
        topic: upcomingMonthlyCall.topic,
        startTime: upcomingMonthlyCall.startTime,
      },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Failed to check Zoom schedule:', errorMessage);
    return {
      success: false,
      callType: 'monthly',
      reminderType: 'weekBefore',
      emailSent: false,
      errors: [`Zoom API error: ${errorMessage}`],
    };
  }
}

/**
 * Send monthly call reminder (day before - Sunday)
 * Checks if there's a monthly call scheduled for tomorrow
 */
export async function sendMonthlyDayBeforeReminder(): Promise<ReminderResult> {
  try {
    const tomorrowsCall = await zoom.getTomorrowsCall();

    if (!tomorrowsCall || tomorrowsCall.type !== 'monthly') {
      return {
        success: true,
        callType: 'monthly',
        reminderType: 'dayBefore',
        emailSent: false,
        errors: ['No monthly call scheduled for tomorrow in Zoom'],
      };
    }

    const result = await sendReminder('monthly', 'dayBefore');
    return {
      ...result,
      scheduledCall: {
        topic: tomorrowsCall.topic,
        startTime: tomorrowsCall.startTime,
      },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Failed to check Zoom schedule:', errorMessage);
    return {
      success: false,
      callType: 'monthly',
      reminderType: 'dayBefore',
      emailSent: false,
      errors: [`Zoom API error: ${errorMessage}`],
    };
  }
}

/**
 * Send monthly call reminder (day of - Monday)
 * Checks if there's a monthly call scheduled for today
 */
export async function sendMonthlyDayOfReminder(): Promise<ReminderResult> {
  try {
    const meetings = await zoom.getUpcomingMeetings(1);
    const today = getCurrentTime();

    const todaysMonthlyCall = meetings.find(m => {
      const meetingDate = m.startTime;
      return m.type === 'monthly' &&
             meetingDate.getFullYear() === today.getFullYear() &&
             meetingDate.getMonth() === today.getMonth() &&
             meetingDate.getDate() === today.getDate();
    });

    if (!todaysMonthlyCall) {
      return {
        success: true,
        callType: 'monthly',
        reminderType: 'dayOf',
        emailSent: false,
        errors: ['No monthly call scheduled for today in Zoom'],
      };
    }

    const result = await sendReminder('monthly', 'dayOf');
    return {
      ...result,
      scheduledCall: {
        topic: todaysMonthlyCall.topic,
        startTime: todaysMonthlyCall.startTime,
      },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Failed to check Zoom schedule:', errorMessage);
    return {
      success: false,
      callType: 'monthly',
      reminderType: 'dayOf',
      emailSent: false,
      errors: [`Zoom API error: ${errorMessage}`],
    };
  }
}

/**
 * Core reminder sending function
 */
async function sendReminder(
  callType: CallType,
  reminderType: ReminderType
): Promise<ReminderResult> {
  const errors: string[] = [];
  let emailSent = false;

  // Get email template
  const emailTemplate =
    EMAIL_TEMPLATES[callType][reminderType as keyof (typeof EMAIL_TEMPLATES)[typeof callType]];

  // Send email
  if (emailTemplate) {
    console.log(`Sending ${callType} ${reminderType} email reminder...`);
    const emailResult = await activeCampaign.sendReminderEmail(
      emailTemplate.subject,
      emailTemplate.body,
      callType
    );

    if (emailResult.success) {
      emailSent = true;
      console.log(`Email sent successfully: ${emailResult.campaignId}`);
    } else {
      errors.push(`Email failed: ${emailResult.error}`);
      console.error(`Email failed: ${emailResult.error}`);
    }
  }

  return {
    success: errors.length === 0,
    callType,
    reminderType,
    emailSent,
    errors,
  };
}

/**
 * Run all reminder checks (called by cron)
 * Determines which reminders should be sent based on Zoom schedule
 */
export async function runReminderChecks(): Promise<ReminderResult[]> {
  const results: ReminderResult[] = [];
  const now = getCurrentTime();
  const dayOfWeek = now.getDay();
  const hour = now.getHours();

  // Monday checks
  if (dayOfWeek === 1) {
    // Weekly day-before reminder (1 PM Monday)
    if (hour === 13) {
      results.push(await sendWeeklyDayBeforeReminder());
    }

    // Monthly week-before check (9 AM Monday)
    if (hour === 9) {
      results.push(await sendMonthlyWeekBeforeReminder());
    }

    // Monthly day-of reminder (1 PM Monday)
    if (hour === 13) {
      results.push(await sendMonthlyDayOfReminder());
    }
  }

  // Tuesday - Weekly hour-before (12 PM)
  if (dayOfWeek === 2 && hour === 12) {
    results.push(await sendWeeklyHourBeforeReminder());
  }

  // Sunday - Monthly day-before (1 PM)
  if (dayOfWeek === 0 && hour === 13) {
    results.push(await sendMonthlyDayBeforeReminder());
  }

  return results;
}

/**
 * Get upcoming calls from Zoom (for debugging/status check)
 */
export async function getUpcomingCallsStatus(): Promise<{
  upcomingCalls: zoom.ScheduledMeeting[];
  nextWeeklyCall: zoom.ScheduledMeeting | null;
  nextMonthlyCall: zoom.ScheduledMeeting | null;
}> {
  const upcomingCalls = await zoom.getUpcomingMeetings(30);
  const nextWeeklyCall = await zoom.getNextScheduledCall('weekly');
  const nextMonthlyCall = await zoom.getNextScheduledCall('monthly');

  return {
    upcomingCalls,
    nextWeeklyCall,
    nextMonthlyCall,
  };
}
