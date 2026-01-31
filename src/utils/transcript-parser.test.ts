import { describe, it, expect } from 'vitest';
import {
  parseVttTranscript,
  isSubstantiveText,
  findConversationStart,
  createTranscriptFromVtt,
  extractPlainText,
  getTranscriptDuration,
} from './transcript-parser.js';
import type { ZoomTranscript } from '../types/index.js';

describe('transcript-parser', () => {
  describe('parseVttTranscript', () => {
    it('should parse valid VTT content', () => {
      const vttContent = `WEBVTT

1
00:00:05.000 --> 00:00:10.000
Speaker One: Hello everyone, welcome to the call.

2
00:00:12.000 --> 00:00:20.000
Speaker Two: Thanks for having me, let's dive into the topic.`;

      const segments = parseVttTranscript(vttContent);

      expect(segments).toHaveLength(2);
      expect(segments[0].speaker_name).toBe('Speaker One');
      expect(segments[0].text).toBe('Hello everyone, welcome to the call.');
      expect(segments[0].start_time).toBe(5);
      expect(segments[0].end_time).toBe(10);
      expect(segments[1].speaker_name).toBe('Speaker Two');
    });

    it('should handle empty VTT content', () => {
      const segments = parseVttTranscript('WEBVTT\n\n');
      expect(segments).toHaveLength(0);
    });

    it('should parse timestamps correctly', () => {
      const vttContent = `WEBVTT

1
01:30:45.500 --> 01:31:00.250
Speaker: This is at 90 minutes.`;

      const segments = parseVttTranscript(vttContent);

      expect(segments[0].start_time).toBe(3600 + 1800 + 45 + 0.5); // 1h + 30m + 45s + 0.5s
      expect(segments[0].end_time).toBe(3600 + 1860 + 0.25); // 1h + 31m + 0.25s
    });
  });

  describe('isSubstantiveText', () => {
    it('should return false for greetings', () => {
      expect(isSubstantiveText('Hi')).toBe(false);
      expect(isSubstantiveText('Hello everyone')).toBe(false);
      expect(isSubstantiveText('Hey')).toBe(false);
      expect(isSubstantiveText('Good morning')).toBe(false);
    });

    it('should return false for short text', () => {
      expect(isSubstantiveText('Yes')).toBe(false);
      expect(isSubstantiveText('OK sure')).toBe(false);
      expect(isSubstantiveText('one two three')).toBe(false);
    });

    it('should return false for waiting room phrases', () => {
      expect(isSubstantiveText('Can you hear me everyone?')).toBe(false);
      expect(isSubstantiveText('One second let me share my screen')).toBe(false);
      expect(isSubstantiveText('Just a moment please')).toBe(false);
    });

    it('should return true for substantive content', () => {
      expect(isSubstantiveText('Today we are going to discuss the new marketing strategy for Q2')).toBe(true);
      expect(isSubstantiveText('The conversion rate increased by 25% after implementing the changes')).toBe(true);
      expect(isSubstantiveText('Let me walk you through the funnel breakdown step by step')).toBe(true);
    });
  });

  describe('findConversationStart', () => {
    it('should find the first substantive speech', () => {
      const transcript: ZoomTranscript = {
        meeting_id: 'test123',
        segments: [
          { speaker_name: 'Host', text: 'Hi everyone', start_time: 0, end_time: 2 },
          { speaker_name: 'Host', text: 'Can you hear me?', start_time: 5, end_time: 7 },
          { speaker_name: 'Host', text: 'Great, so today we are going to cover the new VSL framework', start_time: 15, end_time: 25 },
        ],
        full_text: '',
      };

      const startTime = findConversationStart(transcript);

      // Should be 2 seconds before the substantive speech (15 - 2 = 13)
      expect(startTime).toBe(13);
    });

    it('should return 0 if no substantive speech found', () => {
      const transcript: ZoomTranscript = {
        meeting_id: 'test123',
        segments: [
          { speaker_name: 'Host', text: 'Hi', start_time: 0, end_time: 1 },
          { speaker_name: 'Guest', text: 'Hello', start_time: 2, end_time: 3 },
        ],
        full_text: '',
      };

      expect(findConversationStart(transcript)).toBe(0);
    });

    it('should not return negative time', () => {
      const transcript: ZoomTranscript = {
        meeting_id: 'test123',
        segments: [
          { speaker_name: 'Host', text: 'Today we are going to cover the new marketing strategy in detail', start_time: 1, end_time: 5 },
        ],
        full_text: '',
      };

      const startTime = findConversationStart(transcript);
      expect(startTime).toBe(0); // 1 - 2 would be -1, but should clamp to 0
    });
  });

  describe('createTranscriptFromVtt', () => {
    it('should create a ZoomTranscript object', () => {
      const vttContent = `WEBVTT

1
00:00:00.000 --> 00:00:05.000
Speaker: Hello world.`;

      const transcript = createTranscriptFromVtt(vttContent, 'meeting123');

      expect(transcript.meeting_id).toBe('meeting123');
      expect(transcript.segments).toHaveLength(1);
      expect(transcript.full_text).toContain('Speaker: Hello world.');
    });
  });

  describe('extractPlainText', () => {
    it('should extract formatted text from transcript', () => {
      const transcript: ZoomTranscript = {
        meeting_id: 'test',
        segments: [
          { speaker_name: 'Alice', text: 'First message', start_time: 0, end_time: 5 },
          { speaker_name: 'Bob', text: 'Second message', start_time: 6, end_time: 10 },
        ],
        full_text: '',
      };

      const plainText = extractPlainText(transcript);

      expect(plainText).toContain('Alice: First message');
      expect(plainText).toContain('Bob: Second message');
    });
  });

  describe('getTranscriptDuration', () => {
    it('should return duration from last segment', () => {
      const transcript: ZoomTranscript = {
        meeting_id: 'test',
        segments: [
          { speaker_name: 'A', text: 'Hello', start_time: 0, end_time: 5 },
          { speaker_name: 'B', text: 'World', start_time: 10, end_time: 100 },
        ],
        full_text: '',
      };

      expect(getTranscriptDuration(transcript)).toBe(100);
    });

    it('should return 0 for empty transcript', () => {
      const transcript: ZoomTranscript = {
        meeting_id: 'test',
        segments: [],
        full_text: '',
      };

      expect(getTranscriptDuration(transcript)).toBe(0);
    });
  });
});
