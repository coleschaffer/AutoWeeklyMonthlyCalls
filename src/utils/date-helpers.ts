import {
  format,
  getDay,
  getWeekOfMonth,
  addDays,
  startOfMonth,
  isSameDay,
  addWeeks,
  isMonday,
  nextMonday,
} from 'date-fns';
import { toZonedTime, fromZonedTime } from 'date-fns-tz';
import { env } from '../config/env.js';

const TIMEZONE = env.TIMEZONE;

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
 * Get the 4th Monday of the current month
 */
export function getFourthMondayOfMonth(date: Date = getCurrentTime()): Date {
  return getNthWeekdayOfMonth(date.getFullYear(), date.getMonth(), 1, 4);
}

/**
 * Check if today is the 4th Monday of the month
 */
export function isFourthMonday(date: Date = getCurrentTime()): boolean {
  if (!isMonday(date)) {
    return false;
  }
  const fourthMonday = getFourthMondayOfMonth(date);
  return isSameDay(date, fourthMonday);
}

/**
 * Check if tomorrow is the 4th Monday of the month
 */
export function isTomorrowFourthMonday(date: Date = getCurrentTime()): boolean {
  const tomorrow = addDays(date, 1);
  return isFourthMonday(tomorrow);
}

/**
 * Check if next week contains the 4th Monday
 */
export function isNextWeekFourthMonday(date: Date = getCurrentTime()): boolean {
  const nextWeekMonday = nextMonday(date);
  return isFourthMonday(nextWeekMonday);
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
 * Check if today is Sunday (day before Monday monthly call)
 */
export function isDayBeforeMonthlyCall(date: Date = getCurrentTime()): boolean {
  return isTomorrowFourthMonday(date);
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
