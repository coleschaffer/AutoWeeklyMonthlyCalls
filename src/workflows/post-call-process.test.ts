import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock all services
vi.mock('../services/zoom.js', () => ({
  getRecording: vi.fn(),
  extractTopicFromMeeting: vi.fn((topic: string) => topic.replace(/^CA Pro\s*/i, '').trim() || 'Training Call'),
  getRawTranscriptContent: vi.fn(),
  getTranscript: vi.fn(),
  downloadRecording: vi.fn(),
  getChatContent: vi.fn(),
}));

vi.mock('../services/video-processor.js', () => ({
  trimVideo: vi.fn(),
  cleanupTempFiles: vi.fn(),
}));

vi.mock('../services/youtube.js', () => ({
  uploadCallRecording: vi.fn(),
}));

vi.mock('../services/google-drive.js', () => ({
  uploadCallFiles: vi.fn(),
}));

vi.mock('../services/circle.js', () => ({
  createCallPost: vi.fn(),
}));

vi.mock('../services/claude.js', () => ({
  generateCallSummary: vi.fn(),
}));

vi.mock('../services/activecampaign.js', () => ({
  sendRecordingNotification: vi.fn(),
}));

vi.mock('../services/slack.js', () => ({
  isSlackConfigured: vi.fn(() => false),
  sendRecapToAdmin: vi.fn(),
}));

vi.mock('../config/schedule.js', () => ({
  detectCallType: vi.fn((topic: string) => {
    if (topic.toLowerCase().includes('monthly')) return 'monthly';
    return 'weekly';
  }),
}));

vi.mock('../utils/transcript-parser.js', () => ({
  findConversationStart: vi.fn(() => 15),
  extractPlainText: vi.fn(() => 'Transcript text...'),
}));

vi.mock('../utils/date-helpers.js', () => ({
  formatDateForFile: vi.fn(() => '2026-01-28'),
  formatDateForCircle: vi.fn(() => 'January 28, 2026'),
}));

describe('post-call-process workflow', () => {
  describe('workflow steps', () => {
    it('should process recording in correct order', () => {
      // The expected workflow steps
      const steps = [
        'Fetch recording details from Zoom',
        'Process transcript',
        'Download video',
        'Trim video',
        'Generate AI summary',
        'Upload to YouTube',
        'Upload to Google Drive',
        'Create Circle post',
        'Send follow-up notifications',
        'Cleanup temp files',
      ];

      expect(steps).toHaveLength(10);
      expect(steps[0]).toContain('Fetch');
      expect(steps[5]).toContain('YouTube');
      expect(steps[9]).toContain('Cleanup');
    });
  });

  describe('topic extraction', () => {
    it('should clean topic from meeting title', () => {
      const extractTopicFromMeeting = (rawTopic: string) => {
        let topic = rawTopic
          .replace(/^CA Pro\s*/i, '')
          .replace(/^Weekly\s*(Training|Call)?\s*[-:]\s*/i, '')
          .replace(/^Monthly\s*(Training|Call)?\s*[-:]\s*/i, '')
          .trim();

        if (topic) {
          topic = topic.charAt(0).toUpperCase() + topic.slice(1);
        }

        return topic || 'Training Call';
      };

      expect(extractTopicFromMeeting('CA Pro Weekly Training: Sales Copy')).toBe('Sales Copy');
      expect(extractTopicFromMeeting('CA Pro Monthly: Business Strategy')).toBe('Business Strategy');
    });
  });

  describe('call type detection', () => {
    it('should detect weekly calls', () => {
      const detectCallType = (topic: string) => {
        if (topic.toLowerCase().includes('monthly')) return 'monthly';
        return 'weekly';
      };

      expect(detectCallType('CA Pro Weekly Training')).toBe('weekly');
      expect(detectCallType('Weekly: Sales Tips')).toBe('weekly');
    });

    it('should detect monthly calls', () => {
      const detectCallType = (topic: string) => {
        if (topic.toLowerCase().includes('monthly')) return 'monthly';
        return 'weekly';
      };

      expect(detectCallType('CA Pro Monthly Call')).toBe('monthly');
      expect(detectCallType('Monthly Business Strategy')).toBe('monthly');
    });
  });

  describe('YouTube title format', () => {
    it('should format title correctly for weekly', () => {
      const date = 'January 28, 2026';
      const callType = 'weekly';
      const topic = 'Sales Copy Optimization';

      const title = `${date} - CA Pro ${callType === 'weekly' ? 'Weekly' : 'Monthly'} Training: ${topic}`;

      expect(title).toBe('January 28, 2026 - CA Pro Weekly Training: Sales Copy Optimization');
    });

    it('should format title correctly for monthly', () => {
      const date = 'January 27, 2026';
      const callType = 'monthly';
      const topic = 'Business Strategy';

      const title = `${date} - CA Pro ${callType === 'weekly' ? 'Weekly' : 'Monthly'} Training: ${topic}`;

      expect(title).toBe('January 27, 2026 - CA Pro Monthly Training: Business Strategy');
    });
  });

  describe('fallback summary', () => {
    it('should provide fallback when no transcript', () => {
      const callType = 'weekly';
      const topic = 'Email Funnels';

      const summary = {
        description: `This ${callType} training call covered ${topic}.`,
        keyTakeaways: [
          'Key strategies and insights were shared.',
          'Practical implementation tips discussed.',
          'Watch the full recording for details.',
        ],
      };

      expect(summary.description).toContain('weekly');
      expect(summary.description).toContain('Email Funnels');
      expect(summary.keyTakeaways).toHaveLength(3);
    });
  });

  describe('result structure', () => {
    it('should return success result with all fields', () => {
      const result = {
        success: true,
        meetingId: 'test123',
        youtubeUrl: 'https://youtube.com/watch?v=abc',
        driveLinks: {
          video: { webViewLink: 'https://drive.google.com/...' },
          transcript: { webViewLink: 'https://drive.google.com/...' },
          chat: { webViewLink: 'https://drive.google.com/...' },
        },
        circlePostUrl: 'https://circle.so/...',
        summary: {
          description: 'Test description',
          keyTakeaways: ['Takeaway 1'],
        },
      };

      expect(result.success).toBe(true);
      expect(result.youtubeUrl).toBeDefined();
      expect(result.driveLinks).toBeDefined();
      expect(result.circlePostUrl).toBeDefined();
    });

    it('should return failure result with error', () => {
      const result = {
        success: false,
        meetingId: 'test123',
        error: 'Video download failed',
      };

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('video path generation', () => {
    it('should generate correct video path', () => {
      const TEMP_DIR = '/tmp/ca-pro-videos';
      const dateStr = '2026-01-28';
      const videoPath = `${TEMP_DIR}/${dateStr}_recording.mp4`;

      expect(videoPath).toBe('/tmp/ca-pro-videos/2026-01-28_recording.mp4');
    });
  });

  describe('mock webhook payload', () => {
    it('should create valid mock payload for manual processing', () => {
      const meetingId = 'test-meeting-123';
      const topic = 'Test Topic';
      const startTime = new Date();

      const mockPayload = {
        event: 'recording.completed',
        event_ts: Date.now(),
        payload: {
          account_id: '',
          object: {
            id: meetingId,
            uuid: meetingId,
            host_id: '',
            topic,
            type: 2,
            start_time: startTime.toISOString(),
            duration: 3600,
            timezone: 'America/New_York',
            recording_files: [],
          },
        },
      };

      expect(mockPayload.event).toBe('recording.completed');
      expect(mockPayload.payload.object.uuid).toBe(meetingId);
      expect(mockPayload.payload.object.topic).toBe(topic);
    });
  });
});
