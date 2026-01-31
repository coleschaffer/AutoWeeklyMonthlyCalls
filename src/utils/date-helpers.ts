import {
  format,
  getDay,
  getWeekOfMonth,
  addDays,
  startOfMonth,
  isSameDay,
  addWeeks,
  subWeeks,
  isMonday,
  nextMonday,
  differenceInWeeks,
  startOfDay,
} from 'date-fns';
import { toZonedTime, fromZonedTime } from 'date-fns-tz';
import { env } from '../config/env.js';

const TIMEZONE = env.TIMEZONE;

/**
 * Anchor date for monthly call 4-week cycle
 * Monthly calls occur every 4 weeks from this date
 */
export const MONTHLY_CALL_ANCHOR = new Date(2026, 1, 16); // February 16, 2026

/**
 * Get current time in the configured timezone
 */
export function getCurrentTime(): Date {
  return toZonedTime(new Date(), TIMEZONE);
}

/**
 * Convert a local time to UTC for scheduling
 */
export function toUtc(localDate: Date): Date {
  return fromZonedTime(localDate, TIMEZONE);
}

/**
 * Format a date for display in Circle posts
 * Example: "January 27, 2026"
 */
export function formatDateForCircle(date: Date): string {
  return format(date, 'MMMM d, yyyy');
}

/**
 * Format a date for file names
 * Example: "2026-01-27"
 */
export function formatDateForFile(date: Date): string {
  return format(date, 'yyyy-MM-dd');
}

/**
 * Get the nth occurrence of a specific weekday in a month
 * @param year - The year
 * @param month - The month (0-11)
 * @param weekday - Day of week (0=Sunday, 1=Monday, etc.)
 * @param n - Which occurrence (1=first, 2=second, etc.)
 */
export function getNthWeekdayOfMonth(
  year: number,
  month: number,
  weekday: number,
  n: number
): Date {
  const firstDayOfMonth = startOfMonth(new Date(year, month, 1));
  const firstDayWeekday = getDay(firstDayOfMonth);

  // Calculate days until the first occurrence of the target weekday
  let daysUntilFirst = weekday - firstDayWeekday;
  if (daysUntilFirst < 0) {
    daysUntilFirst += 7;
  }

  // Calculate the date of the nth occurrence
  const firstOccurrence = addDays(firstDayOfMonth, daysUntilFirst);
  return addWeeks(firstOccurrence, n - 1);
}

/**
 * Get the 4th Monday of the current month (legacy - kept for compatibility)
 * @deprecated Use getNextMonthlyCallDate or isMonthlyCallDay instead
 */
export function getFourthMondayOfMonth(date: Date = getCurrentTime()): Date {
  return getNthWeekdayOfMonth(date.getFullYear(), date.getMonth(), 1, 4);
}

/**
 * Check if a date falls on the monthly call 4-week cycle
 * Monthly calls occur every 4 weeks from the anchor date (Feb 16, 2026)
 */
export function isMonthlyCallDay(date: Date = getCurrentTime()): boolean {
  if (!isMonday(date)) {
    return false;
  }

  // Normalize both dates to start of day for comparison
  const normalizedDate = startOfDay(date);
  const normalizedAnchor = startOfDay(MONTHLY_CALL_ANCHOR);

  // Calculate weeks difference from anchor
  const weeksDiff = differenceInWeeks(normalizedDate, normalizedAnchor);

  // It's a monthly call day if the weeks difference is divisible by 4
  return weeksDiff % 4 === 0;
}

/**
 * Get the next monthly call date from a given date
 */
export function getNextMonthlyCallDate(date: Date = getCurrentTime()): Date {
  const normalizedDate = startOfDay(date);
  const normalizedAnchor = startOfDay(MONTHLY_CALL_ANCHOR);

  // Calculate weeks difference from anchor
  const weeksDiff = differenceInWeeks(normalizedDate, normalizedAnchor);

  // Find the next multiple of 4 weeks
  const weeksUntilNext = (4 - (weeksDiff % 4)) % 4;

  if (weeksUntilNext === 0 && isMonday(date)) {
    // If today is a monthly call day, return today
    return normalizedDate;
  }

  // Calculate the next monthly call date
  const nextCall = addWeeks(normalizedAnchor, Math.ceil(weeksDiff / 4) * 4);

  // If nextCall is before or same as date, add 4 more weeks
  if (nextCall <= normalizedDate) {
    return addWeeks(nextCall, 4);
  }

  return nextCall;
}

/**
 * Get the previous monthly call date from a given date
 */
export function getPreviousMonthlyCallDate(date: Date = getCurrentTime()): Date {
  const normalizedDate = startOfDay(date);
  const normalizedAnchor = startOfDay(MONTHLY_CALL_ANCHOR);

  const weeksDiff = differenceInWeeks(normalizedDate, normalizedAnchor);
  const prevWeeks = Math.floor(weeksDiff / 4) * 4;

  return addWeeks(normalizedAnchor, prevWeeks);
}

/**
 * Check if today is the 4th Monday of the month
 * @deprecated Use isMonthlyCallDay instead - this now uses 4-week cycle
 */
export function isFourthMonday(date: Date = getCurrentTime()): boolean {
  return isMonthlyCallDay(date);
}

/**
 * Check if tomorrow is a monthly call day
 */
export function isTomorrowMonthlyCall(date: Date = getCurrentTime()): boolean {
  const tomorrow = addDays(date, 1);
  return isMonthlyCallDay(tomorrow);
}

/**
 * Check if tomorrow is the 4th Monday of the month
 * @deprecated Use isTomorrowMonthlyCall instead
 */
export function isTomorrowFourthMonday(date: Date = getCurrentTime()): boolean {
  return isTomorrowMonthlyCall(date);
}

/**
 * Check if next week contains a monthly call day
 */
export function isNextWeekMonthlyCall(date: Date = getCurrentTime()): boolean {
  const nextWeekMonday = nextMonday(date);
  return isMonthlyCallDay(nextWeekMonday);
}

/**
 * Check if next week contains the 4th Monday
 * @deprecated Use isNextWeekMonthlyCall instead
 */
export function isNextWeekFourthMonday(date: Date = getCurrentTime()): boolean {
  return isNextWeekMonthlyCall(date);
}

/**
 * Get the week of month for a date (1-5)
 */
export function getWeekNumber(date: Date): number {
  return getWeekOfMonth(date);
}

/**
 * Check if a date is the day before a specific weekday
 * @param targetWeekday - 0=Sunday, 1=Monday, etc.
 */
export function isDayBefore(date: Date, targetWeekday: number): boolean {
  const dayOfWeek = getDay(date);
  const dayBefore = (targetWeekday - 1 + 7) % 7;
  return dayOfWeek === dayBefore;
}

/**
 * Check if today is Monday (day before Tuesday weekly call)
 */
export function isDayBeforeWeeklyCall(date: Date = getCurrentTime()): boolean {
  return isDayBefore(date, 2); // 2 = Tuesday
}

/**
 * Check if today is the day before a monthly call
 */
export function isDayBeforeMonthlyCall(date: Date = getCurrentTime()): boolean {
  return isTomorrowMonthlyCall(date);
}

/**
 * Get the call type label for formatting
 */
export function getCallTypeLabel(callType: 'weekly' | 'monthly'): string {
  return callType === 'weekly' ? 'Weekly' : 'Monthly';
}

/**
 * Generate a human-readable call title
 */
export function generateCallTitle(
  date: Date,
  callType: 'weekly' | 'monthly',
  topic: string
): string {
  const formattedDate = formatDateForCircle(date);
  const typeLabel = getCallTypeLabel(callType);
  return `${formattedDate} - CA Pro ${typeLabel} Training: ${topic}`;
}
