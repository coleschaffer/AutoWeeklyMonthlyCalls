import axios from 'axios';
import { env } from '../config/env.js';
import { config } from '../config/env.js';
import type { EmailCampaignData, EmailSendResult } from '../types/index.js';

const acClient = axios.create({
  baseURL: env.ACTIVECAMPAIGN_API_URL,
  headers: {
    'Api-Token': env.ACTIVECAMPAIGN_API_KEY,
    'Content-Type': 'application/json',
  },
});

/**
 * Send a campaign email to a list
 */
export async function sendCampaign(data: EmailCampaignData): Promise<EmailSendResult> {
  try {
    // Step 1: Create a campaign
    const campaignResponse = await acClient.post('/api/3/campaigns', {
      campaign: {
        type: 'single', // One-time email
        name: `Auto: ${data.subject}`,
        status: 0, // Draft
        public: 0,
        segmentid: 0, // Use list instead of segment
      },
    });

    const campaignId = campaignResponse.data.campaign.id;

    // Step 2: Create the message content
    await acClient.post('/api/3/messages', {
      message: {
        campaign: campaignId,
        fromname: data.fromName || 'CA Pro Team',
        fromemail: data.fromEmail || 'team@capro.com',
        reply2: data.fromEmail || 'team@capro.com',
        subject: data.subject,
        html: formatEmailHtml(data.body),
        text: data.body,
      },
    });

    // Step 3: Associate campaign with list
    await acClient.post('/api/3/campaignLists', {
      campaignList: {
        campaign: campaignId,
        list: data.listId,
      },
    });

    // Step 4: Send the campaign
    await acClient.post(`/api/3/campaigns/${campaignId}/send`);

    return {
      success: true,
      campaignId: campaignId.toString(),
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('ActiveCampaign send failed:', errorMessage);
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

    const response = await acClient.post('/api/3/contactEmails', {
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
 * Send reminder email to the CA Pro list
 */
export async function sendReminderEmail(
  subject: string,
  body: string
): Promise<EmailSendResult> {
  return sendCampaign({
    listId: config.activeCampaignListId,
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
  circleUrl: string
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

  return sendReminderEmail(subject, body);
}

/**
 * Format plain text email as HTML
 */
function formatEmailHtml(plainText: string): string {
  // Convert newlines to <br> and wrap in basic HTML
  const htmlContent = plainText
    .split('\n\n')
    .map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`)
    .join('');

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  ${htmlContent}
</body>
</html>
  `.trim();
}

/**
 * Get list details
 */
export async function getList(listId: number) {
  const response = await acClient.get(`/api/3/lists/${listId}`);
  return response.data.list;
}

/**
 * Check if ActiveCampaign API is properly configured
 */
export async function checkActiveCampaignConnection(): Promise<boolean> {
  try {
    await acClient.get('/api/3/users/me');
    return true;
  } catch (error) {
    console.error('ActiveCampaign connection check failed:', error);
    return false;
  }
}
