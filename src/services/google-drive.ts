import { google } from 'googleapis';
import fs from 'fs';
import { env } from '../config/env.js';
import type { DriveUploadResult, DriveUploadFiles, CallType } from '../types/index.js';
import { format } from 'date-fns';

const oauth2Client = new google.auth.OAuth2(
  env.GOOGLE_CLIENT_ID,
  env.GOOGLE_CLIENT_SECRET
);

oauth2Client.setCredentials({
  refresh_token: env.GOOGLE_REFRESH_TOKEN,
});

const drive = google.drive({ version: 'v3', auth: oauth2Client });

/**
 * Get the parent folder ID based on call type
 */
function getParentFolderId(callType: CallType): string {
  return callType === 'weekly'
    ? env.DRIVE_WEEKLY_FOLDER_ID
    : env.DRIVE_MONTHLY_FOLDER_ID;
}

/**
 * Format date for folder name: YYYY.MM.DD (e.g., 2026.01.06)
 */
export function formatDateForFolder(date: Date): string {
  return format(date, 'yyyy.MM.dd');
}

/**
 * Create a date subfolder in the appropriate call type folder
 */
export async function createDateSubfolder(
  date: Date,
  callType: CallType
): Promise<string> {
  const folderName = formatDateForFolder(date);
  const parentFolderId = getParentFolderId(callType);

  // Check if folder already exists
  const existingFolder = await drive.files.list({
    q: `name='${folderName}' and '${parentFolderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id, name)',
  });

  if (existingFolder.data.files && existingFolder.data.files.length > 0) {
    console.log(`Folder ${folderName} already exists, using existing folder`);
    return existingFolder.data.files[0].id!;
  }

  // Create new folder
  const fileMetadata = {
    name: folderName,
    mimeType: 'application/vnd.google-apps.folder',
    parents: [parentFolderId],
  };

  const response = await drive.files.create({
    requestBody: fileMetadata,
    fields: 'id',
  });

  console.log(`Created folder: ${folderName}`);
  return response.data.id!;
}

/**
 * Upload a file to Google Drive
 */
export async function uploadFile(
  filePath: string,
  fileName: string,
  mimeType: string,
  folderId: string
): Promise<DriveUploadResult> {
  const fileMetadata = {
    name: fileName,
    parents: [folderId],
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
 * Upload video file (.mp4) to Drive
 */
export async function uploadVideo(
  videoPath: string,
  fileName: string,
  folderId: string
): Promise<DriveUploadResult> {
  return uploadFile(videoPath, fileName, 'video/mp4', folderId);
}

/**
 * Upload transcript file (.vtt) to Drive
 */
export async function uploadTranscript(
  transcriptContent: string,
  fileName: string,
  folderId: string
): Promise<DriveUploadResult> {
  // Write transcript to temp file
  const tempPath = `/tmp/${fileName}`;
  fs.writeFileSync(tempPath, transcriptContent, 'utf-8');

  try {
    const result = await uploadFile(tempPath, fileName, 'text/vtt', folderId);
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
 * Upload chat file (.txt) to Drive
 */
export async function uploadChat(
  chatContent: string,
  fileName: string,
  folderId: string
): Promise<DriveUploadResult> {
  const tempPath = `/tmp/${fileName}`;
  fs.writeFileSync(tempPath, chatContent, 'utf-8');

  try {
    const result = await uploadFile(tempPath, fileName, 'text/plain', folderId);
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
 * Upload all call files to Drive with proper folder structure
 *
 * Structure:
 * - Weekly: CA Pro Weekly Training Calls / YYYY.MM.DD / files
 * - Monthly: CA Pro Business Owner Calls / YYYY.MM.DD / files
 */
export async function uploadCallFiles(
  date: Date,
  callType: CallType,
  topic: string,
  files: {
    videoPath?: string;
    transcriptContent?: string;
    chatContent?: string;
  }
): Promise<DriveUploadFiles> {
  const result: DriveUploadFiles = {};

  // Create date subfolder (e.g., 2026.01.06)
  const folderId = await createDateSubfolder(date, callType);

  // Generate file names
  const dateStr = formatDateForFolder(date);
  const sanitizedTopic = topic.replace(/[^a-zA-Z0-9\s]/g, '').replace(/\s+/g, '_');
  const prefix = `${dateStr}_${sanitizedTopic}`;

  // Upload video (.mp4)
  if (files.videoPath) {
    console.log('Uploading video to Google Drive...');
    result.video = await uploadVideo(
      files.videoPath,
      `${prefix}.mp4`,
      folderId
    );
    console.log(`Video uploaded: ${result.video.webViewLink}`);
  }

  // Upload transcript (.vtt)
  if (files.transcriptContent) {
    console.log('Uploading transcript to Google Drive...');
    result.transcript = await uploadTranscript(
      files.transcriptContent,
      `${prefix}_transcript.vtt`,
      folderId
    );
    console.log(`Transcript uploaded: ${result.transcript.webViewLink}`);
  }

  // Upload chat (.txt)
  if (files.chatContent) {
    console.log('Uploading chat to Google Drive...');
    result.chat = await uploadChat(
      files.chatContent,
      `${prefix}_chat.txt`,
      folderId
    );
    console.log(`Chat uploaded: ${result.chat.webViewLink}`);
  }

  return result;
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

/**
 * List files in a folder
 */
export async function listFilesInFolder(folderId: string) {
  const response = await drive.files.list({
    q: `'${folderId}' in parents and trashed=false`,
    fields: 'files(id, name, mimeType, webViewLink)',
  });

  return response.data.files || [];
}
