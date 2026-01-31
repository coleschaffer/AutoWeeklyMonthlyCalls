import axios from 'axios';
import { env } from '../config/env.js';
import { config } from '../config/env.js';
import type { CirclePostData, CirclePostResult, CallPostMetadata } from '../types/index.js';
import { formatDateForCircle, getCallTypeLabel } from '../utils/date-helpers.js';

const CIRCLE_API_BASE = 'https://app.circle.so/api/v1';

const circleClient = axios.create({
  baseURL: CIRCLE_API_BASE,
  headers: {
    Authorization: `Token ${env.CIRCLE_API_KEY}`,
    'Content-Type': 'application/json',
  },
});

/**
 * Create a post in Circle community
 */
export async function createPost(data: CirclePostData): Promise<CirclePostResult> {
  const response = await circleClient.post('/posts', {
    community_id: config.circleCommunityId,
    space_id: data.spaceId,
    name: data.name,
    body: data.body,
    is_draft: data.isDraft || false,
    // Note: embed_url might need to be added via a different API or manual edit
    // Circle API support for embeds varies
  });

  return {
    id: response.data.id,
    name: response.data.name,
    url: response.data.url || `https://community.example.com/c/posts/${response.data.id}`,
    created_at: response.data.created_at,
  };
}

/**
 * Create a call recording post with proper formatting
 */
export async function createCallPost(metadata: CallPostMetadata): Promise<CirclePostResult> {
  const formattedDate = formatDateForCircle(metadata.date);
  const typeLabel = getCallTypeLabel(metadata.callType);

  const title = `${formattedDate} - CA Pro ${typeLabel} Training: ${metadata.topic}`;

  // Build the post body with embedded video and summary
  const body = buildPostBody(metadata);

  return createPost({
    spaceId: config.circleSpaceId,
    name: title,
    body,
    embedUrl: metadata.youtubeUrl,
  });
}

/**
 * Build the post body content
 *
 * Structure:
 * - YouTube embed
 * - Description (2-3 sentences)
 * - Summary (6-8 bullets with **Bold Heading**: format)
 * - Key Takeaways (4-6 bullets)
 * - Resources section
 */
function buildPostBody(metadata: CallPostMetadata): string {
  // YouTube embed (Circle supports oEmbed)
  const videoEmbed = `https://www.youtube.com/watch?v=${metadata.youtubeId}`;

  // Separate summary bullets (have **Bold**:) from key takeaways (plain text)
  const summaryBullets: string[] = [];
  const keyTakeaways: string[] = [];

  for (const bullet of metadata.bullets) {
    if (bullet.includes('**') && bullet.includes(':')) {
      // This is a summary bullet with bold heading
      summaryBullets.push(bullet);
    } else {
      // This is a key takeaway
      keyTakeaways.push(bullet);
    }
  }

  // Build the body
  let body = `${videoEmbed}

${metadata.description}`;

  // Add Summary section if we have summary bullets
  if (summaryBullets.length > 0) {
    body += `

**Summary**

${summaryBullets.map(b => `${b}`).join('\n\n')}`;
  }

  // Add Key Takeaways section if we have takeaways
  if (keyTakeaways.length > 0) {
    body += `

**Key Takeaways**

${keyTakeaways.map(b => `• ${b}`).join('\n')}`;
  }

  // Add Resources section
  body += `

---

**Resources**
- [Video](${metadata.driveVideoLink})
- [Call Transcript](${metadata.driveTranscriptLink})
- [Chat Transcript](${metadata.driveChatLink})`;

  return body.trim();
}

/**
 * Get a post by ID
 */
export async function getPost(postId: number): Promise<CirclePostResult> {
  const response = await circleClient.get(`/posts/${postId}`, {
    params: {
      community_id: config.circleCommunityId,
    },
  });

  return response.data;
}

/**
 * Update an existing post
 */
export async function updatePost(
  postId: number,
  updates: Partial<CirclePostData>
): Promise<CirclePostResult> {
  const response = await circleClient.put(`/posts/${postId}`, {
    community_id: config.circleCommunityId,
    ...updates,
  });

  return response.data;
}

/**
 * Get space details
 */
export async function getSpace(spaceId: number) {
  const response = await circleClient.get(`/spaces/${spaceId}`, {
    params: {
      community_id: config.circleCommunityId,
    },
  });

  return response.data;
}

/**
 * Check if Circle API is properly configured
 */
export async function checkCircleConnection(): Promise<boolean> {
  try {
    await circleClient.get('/me');
    return true;
  } catch (error) {
    console.error('Circle connection check failed:', error);
    return false;
  }
}

/**
 * Get the URL for a post
 */
export function getPostUrl(postId: number, communitySlug: string = 'capro'): string {
  return `https://${communitySlug}.circle.so/c/posts/${postId}`;
}
