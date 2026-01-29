import * as activeCampaign from '../services/activecampaign.js';
import * as twilio from '../services/twilio.js';
import { EMAIL_TEMPLATES, WHATSAPP_TEMPLATES } from '../config/schedule.js';
import {
  isDayBeforeWeeklyCall,
  isFourthMonday,
  isTomorrowFourthMonday,
  isNextWeekFourthMonday,
  getCurrentTime,
} from '../utils/date-helpers.js';
import type { CallType } from '../types/index.js';

type ReminderType = 'dayBefore' | 'hourBefore' | 'weekBefore' | 'dayOf';

interface ReminderResult {
  success: boolean;
  callType: CallType;
  reminderType: ReminderType;
  emailSent: boolean;
  whatsappSent: boolean;
  errors: string[];
}

/**
 * Send weekly call reminder (day before - Monday)
 */
export async function sendWeeklyDayBeforeReminder(): Promise<ReminderResult> {
  const now = getCurrentTime();

  if (!isDayBeforeWeeklyCall(now)) {
    return {
      success: true,
      callType: 'weekly',
      reminderType: 'dayBefore',
      emailSent: false,
      whatsappSent: false,
      errors: ['Not the day before weekly call'],
    };
  }

  return sendReminder('weekly', 'dayBefore');
}

/**
 * Send weekly call reminder (hour before - Tuesday)
 */
export async function sendWeeklyHourBeforeReminder(): Promise<ReminderResult> {
  // This is triggered by cron at 12 PM on Tuesday
  return sendReminder('weekly', 'hourBefore');
}

/**
 * Send monthly call reminder (week before)
 */
export async function sendMonthlyWeekBeforeReminder(): Promise<ReminderResult> {
  const now = getCurrentTime();

  if (!isNextWeekFourthMonday(now)) {
    return {
      success: true,
      callType: 'monthly',
      reminderType: 'weekBefore',
      emailSent: false,
      whatsappSent: false,
      errors: ['Next week is not the 4th Monday'],
    };
  }

  return sendReminder('monthly', 'weekBefore');
}

/**
 * Send monthly call reminder (day before - Sunday)
 */
export async function sendMonthlyDayBeforeReminder(): Promise<ReminderResult> {
  const now = getCurrentTime();

  if (!isTomorrowFourthMonday(now)) {
    return {
      success: true,
      callType: 'monthly',
      reminderType: 'dayBefore',
      emailSent: false,
      whatsappSent: false,
      errors: ['Tomorrow is not the 4th Monday'],
    };
  }

  return sendReminder('monthly', 'dayBefore');
}

/**
 * Send monthly call reminder (day of - 4th Monday)
 */
export async function sendMonthlyDayOfReminder(): Promise<ReminderResult> {
  const now = getCurrentTime();

  if (!isFourthMonday(now)) {
    return {
      success: true,
      callType: 'monthly',
      reminderType: 'dayOf',
      emailSent: false,
      whatsappSent: false,
      errors: ['Today is not the 4th Monday'],
    };
  }

  return sendReminder('monthly', 'dayOf');
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
  let whatsappSent = false;

  // Get templates
  const emailTemplate =
    EMAIL_TEMPLATES[callType][reminderType as keyof (typeof EMAIL_TEMPLATES)[typeof callType]];
  const whatsappMessage =
    WHATSAPP_TEMPLATES[callType][
      reminderType as keyof (typeof WHATSAPP_TEMPLATES)[typeof callType]
    ];

  // Send email
  if (emailTemplate) {
    console.log(`Sending ${callType} ${reminderType} email reminder...`);
    const emailResult = await activeCampaign.sendReminderEmail(
      emailTemplate.subject,
      emailTemplate.body
    );

    if (emailResult.success) {
      emailSent = true;
      console.log(`Email sent successfully: ${emailResult.campaignId}`);
    } else {
      errors.push(`Email failed: ${emailResult.error}`);
      console.error(`Email failed: ${emailResult.error}`);
    }
  }

  // Send WhatsApp
  if (whatsappMessage) {
    console.log(`Sending ${callType} ${reminderType} WhatsApp reminder...`);
    const whatsappResults = await twilio.sendReminder(callType, reminderType);

    const successCount = whatsappResults.filter(r => r.success).length;
    const failCount = whatsappResults.filter(r => !r.success).length;

    if (successCount > 0) {
      whatsappSent = true;
      console.log(`WhatsApp sent to ${successCount} recipients`);
    }

    if (failCount > 0) {
      const failedErrors = whatsappResults
        .filter(r => !r.success)
        .map(r => r.error)
        .join(', ');
      errors.push(`WhatsApp failed for ${failCount} recipients: ${failedErrors}`);
    }
  }

  return {
    success: errors.length === 0,
    callType,
    reminderType,
    emailSent,
    whatsappSent,
    errors,
  };
}

/**
 * Run all reminder checks (called by cron)
 * Determines which reminders should be sent based on current date/time
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
