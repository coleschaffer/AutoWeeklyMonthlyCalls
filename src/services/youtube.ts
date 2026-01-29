import { google } from 'googleapis';
import fs from 'fs';
import { env } from '../config/env.js';
import type { YouTubeUploadMetadata, YouTubeUploadResult } from '../types/index.js';

const oauth2Client = new google.auth.OAuth2(
  env.GOOGLE_CLIENT_ID,
  env.GOOGLE_CLIENT_SECRET
);

// Set credentials using refresh token
oauth2Client.setCredentials({
  refresh_token: env.GOOGLE_REFRESH_TOKEN,
});

const youtube = google.youtube({ version: 'v3', auth: oauth2Client });

/**
 * Upload video to YouTube as unlisted
 */
export async function uploadVideo(
  videoPath: string,
  metadata: YouTubeUploadMetadata
): Promise<YouTubeUploadResult> {
  const fileStream = fs.createReadStream(videoPath);
  const fileSize = fs.statSync(videoPath).size;

  const response = await youtube.videos.insert({
    part: ['snippet', 'status'],
    requestBody: {
      snippet: {
        title: metadata.title,
        description: metadata.description,
        tags: metadata.tags || ['CA Pro', 'Training', 'Copywriting'],
        categoryId: metadata.categoryId || '27', // Education category
      },
      status: {
        privacyStatus: metadata.privacyStatus,
        selfDeclaredMadeForKids: false,
      },
    },
    media: {
      body: fileStream,
    },
  }, {
    onUploadProgress: (evt) => {
      const progress = (evt.bytesRead / fileSize) * 100;
      console.log(`YouTube upload progress: ${progress.toFixed(1)}%`);
    },
  });

  const videoId = response.data.id;
  if (!videoId) {
    throw new Error('YouTube upload failed - no video ID returned');
  }

  return {
    videoId,
    videoUrl: `https://www.youtube.com/watch?v=${videoId}`,
    title: metadata.title,
  };
}

/**
 * Upload video to YouTube as unlisted with CA Pro formatting
 */
export async function uploadCallRecording(
  videoPath: string,
  title: string,
  description: string
): Promise<YouTubeUploadResult> {
  return uploadVideo(videoPath, {
    title,
    description,
    privacyStatus: 'unlisted',
    tags: ['CA Pro', 'Training', 'Copywriting', 'Business'],
  });
}

/**
 * Update video metadata
 */
export async function updateVideoMetadata(
  videoId: string,
  updates: Partial<YouTubeUploadMetadata>
): Promise<void> {
  await youtube.videos.update({
    part: ['snippet'],
    requestBody: {
      id: videoId,
      snippet: {
        title: updates.title,
        description: updates.description,
        tags: updates.tags,
        categoryId: updates.categoryId,
      },
    },
  });
}

/**
 * Get video details
 */
export async function getVideoDetails(videoId: string) {
  const response = await youtube.videos.list({
    part: ['snippet', 'status', 'statistics'],
    id: [videoId],
  });

  return response.data.items?.[0];
}

/**
 * Generate embed URL for Circle posts
 */
export function getEmbedUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

/**
 * Check if YouTube API is properly configured
 */
export async function checkYouTubeConnection(): Promise<boolean> {
  try {
    await youtube.channels.list({
      part: ['snippet'],
      mine: true,
    });
    return true;
  } catch (error) {
    console.error('YouTube connection check failed:', error);
    return false;
  }
}
