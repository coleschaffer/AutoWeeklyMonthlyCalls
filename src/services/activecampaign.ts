import axios from 'axios';
import { env } from '../config/env.js';
import { config } from '../config/env.js';
import type { EmailCampaignData, EmailSendResult } from '../types/index.js';

// Ensure the API URL doesn't have trailing slash
function normalizeApiUrl(url: string): string {
  let normalized = url.replace(/\/+$/, ''); // Remove trailing slashes
  // If URL already includes /api/3 or /admin, strip it
  normalized = normalized.replace(/\/api\/3\/?$/, '');
  normalized = normalized.replace(/\/admin\/?$/, '');
  return normalized;
}

const baseUrl = normalizeApiUrl(env.ACTIVECAMPAIGN_API_URL);

// V3 API client (for contacts, lists, etc.)
const acClientV3 = axios.create({
  baseURL: baseUrl,
  headers: {
    'Api-Token': env.ACTIVECAMPAIGN_API_KEY,
    'Content-Type': 'application/json',
  },
});

// V1 API client (for campaign creation - uses different auth)
const acClientV1 = axios.create({
  baseURL: baseUrl,
  headers: {
    'Content-Type': 'application/x-www-form-urlencoded',
  },
});

// Log the configured URL on init for debugging
console.log(`[ActiveCampaign] Configured base URL: ${baseUrl}`);

/**
 * Send a campaign email to a list
 */
/**
 * Send a campaign using the V1 API (which has documented campaign creation support)
 * V1 API docs: https://www.activecampaign.com/api/example.php?call=campaign_create
 */
export async function sendCampaign(data: EmailCampaignData): Promise<EmailSendResult> {
  try {
    console.log(`[ActiveCampaign] Creating campaign for list ${data.listId}: "${data.subject}"`);
    console.log(`[ActiveCampaign] Using V1 API at: ${baseUrl}/admin/api.php`);

    // Step 1: Create the message first (V1 API)
    const messageParams = new URLSearchParams({
      api_key: env.ACTIVECAMPAIGN_API_KEY,
      api_action: 'message_add',
      api_output: 'json',
      format: 'html',
      subject: data.subject,
      fromemail: data.fromEmail || 'team@copyaccelerator.com',
      fromname: data.fromName || 'CA Pro Team',
      reply2: data.fromEmail || 'team@copyaccelerator.com',
      priority: '3',
      charset: 'utf-8',
      encoding: 'quoted-printable',
      htmlconstructor: 'editor',
      html: formatEmailHtml(data.body),
      text: data.body,
      [`p[${data.listId}]`]: data.listId.toString(),
    });

    const messageResponse = await acClientV1.post('/admin/api.php', messageParams.toString());

    if (!messageResponse.data || messageResponse.data.result_code === 0) {
      throw new Error(`Message creation failed: ${messageResponse.data?.result_message || 'Unknown error'}`);
    }

    const messageId = messageResponse.data.id;
    console.log(`[ActiveCampaign] Message created: ${messageId}`);

    // Step 2: Create the campaign (V1 API)
    const sendDate = new Date();
    sendDate.setMinutes(sendDate.getMinutes() + 5); // Schedule 5 minutes from now
    const formattedDate = sendDate.toISOString().replace('T', ' ').substring(0, 19);

    const campaignParams = new URLSearchParams({
      api_key: env.ACTIVECAMPAIGN_API_KEY,
      api_action: 'campaign_create',
      api_output: 'json',
      type: 'single',
      name: `Auto: ${data.subject}`,
      sdate: formattedDate,
      status: '1', // 1 = scheduled/active
      public: '1',
      tracklinks: 'all',
      trackreads: '1',
      trackreplies: '0',
      htmlunsub: '1',
      textunsub: '1',
      [`p[${data.listId}]`]: data.listId.toString(),
      [`m[${messageId}]`]: '100', // 100% of sends use this message
    });

    const campaignResponse = await acClientV1.post('/admin/api.php', campaignParams.toString());

    if (!campaignResponse.data || campaignResponse.data.result_code === 0) {
      throw new Error(`Campaign creation failed: ${campaignResponse.data?.result_message || 'Unknown error'}`);
    }

    const campaignId = campaignResponse.data.id;
    console.log(`[ActiveCampaign] Campaign created and scheduled: ${campaignId}`);

    return {
      success: true,
      campaignId: campaignId.toString(),
    };
  } catch (error) {
    // Enhanced error logging
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      const statusText = error.response?.statusText;
      const responseData = error.response?.data;
      const requestUrl = error.config?.url;
      const requestMethod = error.config?.method;

      console.error(`[ActiveCampaign] API Error:`, {
        status,
        statusText,
        url: requestUrl,
        method: requestMethod,
        response: JSON.stringify(responseData, null, 2),
      });

      if (status === 403) {
        return {
          success: false,
          error: `ActiveCampaign 403 Forbidden: API key doesn't have permission. Check your API key permissions.`,
        };
      }

      return {
        success: false,
        error: `ActiveCampaign API error ${status}: ${responseData?.result_message || responseData?.message || statusText || 'Unknown error'}`,
      };
    }

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[ActiveCampaign] Send failed:', errorMessage);
    return {
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * Send a simple email using automation or direct API
 * This is an alternative for simpler email sends
 */
export async function sendEmail(
  to: string,
  subject: string,
  body: string
): Promise<EmailSendResult> {
  try {
    // For direct email sending, we'd typically use a transactional email
    // ActiveCampaign primarily uses campaigns, but has some direct send options
    // This is a simplified version - in production, you might want to use
    // ActiveCampaign's transactional email feature or a dedicated service

    const response = await acClientV3.post('/api/3/contactEmails', {
      contactEmail: {
        contact: to,
        subject,
        body: formatEmailHtml(body),
      },
    });

    return {
      success: true,
      campaignId: response.data?.contactEmail?.id?.toString(),
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return {
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * Send reminder email to the appropriate CA Pro list based on call type
 */
export async function sendReminderEmail(
  subject: string,
  body: string,
  callType: 'weekly' | 'monthly'
): Promise<EmailSendResult> {
  const listId = callType === 'monthly'
    ? config.activeCampaignMonthlyListId
    : config.activeCampaignWeeklyListId;

  if (!listId || listId === 0) {
    return {
      success: false,
      error: `No ActiveCampaign list configured for ${callType} calls`,
    };
  }

  return sendCampaign({
    listId,
    subject,
    body,
  });
}

/**
 * Send follow-up email about new recording
 */
export async function sendRecordingNotification(
  topic: string,
  description: string,
  circleUrl: string,
  callType: 'weekly' | 'monthly'
): Promise<EmailSendResult> {
  const subject = `New Recording: ${topic}`;
  const body = `
Hi there!

A new CA Pro training recording is now available!

${description}

Watch it now: ${circleUrl}

Best,
The CA Pro Team
  `.trim();

  return sendReminderEmail(subject, body, callType);
}

/**
 * Format plain text email as HTML with header image
 */
function formatEmailHtml(plainText: string): string {
  // Convert newlines to <br> and wrap in basic HTML
  const htmlContent = plainText
    .split('\n\n')
    .map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`)
    .join('');

  // Header image URL from our public folder
  const baseUrl = env.RAILWAY_PUBLIC_DOMAIN
    ? `https://${env.RAILWAY_PUBLIC_DOMAIN}`
    : 'https://autoweeklymonthlycalls-production.up.railway.app';
  const headerImageUrl = `${baseUrl}/ca-pro-header.avif`;

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 0;">
  <div style="text-align: center; margin-bottom: 20px;">
    <img src="${headerImageUrl}" alt="CA Pro" style="max-width: 100%; height: auto; display: block; margin: 0 auto;" />
  </div>
  <div style="padding: 0 20px 20px 20px;">
    ${htmlContent}
  </div>
</body>
</html>
  `.trim();
}

/**
 * Get list details
 */
export async function getList(listId: number) {
  const response = await acClientV3.get(`/api/3/lists/${listId}`);
  return response.data.list;
}

/**
 * Check if ActiveCampaign API is properly configured
 */
export async function checkActiveCampaignConnection(): Promise<boolean> {
  try {
    await acClientV3.get('/api/3/users/me');
    return true;
  } catch (error) {
    console.error('ActiveCampaign connection check failed:', error);
    return false;
  }
}
