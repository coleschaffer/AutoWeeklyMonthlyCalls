import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import { env } from '../config/env.js';
import type { DriveUploadResult, DriveUploadFiles } from '../types/index.js';

const oauth2Client = new google.auth.OAuth2(
  env.GOOGLE_CLIENT_ID,
  env.GOOGLE_CLIENT_SECRET
);

oauth2Client.setCredentials({
  refresh_token: env.GOOGLE_REFRESH_TOKEN,
});

const drive = google.drive({ version: 'v3', auth: oauth2Client });

/**
 * Upload a file to Google Drive
 */
export async function uploadFile(
  filePath: string,
  fileName: string,
  mimeType: string,
  folderId?: string
): Promise<DriveUploadResult> {
  const fileMetadata = {
    name: fileName,
    parents: folderId ? [folderId] : [env.DRIVE_FOLDER_ID],
  };

  const media = {
    mimeType,
    body: fs.createReadStream(filePath),
  };

  const response = await drive.files.create({
    requestBody: fileMetadata,
    media,
    fields: 'id, name, webViewLink, webContentLink',
  });

  const file = response.data;

  // Make file viewable by anyone with the link
  await drive.permissions.create({
    fileId: file.id!,
    requestBody: {
      role: 'reader',
      type: 'anyone',
    },
  });

  return {
    fileId: file.id!,
    webViewLink: file.webViewLink!,
    webContentLink: file.webContentLink ?? undefined,
    name: file.name!,
  };
}

/**
 * Upload video file to Drive
 */
export async function uploadVideo(
  videoPath: string,
  fileName: string
): Promise<DriveUploadResult> {
  return uploadFile(videoPath, fileName, 'video/mp4');
}

/**
 * Upload transcript file to Drive
 */
export async function uploadTranscript(
  transcriptContent: string,
  fileName: string
): Promise<DriveUploadResult> {
  // Write transcript to temp file
  const tempPath = `/tmp/${fileName}`;
  fs.writeFileSync(tempPath, transcriptContent, 'utf-8');

  try {
    const result = await uploadFile(tempPath, fileName, 'text/plain');
    return result;
  } finally {
    // Clean up temp file
    try {
      fs.unlinkSync(tempPath);
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Upload chat file to Drive
 */
export async function uploadChat(
  chatContent: string,
  fileName: string
): Promise<DriveUploadResult> {
  const tempPath = `/tmp/${fileName}`;
  fs.writeFileSync(tempPath, chatContent, 'utf-8');

  try {
    const result = await uploadFile(tempPath, fileName, 'text/plain');
    return result;
  } finally {
    try {
      fs.unlinkSync(tempPath);
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Upload all call files to Drive
 */
export async function uploadCallFiles(
  dateStr: string,
  callType: string,
  files: {
    videoPath?: string;
    transcriptContent?: string;
    chatContent?: string;
  }
): Promise<DriveUploadFiles> {
  const result: DriveUploadFiles = {};
  const prefix = `${dateStr}_CA_Pro_${callType}`;

  if (files.videoPath) {
    result.video = await uploadVideo(
      files.videoPath,
      `${prefix}_Recording.mp4`
    );
  }

  if (files.transcriptContent) {
    result.transcript = await uploadTranscript(
      files.transcriptContent,
      `${prefix}_Transcript.txt`
    );
  }

  if (files.chatContent) {
    result.chat = await uploadChat(
      files.chatContent,
      `${prefix}_Chat.txt`
    );
  }

  return result;
}

/**
 * Create a subfolder in the main folder
 */
export async function createSubfolder(folderName: string): Promise<string> {
  const fileMetadata = {
    name: folderName,
    mimeType: 'application/vnd.google-apps.folder',
    parents: [env.DRIVE_FOLDER_ID],
  };

  const response = await drive.files.create({
    requestBody: fileMetadata,
    fields: 'id',
  });

  return response.data.id!;
}

/**
 * Check if Google Drive API is properly configured
 */
export async function checkDriveConnection(): Promise<boolean> {
  try {
    await drive.files.list({
      pageSize: 1,
      fields: 'files(id, name)',
    });
    return true;
  } catch (error) {
    console.error('Drive connection check failed:', error);
    return false;
  }
}

/**
 * Get shareable link for a file
 */
export function getShareableLink(fileId: string): string {
  return `https://drive.google.com/file/d/${fileId}/view?usp=sharing`;
}
