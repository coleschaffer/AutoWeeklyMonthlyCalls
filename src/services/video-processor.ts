import ffmpeg from 'fluent-ffmpeg';
import fs from 'fs/promises';
import path from 'path';
import type { VideoTrimResult, ProcessedVideo } from '../types/index.js';

const TEMP_DIR = '/tmp/ca-pro-videos';

/**
 * Ensure temp directory exists
 */
async function ensureTempDir(): Promise<void> {
  try {
    await fs.mkdir(TEMP_DIR, { recursive: true });
  } catch (error) {
    // Directory already exists
  }
}

/**
 * Get video duration using ffprobe
 */
export function getVideoDuration(inputPath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(inputPath, (err, metadata) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(metadata.format.duration || 0);
    });
  });
}

/**
 * Trim video from a specific start time
 * Uses stream copy for fast processing when possible
 */
export async function trimVideo(
  inputPath: string,
  startSeconds: number,
  outputPath?: string
): Promise<VideoTrimResult> {
  await ensureTempDir();

  const originalDuration = await getVideoDuration(inputPath);
  const fileName = path.basename(inputPath, path.extname(inputPath));
  const finalOutputPath = outputPath || path.join(TEMP_DIR, `${fileName}_trimmed.mp4`);

  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .setStartTime(startSeconds)
      .outputOptions([
        '-c copy', // Stream copy for speed (no re-encoding)
        '-movflags +faststart', // Enable fast start for web playback
      ])
      .output(finalOutputPath)
      .on('end', async () => {
        const newDuration = await getVideoDuration(finalOutputPath);
        resolve({
          inputPath,
          outputPath: finalOutputPath,
          trimStartSeconds: startSeconds,
          originalDuration,
          newDuration,
        });
      })
      .on('error', (err) => {
        reject(new Error(`Video trimming failed: ${err.message}`));
      })
      .run();
  });
}

/**
 * Get video file info
 */
export async function getVideoInfo(filePath: string): Promise<ProcessedVideo> {
  const stats = await fs.stat(filePath);
  const duration = await getVideoDuration(filePath);

  return {
    localPath: filePath,
    fileName: path.basename(filePath),
    fileSize: stats.size,
    duration,
  };
}

/**
 * Clean up temporary files
 */
export async function cleanupTempFiles(filePaths: string[]): Promise<void> {
  for (const filePath of filePaths) {
    try {
      await fs.unlink(filePath);
    } catch (error) {
      // File may not exist, ignore
    }
  }
}

/**
 * Generate output path for trimmed video
 */
export function getTrimmedVideoPath(originalPath: string): string {
  const dir = path.dirname(originalPath);
  const ext = path.extname(originalPath);
  const base = path.basename(originalPath, ext);
  return path.join(dir, `${base}_trimmed${ext}`);
}

/**
 * Check if ffmpeg is available
 */
export function checkFfmpegAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    ffmpeg.getAvailableFormats((err) => {
      resolve(!err);
    });
  });
}

/**
 * Generate a thumbnail from video
 */
export function generateThumbnail(
  videoPath: string,
  outputPath: string,
  timeSeconds: number = 10
): Promise<string> {
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .screenshots({
        timestamps: [timeSeconds],
        filename: path.basename(outputPath),
        folder: path.dirname(outputPath),
        size: '1280x720',
      })
      .on('end', () => resolve(outputPath))
      .on('error', reject);
  });
}
