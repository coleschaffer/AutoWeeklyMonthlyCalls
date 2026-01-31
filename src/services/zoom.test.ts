import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';

// Mock the env module before importing zoom
vi.mock('../config/env.js', () => ({
  env: {
    ZOOM_ACCOUNT_ID: 'test_account',
    ZOOM_CLIENT_ID: 'test_client',
    ZOOM_CLIENT_SECRET: 'test_secret',
    ZOOM_WEBHOOK_SECRET: 'test_webhook_secret',
  },
}));

// Import after mocking
import {
  validateWebhook,
  handleUrlValidation,
  extractTopicFromMeeting,
} from './zoom.js';

describe('zoom service', () => {
  describe('validateWebhook', () => {
    const webhookSecret = 'test_webhook_secret';

    it('should validate a correct webhook signature', () => {
      const timestamp = Date.now().toString();
      const payload = JSON.stringify({
        event: 'recording.completed',
        payload: { meeting_id: '123' },
      });

      // Generate the correct signature
      const message = `v0:${timestamp}:${payload}`;
      const hash = crypto
        .createHmac('sha256', webhookSecret)
        .update(message)
        .digest('hex');
      const signature = `v0=${hash}`;

      const result = validateWebhook(payload, signature, timestamp);

      expect(result.isValid).toBe(true);
      expect(result.payload).toBeDefined();
      expect(result.payload?.event).toBe('recording.completed');
    });

    it('should reject an invalid signature', () => {
      const timestamp = Date.now().toString();
      const payload = JSON.stringify({ event: 'test' });
      const invalidSignature = 'v0=invalid_signature';

      const result = validateWebhook(payload, invalidSignature, timestamp);

      expect(result.isValid).toBe(false);
      expect(result.error).toBe('Invalid signature');
    });

    it('should handle malformed JSON payload', () => {
      const timestamp = Date.now().toString();
      const payload = 'not valid json';
      const signature = 'v0=some_signature';

      const result = validateWebhook(payload, signature, timestamp);

      expect(result.isValid).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('handleUrlValidation', () => {
    it('should return encrypted token for plain token', () => {
      const plainToken = 'test_plain_token_12345';

      const result = handleUrlValidation(plainToken);

      expect(result.plainToken).toBe(plainToken);
      expect(result.encryptedToken).toBeDefined();
      expect(result.encryptedToken).not.toBe(plainToken);
      expect(result.encryptedToken.length).toBe(64); // SHA-256 hex is 64 chars
    });

    it('should produce consistent encryption for same input', () => {
      const plainToken = 'consistent_test_token';

      const result1 = handleUrlValidation(plainToken);
      const result2 = handleUrlValidation(plainToken);

      expect(result1.encryptedToken).toBe(result2.encryptedToken);
    });

    it('should produce different encryption for different input', () => {
      const result1 = handleUrlValidation('token_a');
      const result2 = handleUrlValidation('token_b');

      expect(result1.encryptedToken).not.toBe(result2.encryptedToken);
    });
  });

  describe('extractTopicFromMeeting', () => {
    it('should remove CA Pro prefix', () => {
      expect(extractTopicFromMeeting('CA Pro Sales Training')).toBe('Sales Training');
      expect(extractTopicFromMeeting('CA pro weekly call')).toBe('Weekly call');
    });

    it('should remove Weekly Training prefix', () => {
      expect(extractTopicFromMeeting('Weekly Training: Sales Copy')).toBe('Sales Copy');
      expect(extractTopicFromMeeting('Weekly Training - Email Funnels')).toBe('Email Funnels');
      expect(extractTopicFromMeeting('Weekly: Advanced VSL')).toBe('Advanced VSL');
    });

    it('should remove Monthly Training prefix', () => {
      expect(extractTopicFromMeeting('Monthly Training: Business Strategy')).toBe('Business Strategy');
      expect(extractTopicFromMeeting('Monthly Call - Q&A Session')).toBe('Q&A Session');
    });

    it('should handle combined prefixes', () => {
      expect(extractTopicFromMeeting('CA Pro Weekly Training: Email Copy')).toBe('Email Copy');
      expect(extractTopicFromMeeting('CA Pro Monthly: Strategy Session')).toBe('Strategy Session');
    });

    it('should capitalize first letter', () => {
      expect(extractTopicFromMeeting('Weekly: email tips')).toBe('Email tips');
      expect(extractTopicFromMeeting('CA Pro sales strategies')).toBe('Sales strategies');
    });

    it('should return default for empty result', () => {
      expect(extractTopicFromMeeting('')).toBe('Training Call');
      expect(extractTopicFromMeeting('CA Pro')).toBe('Training Call');
      expect(extractTopicFromMeeting('Weekly Training:')).toBe('Training Call');
    });

    it('should preserve topic without prefix', () => {
      expect(extractTopicFromMeeting('VSL Framework Deep Dive')).toBe('VSL Framework Deep Dive');
      expect(extractTopicFromMeeting('Advanced Copywriting Techniques')).toBe('Advanced Copywriting Techniques');
    });
  });
});
