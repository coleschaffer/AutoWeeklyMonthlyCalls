import axios from 'axios';
import crypto from 'crypto';
import { env } from '../config/env.js';
import type {
  ZoomWebhookPayload,
  ZoomRecordingData,
  ZoomTranscript,
  WebhookValidationResult,
} from '../types/index.js';
import { createTranscriptFromVtt } from '../utils/transcript-parser.js';

const ZOOM_API_BASE = 'https://api.zoom.us/v2';

let accessToken: string | null = null;
let tokenExpiry: number = 0;

/**
 * Get OAuth access token using Server-to-Server OAuth
 */
async function getAccessToken(): Promise<string> {
  if (accessToken && Date.now() < tokenExpiry) {
    return accessToken;
  }

  const credentials = Buffer.from(
    `${env.ZOOM_CLIENT_ID}:${env.ZOOM_CLIENT_SECRET}`
  ).toString('base64');

  const response = await axios.post(
    'https://zoom.us/oauth/token',
    new URLSearchParams({
      grant_type: 'account_credentials',
      account_id: env.ZOOM_ACCOUNT_ID,
    }),
    {
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    }
  );

  accessToken = response.data.access_token;
  // Set expiry 5 minutes before actual expiry for safety
  tokenExpiry = Date.now() + (response.data.expires_in - 300) * 1000;

  return accessToken!;
}

/**
 * Make authenticated request to Zoom API
 */
async function zoomRequest<T>(
  endpoint: string,
  method: 'GET' | 'POST' | 'DELETE' = 'GET',
  data?: unknown
): Promise<T> {
  const token = await getAccessToken();

  const response = await axios({
    method,
    url: `${ZOOM_API_BASE}${endpoint}`,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    data,
  });

  return response.data;
}

/**
 * Validate Zoom webhook signature
 */
export function validateWebhook(
  payload: string,
  signature: string,
  timestamp: string
): WebhookValidationResult {
  try {
    const message = `v0:${timestamp}:${payload}`;
    const hashForVerify = crypto
      .createHmac('sha256', env.ZOOM_WEBHOOK_SECRET)
      .update(message)
      .digest('hex');
    const expectedSignature = `v0=${hashForVerify}`;

    if (signature !== expectedSignature) {
      return { isValid: false, error: 'Invalid signature' };
    }

    const parsedPayload = JSON.parse(payload) as ZoomWebhookPayload;
    return { isValid: true, payload: parsedPayload };
  } catch (error) {
    return {
      isValid: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Handle Zoom webhook URL validation challenge
 */
export function handleUrlValidation(plainToken: string): { plainToken: string; encryptedToken: string } {
  const encryptedToken = crypto
    .createHmac('sha256', env.ZOOM_WEBHOOK_SECRET)
    .update(plainToken)
    .digest('hex');

  return { plainToken, encryptedToken };
}

/**
 * Get recording details for a meeting
 */
export async function getRecording(meetingId: string): Promise<ZoomRecordingData> {
  const data = await zoomRequest<{
    uuid: string;
    topic: string;
    start_time: string;
    duration: number;
    recording_files: Array<{
      file_type: string;
      download_url: string;
      recording_type: string;
    }>;
  }>(`/meetings/${encodeURIComponent(meetingId)}/recordings`);

  const videoFile = data.recording_files.find(
    f => f.file_type === 'MP4' && f.recording_type === 'shared_screen_with_speaker_view'
  ) || data.recording_files.find(f => f.file_type === 'MP4');

  const transcriptFile = data.recording_files.find(
    f => f.file_type === 'TRANSCRIPT' || f.recording_type === 'audio_transcript'
  );

  const chatFile = data.recording_files.find(f => f.file_type === 'CHAT');

  if (!videoFile) {
    throw new Error('No video file found in recording');
  }

  return {
    meetingId: data.uuid,
    topic: data.topic,
    startTime: new Date(data.start_time),
    duration: data.duration,
    videoUrl: videoFile.download_url,
    transcriptUrl: transcriptFile?.download_url,
    chatUrl: chatFile?.download_url,
  };
}

/**
 * Download and parse transcript
 */
export async function getTranscript(
  meetingId: string,
  transcriptUrl: string
): Promise<ZoomTranscript> {
  const token = await getAccessToken();

  const response = await axios.get(transcriptUrl, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
    responseType: 'text',
  });

  return createTranscriptFromVtt(response.data, meetingId);
}

/**
 * Get raw VTT transcript content (for uploading to Drive)
 */
export async function getRawTranscriptContent(transcriptUrl: string): Promise<string> {
  const token = await getAccessToken();

  const response = await axios.get(transcriptUrl, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
    responseType: 'text',
  });

  return response.data;
}

/**
 * Download recording file to local path
 */
export async function downloadRecording(
  downloadUrl: string,
  outputPath: string
): Promise<void> {
  const token = await getAccessToken();
  const fs = await import('fs');
  const { pipeline } = await import('stream/promises');

  const response = await axios({
    method: 'GET',
    url: downloadUrl,
    headers: {
      Authorization: `Bearer ${token}`,
    },
    responseType: 'stream',
  });

  await pipeline(response.data, fs.createWriteStream(outputPath));
}

/**
 * Download chat file content
 */
export async function getChatContent(chatUrl: string): Promise<string> {
  const token = await getAccessToken();

  const response = await axios.get(chatUrl, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
    responseType: 'text',
  });

  return response.data;
}

/**
 * Scheduled meeting from Zoom
 */
export interface ScheduledMeeting {
  id: string;
  topic: string;
  startTime: Date;
  duration: number;
  type: 'weekly' | 'monthly';
}

/**
 * List upcoming scheduled meetings
 * Fetches meetings from Zoom calendar to determine actual call schedule
 */
export async function getUpcomingMeetings(daysAhead: number = 14): Promise<ScheduledMeeting[]> {
  const data = await zoomRequest<{
    meetings: Array<{
      id: number;
      uuid: string;
      topic: string;
      start_time: string;
      duration: number;
      type: number;
    }>;
  }>('/users/me/meetings?type=upcoming&page_size=30');

  const now = new Date();
  const cutoffDate = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);

  return data.meetings
    .filter(meeting => {
      const startTime = new Date(meeting.start_time);
      // Filter to CA Pro calls only and within date range
      const isCaProCall = meeting.topic.toLowerCase().includes('ca pro') ||
                          meeting.topic.toLowerCase().includes('copy accelerator');
      return isCaProCall && startTime >= now && startTime <= cutoffDate;
    })
    .map(meeting => ({
      id: meeting.id.toString(),
      topic: meeting.topic,
      startTime: new Date(meeting.start_time),
      duration: meeting.duration,
      type: detectMeetingType(meeting.topic),
    }))
    .sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
}

/**
 * Get the next scheduled meeting of a specific type
 */
export async function getNextScheduledCall(
  callType: 'weekly' | 'monthly'
): Promise<ScheduledMeeting | null> {
  const meetings = await getUpcomingMeetings(30);
  return meetings.find(m => m.type === callType) || null;
}

/**
 * Check if there's a scheduled call on a specific date
 */
export async function hasScheduledCallOnDate(
  date: Date,
  callType?: 'weekly' | 'monthly'
): Promise<boolean> {
  const meetings = await getUpcomingMeetings(30);

  return meetings.some(meeting => {
    const meetingDate = meeting.startTime;
    const sameDay = meetingDate.getFullYear() === date.getFullYear() &&
                    meetingDate.getMonth() === date.getMonth() &&
                    meetingDate.getDate() === date.getDate();

    if (callType) {
      return sameDay && meeting.type === callType;
    }
    return sameDay;
  });
}

/**
 * Get scheduled call for tomorrow (if any)
 */
export async function getTomorrowsCall(): Promise<ScheduledMeeting | null> {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);

  const meetings = await getUpcomingMeetings(7);

  return meetings.find(meeting => {
    const meetingDate = meeting.startTime;
    return meetingDate.getFullYear() === tomorrow.getFullYear() &&
           meetingDate.getMonth() === tomorrow.getMonth() &&
           meetingDate.getDate() === tomorrow.getDate();
  }) || null;
}

/**
 * Get scheduled call for next week (Monday)
 */
export async function getNextWeeksCall(): Promise<ScheduledMeeting | null> {
  const now = new Date();
  const daysUntilNextMonday = (8 - now.getDay()) % 7 || 7;
  const nextMonday = new Date(now);
  nextMonday.setDate(now.getDate() + daysUntilNextMonday);

  const meetings = await getUpcomingMeetings(14);

  return meetings.find(meeting => {
    const meetingDate = meeting.startTime;
    return meetingDate.getFullYear() === nextMonday.getFullYear() &&
           meetingDate.getMonth() === nextMonday.getMonth() &&
           meetingDate.getDate() === nextMonday.getDate();
  }) || null;
}

/**
 * Detect meeting type from topic
 */
function detectMeetingType(topic: string): 'weekly' | 'monthly' {
  const lowerTopic = topic.toLowerCase();
  if (lowerTopic.includes('monthly') || lowerTopic.includes('business owner')) {
    return 'monthly';
  }
  return 'weekly';
}

/**
 * Extract meeting topic without "CA Pro" prefix for cleaner titles
 */
export function extractTopicFromMeeting(rawTopic: string): string {
  // Remove common prefixes
  let topic = rawTopic
    .replace(/^CA Pro\s*/i, '')
    .replace(/^Weekly\s*(Training|Call)?\s*[-:]\s*/i, '')
    .replace(/^Monthly\s*(Training|Call)?\s*[-:]\s*/i, '')
    .trim();

  // Capitalize first letter
  if (topic) {
    topic = topic.charAt(0).toUpperCase() + topic.slice(1);
  }

  return topic || 'Training Call';
}

// Meeting title patterns for matching
const WEEKLY_MEETING_PATTERNS = [
  'ca pro weekly training call',
  'ca pro weekly',
  'weekly training call',
  'copy accelerator weekly',
];

const MONTHLY_MEETING_PATTERNS = [
  'ca pro monthly business owners',
  'ca pro monthly business owner',
  'ca pro monthly',
  'monthly business owner',
  'copy accelerator monthly',
];

/**
 * Get the join URL for the next scheduled call by type
 * Matches meetings by title pattern
 */
export async function getJoinUrlForNextCall(
  callType: 'weekly' | 'monthly'
): Promise<{ joinUrl: string; startTime: Date; topic: string } | null> {
  const patterns = callType === 'weekly' ? WEEKLY_MEETING_PATTERNS : MONTHLY_MEETING_PATTERNS;

  try {
    // Get upcoming meetings
    const data = await zoomRequest<{
      meetings: Array<{
        id: number;
        uuid: string;
        topic: string;
        start_time: string;
        duration: number;
        type: number;
        join_url: string;
      }>;
    }>('/users/me/meetings?type=upcoming&page_size=50');

    const now = new Date();

    // Find the first matching meeting
    for (const meeting of data.meetings) {
      const meetingStartTime = new Date(meeting.start_time);

      // Skip past meetings
      if (meetingStartTime < now) continue;

      const lowerTopic = meeting.topic.toLowerCase();

      // Check if topic matches any pattern
      const matches = patterns.some(pattern => lowerTopic.includes(pattern));

      if (matches) {
        // Get full meeting details to ensure we have the join URL
        const meetingDetails = await getMeetingDetails(meeting.id);

        return {
          joinUrl: meetingDetails.join_url || meeting.join_url,
          startTime: meetingStartTime,
          topic: meeting.topic,
        };
      }
    }

    console.log(`No upcoming ${callType} meeting found matching patterns`);
    return null;
  } catch (error) {
    console.error(`Error fetching ${callType} meeting URL:`, error);
    return null;
  }
}

/**
 * Get detailed meeting information including join URL
 */
async function getMeetingDetails(meetingId: number): Promise<{
  id: number;
  topic: string;
  start_time: string;
  join_url: string;
  password?: string;
}> {
  return zoomRequest(`/meetings/${meetingId}`);
}

/**
 * Get meeting info with join URL for a specific date and call type
 */
export async function getMeetingForDate(
  date: Date,
  callType: 'weekly' | 'monthly'
): Promise<{ joinUrl: string; startTime: Date; topic: string } | null> {
  const patterns = callType === 'weekly' ? WEEKLY_MEETING_PATTERNS : MONTHLY_MEETING_PATTERNS;

  try {
    const data = await zoomRequest<{
      meetings: Array<{
        id: number;
        topic: string;
        start_time: string;
        join_url: string;
      }>;
    }>('/users/me/meetings?type=upcoming&page_size=50');

    for (const meeting of data.meetings) {
      const meetingDate = new Date(meeting.start_time);

      // Check if same day
      const sameDay =
        meetingDate.getFullYear() === date.getFullYear() &&
        meetingDate.getMonth() === date.getMonth() &&
        meetingDate.getDate() === date.getDate();

      if (!sameDay) continue;

      const lowerTopic = meeting.topic.toLowerCase();
      const matches = patterns.some(pattern => lowerTopic.includes(pattern));

      if (matches) {
        const meetingDetails = await getMeetingDetails(meeting.id);

        return {
          joinUrl: meetingDetails.join_url || meeting.join_url,
          startTime: meetingDate,
          topic: meeting.topic,
        };
      }
    }

    return null;
  } catch (error) {
    console.error(`Error fetching meeting for date:`, error);
    return null;
  }
}
