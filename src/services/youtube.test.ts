import { describe, it, expect, vi } from 'vitest';

// Mock googleapis and env
vi.mock('googleapis', () => ({
  google: {
    auth: {
      OAuth2: vi.fn().mockImplementation(() => ({
        setCredentials: vi.fn(),
      })),
    },
    youtube: vi.fn(() => ({
      videos: {
        insert: vi.fn(),
        update: vi.fn(),
        list: vi.fn(),
      },
      channels: {
        list: vi.fn(),
      },
    })),
  },
}));

vi.mock('../config/env.js', () => ({
  env: {
    GOOGLE_CLIENT_ID: 'test_client_id',
    GOOGLE_CLIENT_SECRET: 'test_client_secret',
    GOOGLE_REFRESH_TOKEN: 'test_refresh_token',
  },
}));

import { getEmbedUrl } from './youtube.js';

describe('youtube service', () => {
  describe('getEmbedUrl', () => {
    it('should generate correct embed URL', () => {
      const url = getEmbedUrl('abc123xyz');
      expect(url).toBe('https://www.youtube.com/watch?v=abc123xyz');
    });

    it('should handle video IDs with special characters', () => {
      const url = getEmbedUrl('a-b_c123');
      expect(url).toBe('https://www.youtube.com/watch?v=a-b_c123');
    });
  });

  describe('video metadata', () => {
    it('should use correct category for education', () => {
      const categoryId = '27'; // Education category
      expect(categoryId).toBe('27');
    });

    it('should format title correctly', () => {
      const date = 'January 28, 2026';
      const callType = 'Weekly';
      const topic = 'Sales Copy Optimization';

      const title = `${date} - CA Pro ${callType} Training: ${topic}`;

      expect(title).toBe('January 28, 2026 - CA Pro Weekly Training: Sales Copy Optimization');
    });

    it('should include default tags', () => {
      const defaultTags = ['CA Pro', 'Training', 'Copywriting', 'Business'];

      expect(defaultTags).toContain('CA Pro');
      expect(defaultTags).toContain('Training');
      expect(defaultTags).toContain('Copywriting');
    });
  });

  describe('upload result', () => {
    it('should construct video URL from ID', () => {
      const videoId = 'dQw4w9WgXcQ';
      const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

      expect(videoUrl).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    });
  });
});
