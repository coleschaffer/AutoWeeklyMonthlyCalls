import { vi } from 'vitest';

// Mock environment variables for testing
process.env.NODE_ENV = 'test';
process.env.PORT = '3000';
process.env.TIMEZONE = 'America/New_York';

// Zoom
process.env.ZOOM_ACCOUNT_ID = 'test_zoom_account';
process.env.ZOOM_CLIENT_ID = 'test_zoom_client';
process.env.ZOOM_CLIENT_SECRET = 'test_zoom_secret';
process.env.ZOOM_WEBHOOK_SECRET = 'test_webhook_secret';

// Google
process.env.GOOGLE_CLIENT_ID = 'test_google_client';
process.env.GOOGLE_CLIENT_SECRET = 'test_google_secret';
process.env.GOOGLE_REFRESH_TOKEN = 'test_refresh_token';
process.env.YOUTUBE_CHANNEL_ID = 'UCtest123';
process.env.DRIVE_FOLDER_ID = 'test_drive_folder';
process.env.DRIVE_WEEKLY_FOLDER_ID = 'test_weekly_folder';
process.env.DRIVE_MONTHLY_FOLDER_ID = 'test_monthly_folder';

// ActiveCampaign
process.env.ACTIVECAMPAIGN_API_URL = 'https://test.api-us1.com';
process.env.ACTIVECAMPAIGN_API_KEY = 'test_ac_key';
process.env.ACTIVECAMPAIGN_LIST_ID = '1';

// Twilio
process.env.TWILIO_ACCOUNT_SID = 'test_twilio_sid';
process.env.TWILIO_AUTH_TOKEN = 'test_twilio_token';
process.env.TWILIO_WHATSAPP_NUMBER = 'whatsapp:+1234567890';
process.env.WHATSAPP_GROUP_NUMBERS = '+1111111111,+2222222222';

// Circle
process.env.CIRCLE_API_KEY = 'test_circle_key';
process.env.CIRCLE_COMMUNITY_ID = '1';
process.env.CIRCLE_SPACE_ID = '1';

// Anthropic
process.env.ANTHROPIC_API_KEY = 'test_anthropic_key';

// Global test utilities
vi.mock('axios');
