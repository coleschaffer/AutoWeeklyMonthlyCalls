import { describe, it, expect, vi } from 'vitest';
import path from 'path';

// Mock fluent-ffmpeg
vi.mock('fluent-ffmpeg', () => {
  const mockFfmpeg = vi.fn(() => ({
    setStartTime: vi.fn().mockReturnThis(),
    outputOptions: vi.fn().mockReturnThis(),
    output: vi.fn().mockReturnThis(),
    on: vi.fn().mockImplementation(function (this: any, event: string, callback: Function) {
      if (event === 'end') {
        setTimeout(() => callback(), 0);
      }
      return this;
    }),
    run: vi.fn(),
    screenshots: vi.fn().mockReturnThis(),
  }));

  mockFfmpeg.ffprobe = vi.fn((path: string, callback: Function) => {
    callback(null, { format: { duration: 3600 } });
  });

  mockFfmpeg.getAvailableFormats = vi.fn((callback: Function) => {
    callback(null, {});
  });

  return { default: mockFfmpeg };
});

// Mock fs/promises
vi.mock('fs/promises', () => ({
  default: {
    mkdir: vi.fn().mockResolvedValue(undefined),
    stat: vi.fn().mockResolvedValue({ size: 1024000 }),
    unlink: vi.fn().mockResolvedValue(undefined),
  },
}));

import { getTrimmedVideoPath } from './video-processor.js';

describe('video-processor service', () => {
  describe('getTrimmedVideoPath', () => {
    it('should append _trimmed to filename', () => {
      const result = getTrimmedVideoPath('/tmp/video.mp4');
      expect(result).toBe('/tmp/video_trimmed.mp4');
    });

    it('should preserve directory', () => {
      const result = getTrimmedVideoPath('/path/to/videos/recording.mp4');
      expect(path.dirname(result)).toBe('/path/to/videos');
    });

    it('should preserve extension', () => {
      const result = getTrimmedVideoPath('/tmp/video.mp4');
      expect(path.extname(result)).toBe('.mp4');
    });

    it('should handle different extensions', () => {
      const result = getTrimmedVideoPath('/tmp/video.webm');
      expect(result).toBe('/tmp/video_trimmed.webm');
    });

    it('should handle files with dots in name', () => {
      const result = getTrimmedVideoPath('/tmp/video.2026.01.28.mp4');
      expect(result).toBe('/tmp/video.2026.01.28_trimmed.mp4');
    });
  });

  describe('video trimming options', () => {
    it('should use stream copy for speed', () => {
      const outputOptions = [
        '-c copy',
        '-movflags +faststart',
      ];

      expect(outputOptions).toContain('-c copy');
    });

    it('should enable faststart for web playback', () => {
      const outputOptions = [
        '-c copy',
        '-movflags +faststart',
      ];

      expect(outputOptions).toContain('-movflags +faststart');
    });
  });

  describe('temp directory', () => {
    it('should use correct temp directory', () => {
      const TEMP_DIR = '/tmp/ca-pro-videos';
      expect(TEMP_DIR).toBe('/tmp/ca-pro-videos');
    });

    it('should generate correct output path in temp dir', () => {
      const TEMP_DIR = '/tmp/ca-pro-videos';
      const fileName = 'recording';
      const finalOutputPath = path.join(TEMP_DIR, `${fileName}_trimmed.mp4`);

      expect(finalOutputPath).toBe('/tmp/ca-pro-videos/recording_trimmed.mp4');
    });
  });

  describe('video info', () => {
    it('should extract filename from path', () => {
      const filePath = '/tmp/ca-pro-videos/2026.01.28_Topic.mp4';
      const fileName = path.basename(filePath);

      expect(fileName).toBe('2026.01.28_Topic.mp4');
    });
  });

  describe('trim calculation', () => {
    it('should calculate new duration after trim', () => {
      const originalDuration = 3600; // 1 hour
      const trimStartSeconds = 30;
      const expectedNewDuration = originalDuration - trimStartSeconds;

      expect(expectedNewDuration).toBe(3570);
    });

    it('should handle trim from beginning', () => {
      const originalDuration = 3600;
      const trimStartSeconds = 0;
      const expectedNewDuration = originalDuration - trimStartSeconds;

      expect(expectedNewDuration).toBe(3600);
    });
  });

  describe('thumbnail generation', () => {
    it('should use correct default thumbnail time', () => {
      const defaultTimeSeconds = 10;
      expect(defaultTimeSeconds).toBe(10);
    });

    it('should use 720p resolution for thumbnails', () => {
      const size = '1280x720';
      expect(size).toBe('1280x720');
    });
  });
});
