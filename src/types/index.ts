// ===========================================
// CA Pro Automation - TypeScript Types
// ===========================================

// ---- Call Types ----
export type CallType = 'weekly' | 'monthly';

export interface CallSchedule {
  type: CallType;
  dayOfWeek: number; // 0-6 (Sunday-Saturday)
  hour: number; // 24-hour format
  minute: number;
  weekOfMonth?: number; // For monthly calls (1-4)
}

// ---- Zoom Types ----
export interface ZoomWebhookPayload {
  event: string;
  event_ts: number;
  payload: {
    account_id: string;
    object: {
      id: string;
      uuid: string;
      host_id: string;
      topic: string;
      type: number;
      start_time: string;
      duration: number;
      timezone: string;
      recording_files: ZoomRecordingFile[];
    };
  };
}

export interface ZoomRecordingFile {
  id: string;
  meeting_id: string;
  recording_start: string;
  recording_end: string;
  file_type: string;
  file_extension: string;
  file_size: number;
  play_url: string;
  download_url: string;
  status: string;
  recording_type: string;
}

export interface ZoomTranscriptSegment {
  speaker_name: string;
  start_time: number; // seconds
  end_time: number;
  text: string;
}

export interface ZoomTranscript {
  meeting_id: string;
  segments: ZoomTranscriptSegment[];
  full_text: string;
}

export interface ZoomRecordingData {
  meetingId: string;
  topic: string;
  startTime: Date;
  duration: number;
  videoUrl: string;
  transcriptUrl?: string;
  chatUrl?: string;
}

// ---- Video Processing Types ----
export interface VideoTrimResult {
  inputPath: string;
  outputPath: string;
  trimStartSeconds: number;
  originalDuration: number;
  newDuration: number;
}

export interface ProcessedVideo {
  localPath: string;
  fileName: string;
  fileSize: number;
  duration: number;
}

// ---- YouTube Types ----
export interface YouTubeUploadMetadata {
  title: string;
  description: string;
  tags?: string[];
  privacyStatus: 'public' | 'unlisted' | 'private';
  categoryId?: string;
}

export interface YouTubeUploadResult {
  videoId: string;
  videoUrl: string;
  title: string;
}

// ---- Google Drive Types ----
export interface DriveUploadResult {
  fileId: string;
  webViewLink: string;
  webContentLink?: string;
  name: string;
}

export interface DriveUploadFiles {
  video?: DriveUploadResult;
  transcript?: DriveUploadResult;
  chat?: DriveUploadResult;
}

// ---- Circle Types ----
export interface CirclePostData {
  spaceId: number;
  name: string;
  body: string;
  embedUrl?: string;
  isDraft?: boolean;
}

export interface CirclePostResult {
  id: number;
  name: string;
  url: string;
  created_at: string;
}

// ---- ActiveCampaign Types ----
export interface EmailCampaignData {
  listId: number;
  subject: string;
  body: string;
  fromName?: string;
  fromEmail?: string;
}

export interface EmailSendResult {
  success: boolean;
  campaignId?: string;
  error?: string;
}

// ---- Claude AI Types ----
export interface CallSummary {
  description: string;
  keyTakeaways: string[];
}

// ---- Workflow Types ----
export interface ReminderTemplate {
  emailSubject: string;
  emailBody: string;
}

export interface CallPostMetadata {
  date: Date;
  callType: CallType;
  topic: string;
  youtubeId: string;
  youtubeUrl: string;
  driveVideoLink: string;
  driveTranscriptLink: string;
  driveChatLink: string;
  description: string;
  bullets: string[];
  circlePostUrl?: string;
}

export interface PostCallProcessResult {
  success: boolean;
  meetingId: string;
  youtubeUrl?: string;
  driveLinks?: DriveUploadFiles;
  circlePostUrl?: string;
  summary?: CallSummary;
  error?: string;
}

// ---- API Response Types ----
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  timestamp: string;
}

// ---- Webhook Validation ----
export interface WebhookValidationResult {
  isValid: boolean;
  payload?: ZoomWebhookPayload;
  error?: string;
}
