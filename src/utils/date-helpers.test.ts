import { describe, it, expect } from 'vitest';
import {
  formatDateForCircle,
  formatDateForFile,
  getNthWeekdayOfMonth,
  getFourthMondayOfMonth,
  isMonthlyCallDay,
  getNextMonthlyCallDate,
  getPreviousMonthlyCallDate,
  isTomorrowMonthlyCall,
  isNextWeekMonthlyCall,
  isDayBefore,
  isDayBeforeWeeklyCall,
  getCallTypeLabel,
  generateCallTitle,
  MONTHLY_CALL_ANCHOR,
} from './date-helpers.js';

describe('date-helpers', () => {
  describe('formatDateForCircle', () => {
    it('should format date as "Month Day, Year"', () => {
      const date = new Date(2026, 0, 28); // January 28, 2026
      expect(formatDateForCircle(date)).toBe('January 28, 2026');
    });

    it('should handle different months', () => {
      expect(formatDateForCircle(new Date(2026, 11, 25))).toBe('December 25, 2026');
      expect(formatDateForCircle(new Date(2026, 5, 15))).toBe('June 15, 2026');
    });
  });

  describe('formatDateForFile', () => {
    it('should format date as "YYYY-MM-DD"', () => {
      const date = new Date(2026, 0, 28);
      expect(formatDateForFile(date)).toBe('2026-01-28');
    });

    it('should pad single digit months and days', () => {
      const date = new Date(2026, 2, 5); // March 5
      expect(formatDateForFile(date)).toBe('2026-03-05');
    });
  });

  describe('getNthWeekdayOfMonth', () => {
    it('should get the 1st Monday of January 2026', () => {
      const firstMonday = getNthWeekdayOfMonth(2026, 0, 1, 1);
      expect(firstMonday.getDate()).toBe(5); // Jan 5, 2026 is first Monday
      expect(firstMonday.getDay()).toBe(1); // Monday
    });

    it('should get the 4th Monday of January 2026', () => {
      const fourthMonday = getNthWeekdayOfMonth(2026, 0, 1, 4);
      expect(fourthMonday.getDate()).toBe(26); // Jan 26, 2026 is 4th Monday
      expect(fourthMonday.getDay()).toBe(1);
    });

    it('should get the 2nd Tuesday of February 2026', () => {
      const secondTuesday = getNthWeekdayOfMonth(2026, 1, 2, 2);
      expect(secondTuesday.getDay()).toBe(2); // Tuesday
    });
  });

  describe('getFourthMondayOfMonth (legacy)', () => {
    it('should return the 4th Monday of the given month', () => {
      const date = new Date(2026, 0, 15); // Mid-January
      const fourthMonday = getFourthMondayOfMonth(date);

      expect(fourthMonday.getDay()).toBe(1); // Monday
      expect(fourthMonday.getMonth()).toBe(0); // January
    });
  });

  describe('MONTHLY_CALL_ANCHOR', () => {
    it('should be February 16, 2026', () => {
      expect(MONTHLY_CALL_ANCHOR.getFullYear()).toBe(2026);
      expect(MONTHLY_CALL_ANCHOR.getMonth()).toBe(1); // February
      expect(MONTHLY_CALL_ANCHOR.getDate()).toBe(16);
    });

    it('should be a Monday', () => {
      expect(MONTHLY_CALL_ANCHOR.getDay()).toBe(1); // Monday
    });
  });

  describe('isMonthlyCallDay (4-week cycle)', () => {
    it('should return true for anchor date (Feb 16, 2026)', () => {
      const anchor = new Date(2026, 1, 16); // Feb 16, 2026
      expect(isMonthlyCallDay(anchor)).toBe(true);
    });

    it('should return true for 4 weeks after anchor (Mar 16, 2026)', () => {
      const fourWeeksLater = new Date(2026, 2, 16); // Mar 16, 2026
      expect(isMonthlyCallDay(fourWeeksLater)).toBe(true);
    });

    it('should return true for 8 weeks after anchor (Apr 13, 2026)', () => {
      const eightWeeksLater = new Date(2026, 3, 13); // Apr 13, 2026
      expect(isMonthlyCallDay(eightWeeksLater)).toBe(true);
    });

    it('should return true for 4 weeks before anchor (Jan 19, 2026)', () => {
      const fourWeeksBefore = new Date(2026, 0, 19); // Jan 19, 2026
      expect(isMonthlyCallDay(fourWeeksBefore)).toBe(true);
    });

    it('should return false for non-cycle Mondays', () => {
      const wrongMonday = new Date(2026, 1, 23); // Feb 23, 2026 (1 week after anchor)
      expect(isMonthlyCallDay(wrongMonday)).toBe(false);
    });

    it('should return false for 2 weeks off cycle', () => {
      const twoWeeksOff = new Date(2026, 2, 2); // Mar 2, 2026 (2 weeks after anchor)
      expect(isMonthlyCallDay(twoWeeksOff)).toBe(false);
    });

    it('should return false for non-Mondays', () => {
      const tuesday = new Date(2026, 1, 17); // Feb 17, 2026 (Tuesday)
      expect(isMonthlyCallDay(tuesday)).toBe(false);
    });

    it('should return false for Sunday before monthly call', () => {
      const sunday = new Date(2026, 1, 15); // Feb 15, 2026 (Sunday)
      expect(isMonthlyCallDay(sunday)).toBe(false);
    });
  });

  describe('getNextMonthlyCallDate', () => {
    it('should return anchor date when before anchor', () => {
      const beforeAnchor = new Date(2026, 0, 1); // Jan 1, 2026
      const nextCall = getNextMonthlyCallDate(beforeAnchor);
      expect(nextCall.getMonth()).toBe(0); // January
      expect(nextCall.getDate()).toBe(19); // Jan 19 is 4 weeks before anchor
    });

    it('should return same date when on a monthly call day', () => {
      const anchor = new Date(2026, 1, 16);
      const nextCall = getNextMonthlyCallDate(anchor);
      expect(nextCall.getDate()).toBe(16);
      expect(nextCall.getMonth()).toBe(1);
    });

    it('should return next cycle date when between calls', () => {
      const midCycle = new Date(2026, 1, 20); // Feb 20, 2026
      const nextCall = getNextMonthlyCallDate(midCycle);
      expect(nextCall.getMonth()).toBe(2); // March
      expect(nextCall.getDate()).toBe(16);
    });
  });

  describe('getPreviousMonthlyCallDate', () => {
    it('should return previous cycle date', () => {
      const midCycle = new Date(2026, 2, 10); // Mar 10, 2026
      const prevCall = getPreviousMonthlyCallDate(midCycle);
      expect(prevCall.getMonth()).toBe(1); // February
      expect(prevCall.getDate()).toBe(16);
    });
  });

  describe('isTomorrowMonthlyCall', () => {
    it('should return true on Sunday before monthly call', () => {
      const sundayBefore = new Date(2026, 1, 15); // Sunday Feb 15
      expect(isTomorrowMonthlyCall(sundayBefore)).toBe(true);
    });

    it('should return false on other days', () => {
      const saturday = new Date(2026, 1, 14); // Saturday Feb 14
      expect(isTomorrowMonthlyCall(saturday)).toBe(false);
    });

    it('should return false on Sunday before non-cycle Monday', () => {
      const wrongSunday = new Date(2026, 1, 22); // Sunday Feb 22
      expect(isTomorrowMonthlyCall(wrongSunday)).toBe(false);
    });
  });

  describe('isNextWeekMonthlyCall', () => {
    it('should return true when next Monday is monthly call', () => {
      const weekBefore = new Date(2026, 1, 10); // Tuesday Feb 10
      expect(isNextWeekMonthlyCall(weekBefore)).toBe(true);
    });

    it('should return false when next Monday is not monthly call', () => {
      const wrongWeek = new Date(2026, 1, 17); // Tuesday Feb 17
      expect(isNextWeekMonthlyCall(wrongWeek)).toBe(false);
    });
  });

  describe('isDayBefore', () => {
    it('should return true for Monday before Tuesday', () => {
      const monday = new Date(2026, 0, 5); // Monday
      expect(isDayBefore(monday, 2)).toBe(true); // 2 = Tuesday
    });

    it('should return true for Sunday before Monday', () => {
      const sunday = new Date(2026, 0, 4); // Sunday
      expect(isDayBefore(sunday, 1)).toBe(true); // 1 = Monday
    });

    it('should handle Saturday before Sunday', () => {
      const saturday = new Date(2026, 0, 3); // Saturday
      expect(isDayBefore(saturday, 0)).toBe(true); // 0 = Sunday
    });
  });

  describe('isDayBeforeWeeklyCall', () => {
    it('should return true on Monday (day before Tuesday call)', () => {
      const monday = new Date(2026, 0, 5);
      expect(isDayBeforeWeeklyCall(monday)).toBe(true);
    });

    it('should return false on other days', () => {
      const tuesday = new Date(2026, 0, 6);
      const wednesday = new Date(2026, 0, 7);
      expect(isDayBeforeWeeklyCall(tuesday)).toBe(false);
      expect(isDayBeforeWeeklyCall(wednesday)).toBe(false);
    });
  });

  describe('getCallTypeLabel', () => {
    it('should return "Weekly" for weekly calls', () => {
      expect(getCallTypeLabel('weekly')).toBe('Weekly');
    });

    it('should return "Monthly" for monthly calls', () => {
      expect(getCallTypeLabel('monthly')).toBe('Monthly');
    });
  });

  describe('generateCallTitle', () => {
    it('should generate correct title format', () => {
      const date = new Date(2026, 0, 28);
      const title = generateCallTitle(date, 'weekly', 'Sales Optimization');

      expect(title).toBe('January 28, 2026 - CA Pro Weekly Training: Sales Optimization');
    });

    it('should work for monthly calls', () => {
      const date = new Date(2026, 1, 16);
      const title = generateCallTitle(date, 'monthly', 'Business Strategy');

      expect(title).toBe('February 16, 2026 - CA Pro Monthly Training: Business Strategy');
    });
  });
});
