import type { ZoomTranscript, ZoomTranscriptSegment } from '../types/index.js';

// Phrases that indicate non-substantive speech (waiting room chat)
const SKIP_PHRASES = [
  'hi',
  'hello',
  'hey',
  'hey everyone',
  'hi everyone',
  'hello everyone',
  'can you hear me',
  'can everyone hear me',
  'one second',
  'just a moment',
  'just a sec',
  'hold on',
  'give me a second',
  'waiting for',
  'we\'ll wait',
  'let\'s wait',
  'good morning',
  'good afternoon',
  'how\'s everyone',
  'how is everyone',
  'thanks for joining',
  'thank you for joining',
];

// Minimum word count for "substantive" speech
const MIN_SUBSTANTIVE_WORDS = 5;

// Buffer time before the detected start (in seconds)
const START_BUFFER_SECONDS = 2;

/**
 * Parse a VTT transcript file into structured segments
 */
export function parseVttTranscript(vttContent: string): ZoomTranscriptSegment[] {
  const segments: ZoomTranscriptSegment[] = [];
  const lines = vttContent.split('\n');

  let currentSegment: Partial<ZoomTranscriptSegment> | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Skip WEBVTT header and empty lines
    if (line === 'WEBVTT' || line === '' || /^\d+$/.test(line)) {
      continue;
    }

    // Parse timestamp line: "00:00:00.000 --> 00:00:05.000"
    const timestampMatch = line.match(
      /(\d{2}):(\d{2}):(\d{2})\.(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})\.(\d{3})/
    );

    if (timestampMatch) {
      // Save previous segment if exists
      if (currentSegment?.text) {
        segments.push(currentSegment as ZoomTranscriptSegment);
      }

      const startTime =
        parseInt(timestampMatch[1]) * 3600 +
        parseInt(timestampMatch[2]) * 60 +
        parseInt(timestampMatch[3]) +
        parseInt(timestampMatch[4]) / 1000;

      const endTime =
        parseInt(timestampMatch[5]) * 3600 +
        parseInt(timestampMatch[6]) * 60 +
        parseInt(timestampMatch[7]) +
        parseInt(timestampMatch[8]) / 1000;

      currentSegment = {
        speaker_name: 'Unknown',
        start_time: startTime,
        end_time: endTime,
        text: '',
      };
      continue;
    }

    // Parse speaker and text: "Speaker Name: Text content"
    if (currentSegment) {
      const speakerMatch = line.match(/^(.+?):\s*(.+)$/);
      if (speakerMatch) {
        currentSegment.speaker_name = speakerMatch[1].trim();
        currentSegment.text = speakerMatch[2].trim();
      } else if (line) {
        // Continuation of previous text
        currentSegment.text = (currentSegment.text ? currentSegment.text + ' ' : '') + line;
      }
    }
  }

  // Don't forget the last segment
  if (currentSegment?.text) {
    segments.push(currentSegment as ZoomTranscriptSegment);
  }

  return segments;
}

/**
 * Check if a piece of text is substantive (not just greetings/waiting room chat)
 */
export function isSubstantiveText(text: string): boolean {
  const lowerText = text.toLowerCase().trim();
  const words = lowerText.split(/\s+/).filter(w => w.length > 0);

  // Must have minimum words
  if (words.length < MIN_SUBSTANTIVE_WORDS) {
    return false;
  }

  // Check if it starts with a skip phrase
  for (const phrase of SKIP_PHRASES) {
    if (lowerText.startsWith(phrase)) {
      return false;
    }
  }

  // Check if the entire text is just a greeting variant
  const greetingVariants = ['hi', 'hello', 'hey', 'good morning', 'good afternoon'];
  if (greetingVariants.some(g => lowerText === g || lowerText === g + '!')) {
    return false;
  }

  return true;
}

/**
 * Find the timestamp where real conversation starts
 * Returns seconds from the start of the video
 */
export function findConversationStart(transcript: ZoomTranscript): number {
  for (const segment of transcript.segments) {
    if (isSubstantiveText(segment.text)) {
      // Return time with buffer, but never negative
      return Math.max(0, segment.start_time - START_BUFFER_SECONDS);
    }
  }

  // If no substantive text found, start from beginning
  return 0;
}

/**
 * Create a ZoomTranscript object from VTT content
 */
export function createTranscriptFromVtt(vttContent: string, meetingId: string): ZoomTranscript {
  const segments = parseVttTranscript(vttContent);
  const fullText = segments.map(s => `${s.speaker_name}: ${s.text}`).join('\n');

  return {
    meeting_id: meetingId,
    segments,
    full_text: fullText,
  };
}

/**
 * Extract plain text from transcript for AI summarization
 */
export function extractPlainText(transcript: ZoomTranscript): string {
  return transcript.segments
    .map(s => `${s.speaker_name}: ${s.text}`)
    .join('\n\n');
}

/**
 * Get transcript duration in seconds
 */
export function getTranscriptDuration(transcript: ZoomTranscript): number {
  if (transcript.segments.length === 0) {
    return 0;
  }
  const lastSegment = transcript.segments[transcript.segments.length - 1];
  return lastSegment.end_time;
}
