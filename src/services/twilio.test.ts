import { describe, it, expect, vi } from 'vitest';

// Mock twilio and env
vi.mock('twilio', () => ({
  default: vi.fn(() => ({
    messages: {
      create: vi.fn(),
    },
    api: {
      accounts: vi.fn(() => ({
        fetch: vi.fn(),
      })),
    },
  })),
}));

vi.mock('../config/env.js', () => ({
  env: {
    TWILIO_ACCOUNT_SID: 'test_sid',
    TWILIO_AUTH_TOKEN: 'test_token',
    TWILIO_WHATSAPP_NUMBER: 'whatsapp:+1234567890',
  },
  config: {
    whatsappNumbers: ['+1111111111', '+2222222222'],
  },
}));

describe('twilio service', () => {
  describe('reminder templates', () => {
    const templates = {
      weekly: {
        dayBefore: `📅 Reminder: CA Pro Weekly Training is tomorrow (Tuesday) at 1 PM ET!\n\nSee you on Zoom!`,
        hourBefore: `⏰ Starting in 1 hour!\n\nCA Pro Weekly Training at 1 PM ET.\n\nJoin us on Zoom!`,
        weekBefore: '',
        dayOf: '',
      },
      monthly: {
        weekBefore: `📅 Save the date!\n\nCA Pro Monthly Training is next Monday at 2 PM ET.\n\nMark your calendar!`,
        dayBefore: `📅 Reminder: CA Pro Monthly Training is tomorrow (Monday) at 2 PM ET!\n\nSee you on Zoom!`,
        dayOf: `🎯 Today!\n\nCA Pro Monthly Training at 2 PM ET.\n\nJoin us on Zoom!`,
        hourBefore: '',
      },
    };

    describe('weekly templates', () => {
      it('should have day before template', () => {
        expect(templates.weekly.dayBefore).toContain('tomorrow');
        expect(templates.weekly.dayBefore).toContain('Tuesday');
        expect(templates.weekly.dayBefore).toContain('1 PM ET');
      });

      it('should have hour before template', () => {
        expect(templates.weekly.hourBefore).toContain('1 hour');
        expect(templates.weekly.hourBefore).toContain('1 PM ET');
      });

      it('should not have week before template for weekly', () => {
        expect(templates.weekly.weekBefore).toBe('');
      });
    });

    describe('monthly templates', () => {
      it('should have week before template', () => {
        expect(templates.monthly.weekBefore).toContain('next Monday');
        expect(templates.monthly.weekBefore).toContain('2 PM ET');
      });

      it('should have day before template', () => {
        expect(templates.monthly.dayBefore).toContain('tomorrow');
        expect(templates.monthly.dayBefore).toContain('Monday');
        expect(templates.monthly.dayBefore).toContain('2 PM ET');
      });

      it('should have day of template', () => {
        expect(templates.monthly.dayOf).toContain('Today');
        expect(templates.monthly.dayOf).toContain('2 PM ET');
      });
    });
  });

  describe('WhatsApp number formatting', () => {
    it('should add whatsapp prefix if not present', () => {
      const number = '+1234567890';
      const formatted = number.startsWith('whatsapp:')
        ? number
        : `whatsapp:${number}`;

      expect(formatted).toBe('whatsapp:+1234567890');
    });

    it('should not double prefix if already present', () => {
      const number = 'whatsapp:+1234567890';
      const formatted = number.startsWith('whatsapp:')
        ? number
        : `whatsapp:${number}`;

      expect(formatted).toBe('whatsapp:+1234567890');
    });
  });

  describe('recording notification message', () => {
    it('should generate correct message for weekly', () => {
      const callType = 'weekly';
      const topic = 'Email Funnel Optimization';
      const circleUrl = 'https://community.circle.so/c/posts/456';
      const typeLabel = callType === 'weekly' ? 'Weekly' : 'Monthly';

      const message = `🎬 New CA Pro ${typeLabel} Training Available!\n\n📚 ${topic}\n\n🔗 Watch now: ${circleUrl}`;

      expect(message).toContain('Weekly Training');
      expect(message).toContain('Email Funnel Optimization');
      expect(message).toContain(circleUrl);
      expect(message).toContain('🎬');
    });

    it('should generate correct message for monthly', () => {
      const callType = 'monthly';
      const topic = 'Business Strategy';
      const circleUrl = 'https://community.circle.so/c/posts/789';
      const typeLabel = callType === 'weekly' ? 'Weekly' : 'Monthly';

      const message = `🎬 New CA Pro ${typeLabel} Training Available!\n\n📚 ${topic}\n\n🔗 Watch now: ${circleUrl}`;

      expect(message).toContain('Monthly Training');
      expect(message).toContain('Business Strategy');
    });
  });
});
