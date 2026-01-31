import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
  // Zoom
  ZOOM_ACCOUNT_ID: z.string().min(1),
  ZOOM_CLIENT_ID: z.string().min(1),
  ZOOM_CLIENT_SECRET: z.string().min(1),
  ZOOM_WEBHOOK_SECRET: z.string().min(1),

  // Google
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  GOOGLE_REFRESH_TOKEN: z.string().min(1),
  YOUTUBE_CHANNEL_ID: z.string().min(1),
  DRIVE_FOLDER_ID: z.string().min(1),
  DRIVE_WEEKLY_FOLDER_ID: z.string().min(1),
  DRIVE_MONTHLY_FOLDER_ID: z.string().min(1),

  // ActiveCampaign
  ACTIVECAMPAIGN_API_URL: z.string().url(),
  ACTIVECAMPAIGN_API_KEY: z.string().min(1),
  ACTIVECAMPAIGN_LIST_ID: z.string().min(1),

  // Circle
  CIRCLE_API_KEY: z.string().min(1),
  CIRCLE_COMMUNITY_ID: z.string().min(1),
  CIRCLE_SPACE_ID: z.string().min(1),

  // Anthropic
  ANTHROPIC_API_KEY: z.string().min(1),

  // Slack (accepts both naming conventions)
  SLACK_BOT_TOKEN: z.string().optional(),
  SLACK_BOT_OAUTH_TOKEN: z.string().optional(), // Alternative name
  SLACK_APP_ID: z.string().optional(),
  SLACK_CLIENT_ID: z.string().optional(),
  SLACK_SIGNING_SECRET: z.string().optional(),
  SLACK_CLIENT_SECRET: z.string().optional(),
  SLACK_WELCOME_USER_ID: z.string().optional(),
  SLACK_USER_ID: z.string().optional(), // Alternative name

  // App
  PORT: z.string().default('3000'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  RAILWAY_PUBLIC_DOMAIN: z.string().optional(),

  // Call Configuration
  WEEKLY_CALL_DAY: z.string().default('2'), // Tuesday
  WEEKLY_CALL_HOUR: z.string().default('13'), // 1 PM
  MONTHLY_CALL_WEEK: z.string().default('4'), // 4th week
  MONTHLY_CALL_DAY: z.string().default('1'), // Monday
  MONTHLY_CALL_HOUR: z.string().default('14'), // 2 PM
  TIMEZONE: z.string().default('America/New_York'),
});

function validateEnv() {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    console.error('Environment validation failed:');
    console.error(parsed.error.format());

    // Allow partial config - app will start but some features won't work
    console.warn('Starting with partial config - some features may not work');
    return createDevConfig();
  }

  return parsed.data;
}

function createDevConfig() {
  return {
    // Zoom
    ZOOM_ACCOUNT_ID: process.env.ZOOM_ACCOUNT_ID || '',
    ZOOM_CLIENT_ID: process.env.ZOOM_CLIENT_ID || '',
    ZOOM_CLIENT_SECRET: process.env.ZOOM_CLIENT_SECRET || '',
    ZOOM_WEBHOOK_SECRET: process.env.ZOOM_WEBHOOK_SECRET || '',

    // Google
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || '',
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET || '',
    GOOGLE_REFRESH_TOKEN: process.env.GOOGLE_REFRESH_TOKEN || '',
    YOUTUBE_CHANNEL_ID: process.env.YOUTUBE_CHANNEL_ID || '',
    DRIVE_FOLDER_ID: process.env.DRIVE_FOLDER_ID || '',
    DRIVE_WEEKLY_FOLDER_ID: process.env.DRIVE_WEEKLY_FOLDER_ID || '',
    DRIVE_MONTHLY_FOLDER_ID: process.env.DRIVE_MONTHLY_FOLDER_ID || '',

    // ActiveCampaign
    ACTIVECAMPAIGN_API_URL: process.env.ACTIVECAMPAIGN_API_URL || 'https://placeholder.api-us1.com',
    ACTIVECAMPAIGN_API_KEY: process.env.ACTIVECAMPAIGN_API_KEY || '',
    ACTIVECAMPAIGN_LIST_ID: process.env.ACTIVECAMPAIGN_LIST_ID || '',

    // Circle
    CIRCLE_API_KEY: process.env.CIRCLE_API_KEY || '',
    CIRCLE_COMMUNITY_ID: process.env.CIRCLE_COMMUNITY_ID || '',
    CIRCLE_SPACE_ID: process.env.CIRCLE_SPACE_ID || '',

    // Anthropic
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || '',

    // Slack (check both naming conventions)
    SLACK_BOT_TOKEN: process.env.SLACK_BOT_TOKEN || process.env.SLACK_BOT_OAUTH_TOKEN,
    SLACK_BOT_OAUTH_TOKEN: process.env.SLACK_BOT_OAUTH_TOKEN,
    SLACK_APP_ID: process.env.SLACK_APP_ID,
    SLACK_CLIENT_ID: process.env.SLACK_CLIENT_ID,
    SLACK_SIGNING_SECRET: process.env.SLACK_SIGNING_SECRET,
    SLACK_CLIENT_SECRET: process.env.SLACK_CLIENT_SECRET,
    SLACK_WELCOME_USER_ID: process.env.SLACK_WELCOME_USER_ID || process.env.SLACK_USER_ID,
    SLACK_USER_ID: process.env.SLACK_USER_ID,

    // App
    PORT: process.env.PORT || '3000',
    NODE_ENV: (process.env.NODE_ENV as 'development' | 'production' | 'test') || 'development',
    RAILWAY_PUBLIC_DOMAIN: process.env.RAILWAY_PUBLIC_DOMAIN,

    // Call Configuration
    WEEKLY_CALL_DAY: process.env.WEEKLY_CALL_DAY || '2',
    WEEKLY_CALL_HOUR: process.env.WEEKLY_CALL_HOUR || '13',
    MONTHLY_CALL_WEEK: process.env.MONTHLY_CALL_WEEK || '4',
    MONTHLY_CALL_DAY: process.env.MONTHLY_CALL_DAY || '1',
    MONTHLY_CALL_HOUR: process.env.MONTHLY_CALL_HOUR || '14',
    TIMEZONE: process.env.TIMEZONE || 'America/New_York',
  };
}

export const env = validateEnv();

// Parsed number values
export const config = {
  port: parseInt(env.PORT, 10),
  isDev: env.NODE_ENV === 'development',
  isProd: env.NODE_ENV === 'production',

  weeklyCall: {
    day: parseInt(env.WEEKLY_CALL_DAY, 10),
    hour: parseInt(env.WEEKLY_CALL_HOUR, 10),
  },

  monthlyCall: {
    week: parseInt(env.MONTHLY_CALL_WEEK, 10),
    day: parseInt(env.MONTHLY_CALL_DAY, 10),
    hour: parseInt(env.MONTHLY_CALL_HOUR, 10),
  },

  circleSpaceId: parseInt(env.CIRCLE_SPACE_ID, 10),
  circleCommunityId: parseInt(env.CIRCLE_COMMUNITY_ID, 10),
  activeCampaignListId: parseInt(env.ACTIVECAMPAIGN_LIST_ID, 10),
};
