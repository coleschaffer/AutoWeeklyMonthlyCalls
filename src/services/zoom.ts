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
