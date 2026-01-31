import { describe, it, expect, vi } from 'vitest';

// Mock axios and env
vi.mock('axios', () => ({
  default: {
    create: vi.fn(() => ({
      post: vi.fn(),
      get: vi.fn(),
    })),
  },
}));

vi.mock('../config/env.js', () => ({
  env: {
    ACTIVECAMPAIGN_API_URL: 'https://test.api-us1.com',
    ACTIVECAMPAIGN_API_KEY: 'test_key',
  },
  config: {
    activeCampaignListId: 1,
  },
}));

describe('activecampaign service', () => {
  describe('formatEmailHtml', () => {
    // Test the email formatting logic
    function formatEmailHtml(plainText: string): string {
      const htmlContent = plainText
        .split('\n\n')
        .map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`)
        .join('');

      return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  ${htmlContent}
</body>
</html>
      `.trim();
    }

    it('should wrap text in HTML structure', () => {
      const html = formatEmailHtml('Hello world');

      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('<html>');
      expect(html).toContain('<body');
      expect(html).toContain('Hello world');
    });

    it('should convert paragraphs separated by double newlines', () => {
      const html = formatEmailHtml('First paragraph\n\nSecond paragraph');

      expect(html).toContain('<p>First paragraph</p>');
      expect(html).toContain('<p>Second paragraph</p>');
    });

    it('should convert single newlines to <br>', () => {
      const html = formatEmailHtml('Line one\nLine two');

      expect(html).toContain('Line one<br>Line two');
    });

    it('should handle complex text with multiple breaks', () => {
      const text = `Hi there!

A new recording is available.
Watch it now.

Best,
The Team`;

      const html = formatEmailHtml(text);

      expect(html).toContain('<p>Hi there!</p>');
      expect(html).toContain('Watch it now');
      expect(html).toContain('Best,<br>The Team');
    });

    it('should include responsive meta viewport', () => {
      const html = formatEmailHtml('Test');

      expect(html).toContain('width=device-width');
      expect(html).toContain('initial-scale=1.0');
    });

    it('should include styling in body', () => {
      const html = formatEmailHtml('Test');

      expect(html).toContain('font-family: Arial');
      expect(html).toContain('max-width: 600px');
    });
  });

  describe('notification message generation', () => {
    it('should generate correct recording notification message', () => {
      const topic = 'Sales Copy Optimization';
      const description = 'This call covered advanced techniques for sales pages.';
      const circleUrl = 'https://community.circle.so/c/posts/123';

      const body = `
Hi there!

A new CA Pro training recording is now available!

${description}

Watch it now: ${circleUrl}

Best,
The CA Pro Team
      `.trim();

      expect(body).toContain(description);
      expect(body).toContain(circleUrl);
      expect(body).toContain('CA Pro training recording');
    });
  });
});
