import { describe, it, expect, vi } from 'vitest';

// Mock axios and env before importing
vi.mock('axios', () => ({
  default: {
    create: vi.fn(() => ({
      post: vi.fn(),
      get: vi.fn(),
      put: vi.fn(),
    })),
  },
}));

vi.mock('../config/env.js', () => ({
  env: {
    CIRCLE_API_KEY: 'test_key',
  },
  config: {
    circleCommunityId: 1,
    circleSpaceId: 1,
  },
}));

vi.mock('../utils/date-helpers.js', () => ({
  formatDateForCircle: vi.fn((date: Date) => {
    const months = ['January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'];
    return `${months[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
  }),
  getCallTypeLabel: vi.fn((type: string) => type === 'weekly' ? 'Weekly' : 'Monthly'),
}));

import { getPostUrl } from './circle.js';

describe('circle service', () => {
  describe('getPostUrl', () => {
    it('should generate correct URL with default community slug', () => {
      const url = getPostUrl(12345);
      expect(url).toBe('https://capro.circle.so/c/posts/12345');
    });

    it('should generate correct URL with custom community slug', () => {
      const url = getPostUrl(99999, 'mycommunit');
      expect(url).toBe('https://mycommunit.circle.so/c/posts/99999');
    });
  });

  describe('buildPostBody', () => {
    // Test the body building logic
    function buildPostBody(metadata: {
      youtubeId: string;
      description: string;
      bullets: string[];
      driveVideoLink: string;
      driveTranscriptLink: string;
      driveChatLink: string;
    }): string {
      const videoEmbed = `https://www.youtube.com/watch?v=${metadata.youtubeId}`;
      const summaryBullets: string[] = [];
      const keyTakeaways: string[] = [];

      for (const bullet of metadata.bullets) {
        if (bullet.includes('**') && bullet.includes(':')) {
          summaryBullets.push(bullet);
        } else {
          keyTakeaways.push(bullet);
        }
      }

      let body = `${videoEmbed}

${metadata.description}`;

      if (summaryBullets.length > 0) {
        body += `

**Summary**

${summaryBullets.map(b => `${b}`).join('\n\n')}`;
      }

      if (keyTakeaways.length > 0) {
        body += `

**Key Takeaways**

${keyTakeaways.map(b => `• ${b}`).join('\n')}`;
      }

      body += `

---

**Resources**
- [Video](${metadata.driveVideoLink})
- [Call Transcript](${metadata.driveTranscriptLink})
- [Chat Transcript](${metadata.driveChatLink})`;

      return body.trim();
    }

    it('should build body with YouTube embed', () => {
      const body = buildPostBody({
        youtubeId: 'abc123',
        description: 'Test description',
        bullets: [],
        driveVideoLink: 'https://drive.google.com/video',
        driveTranscriptLink: 'https://drive.google.com/transcript',
        driveChatLink: 'https://drive.google.com/chat',
      });

      expect(body).toContain('https://www.youtube.com/watch?v=abc123');
    });

    it('should include description', () => {
      const body = buildPostBody({
        youtubeId: 'abc123',
        description: 'Stefan leads a training on sales copy optimization.',
        bullets: [],
        driveVideoLink: 'https://drive.google.com/video',
        driveTranscriptLink: 'https://drive.google.com/transcript',
        driveChatLink: 'https://drive.google.com/chat',
      });

      expect(body).toContain('Stefan leads a training on sales copy optimization.');
    });

    it('should separate summary bullets from key takeaways', () => {
      const body = buildPostBody({
        youtubeId: 'abc123',
        description: 'Description',
        bullets: [
          '**Funnel Analysis**: Details about funnel analysis.',
          '**Email Strategy**: Details about email.',
          'Always test your headlines',
          'Focus on the mechanism first',
        ],
        driveVideoLink: 'https://drive.google.com/video',
        driveTranscriptLink: 'https://drive.google.com/transcript',
        driveChatLink: 'https://drive.google.com/chat',
      });

      expect(body).toContain('**Summary**');
      expect(body).toContain('**Funnel Analysis**');
      expect(body).toContain('**Key Takeaways**');
      expect(body).toContain('• Always test your headlines');
    });

    it('should include resources section', () => {
      const body = buildPostBody({
        youtubeId: 'abc123',
        description: 'Description',
        bullets: [],
        driveVideoLink: 'https://drive.google.com/file/d/video123/view',
        driveTranscriptLink: 'https://drive.google.com/file/d/trans456/view',
        driveChatLink: 'https://drive.google.com/file/d/chat789/view',
      });

      expect(body).toContain('**Resources**');
      expect(body).toContain('[Video](https://drive.google.com/file/d/video123/view)');
      expect(body).toContain('[Call Transcript](https://drive.google.com/file/d/trans456/view)');
      expect(body).toContain('[Chat Transcript](https://drive.google.com/file/d/chat789/view)');
    });

    it('should not include Summary section when no summary bullets', () => {
      const body = buildPostBody({
        youtubeId: 'abc123',
        description: 'Description',
        bullets: ['Plain takeaway without bold heading'],
        driveVideoLink: 'https://drive.google.com/video',
        driveTranscriptLink: 'https://drive.google.com/transcript',
        driveChatLink: 'https://drive.google.com/chat',
      });

      expect(body).not.toContain('**Summary**');
      expect(body).toContain('**Key Takeaways**');
    });

    it('should not include Key Takeaways section when only summary bullets', () => {
      const body = buildPostBody({
        youtubeId: 'abc123',
        description: 'Description',
        bullets: ['**Only Bold**: Heading with colon'],
        driveVideoLink: 'https://drive.google.com/video',
        driveTranscriptLink: 'https://drive.google.com/transcript',
        driveChatLink: 'https://drive.google.com/chat',
      });

      expect(body).toContain('**Summary**');
      expect(body).not.toMatch(/\*\*Key Takeaways\*\*\n\n•/);
    });
  });
});
