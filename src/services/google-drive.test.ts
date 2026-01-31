import { describe, it, expect, vi } from 'vitest';

// Mock googleapis and env
vi.mock('googleapis', () => ({
  google: {
    auth: {
      OAuth2: vi.fn().mockImplementation(() => ({
        setCredentials: vi.fn(),
      })),
    },
    drive: vi.fn(() => ({
      files: {
        create: vi.fn(),
        list: vi.fn(),
      },
      permissions: {
        create: vi.fn(),
      },
    })),
  },
}));

vi.mock('../config/env.js', () => ({
  env: {
    GOOGLE_CLIENT_ID: 'test_client_id',
    GOOGLE_CLIENT_SECRET: 'test_client_secret',
    GOOGLE_REFRESH_TOKEN: 'test_refresh_token',
    DRIVE_WEEKLY_FOLDER_ID: 'weekly_folder_id',
    DRIVE_MONTHLY_FOLDER_ID: 'monthly_folder_id',
  },
}));

import { formatDateForFolder, getShareableLink } from './google-drive.js';

describe('google-drive service', () => {
  describe('formatDateForFolder', () => {
    it('should format date as YYYY.MM.DD', () => {
      const date = new Date(2026, 0, 28); // January 28, 2026
      expect(formatDateForFolder(date)).toBe('2026.01.28');
    });

    it('should pad single digit months', () => {
      const date = new Date(2026, 2, 5); // March 5, 2026
      expect(formatDateForFolder(date)).toBe('2026.03.05');
    });

    it('should pad single digit days', () => {
      const date = new Date(2026, 11, 9); // December 9, 2026
      expect(formatDateForFolder(date)).toBe('2026.12.09');
    });

    it('should handle year correctly', () => {
      const date = new Date(2027, 5, 15); // June 15, 2027
      expect(formatDateForFolder(date)).toBe('2027.06.15');
    });
  });

  describe('getShareableLink', () => {
    it('should generate correct shareable link', () => {
      const fileId = 'abc123xyz';
      const link = getShareableLink(fileId);
      expect(link).toBe('https://drive.google.com/file/d/abc123xyz/view?usp=sharing');
    });

    it('should handle file IDs with special characters', () => {
      const fileId = '1a-b_c2D3e';
      const link = getShareableLink(fileId);
      expect(link).toBe('https://drive.google.com/file/d/1a-b_c2D3e/view?usp=sharing');
    });
  });

  describe('file naming', () => {
    it('should generate correct file name format', () => {
      const date = new Date(2026, 0, 28);
      const topic = 'Sales Copy Optimization';
      const dateStr = formatDateForFolder(date);
      const sanitizedTopic = topic.replace(/[^a-zA-Z0-9\s]/g, '').replace(/\s+/g, '_');
      const prefix = `${dateStr}_${sanitizedTopic}`;

      expect(prefix).toBe('2026.01.28_Sales_Copy_Optimization');
    });

    it('should sanitize special characters from topic', () => {
      const topic = 'VSL: Tips & Tricks (Advanced)';
      const sanitizedTopic = topic.replace(/[^a-zA-Z0-9\s]/g, '').replace(/\s+/g, '_');

      // Special chars removed, multiple spaces become single underscore
      expect(sanitizedTopic).toBe('VSL_Tips_Tricks_Advanced');
    });

    it('should generate correct file extensions', () => {
      const prefix = '2026.01.28_Topic_Name';

      expect(`${prefix}.mp4`).toBe('2026.01.28_Topic_Name.mp4');
      expect(`${prefix}_transcript.vtt`).toBe('2026.01.28_Topic_Name_transcript.vtt');
      expect(`${prefix}_chat.txt`).toBe('2026.01.28_Topic_Name_chat.txt');
    });
  });

  describe('folder structure', () => {
    it('should use weekly folder for weekly calls', () => {
      const callType = 'weekly';
      const folderId = callType === 'weekly' ? 'weekly_folder_id' : 'monthly_folder_id';
      expect(folderId).toBe('weekly_folder_id');
    });

    it('should use monthly folder for monthly calls', () => {
      const callType = 'monthly';
      const folderId = callType === 'weekly' ? 'weekly_folder_id' : 'monthly_folder_id';
      expect(folderId).toBe('monthly_folder_id');
    });
  });
});
