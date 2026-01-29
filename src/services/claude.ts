import Anthropic from '@anthropic-ai/sdk';
import { env } from '../config/env.js';
import type { CallSummary } from '../types/index.js';

const anthropic = new Anthropic({
  apiKey: env.ANTHROPIC_API_KEY,
});

/**
 * Generate a summary of a call transcript
 */
export async function generateCallSummary(
  transcript: string,
  topic: string
): Promise<CallSummary> {
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: `You are summarizing a CA Pro training call about "${topic}".

This is a training call for copywriters and business owners about advertising, copywriting, and business strategy.

Transcript:
${transcript}

Provide:
1. A brief 2-3 sentence description of what was covered in this call. Focus on the main topics and insights shared.
2. 5-7 bullet points summarizing the key takeaways that attendees should remember.

Format your response EXACTLY as follows (use this exact format with these exact labels):

DESCRIPTION:
[Your 2-3 sentence description here]

KEY TAKEAWAYS:
• [Bullet point 1]
• [Bullet point 2]
• [Bullet point 3]
• [Bullet point 4]
• [Bullet point 5]
• [Bullet point 6 - optional]
• [Bullet point 7 - optional]

Important: Make the takeaways actionable and specific, not generic. Focus on the unique insights from this particular call.`,
      },
    ],
  });

  const responseText =
    response.content[0].type === 'text' ? response.content[0].text : '';

  return parseSummaryResponse(responseText);
}

/**
 * Parse the Claude response into structured summary
 */
function parseSummaryResponse(responseText: string): CallSummary {
  // Extract description
  const descriptionMatch = responseText.match(
    /DESCRIPTION:\s*\n?([\s\S]*?)(?=KEY TAKEAWAYS:|$)/i
  );
  const description = descriptionMatch
    ? descriptionMatch[1].trim()
    : 'Training call covering copywriting and business strategies.';

  // Extract bullet points
  const takeawaysMatch = responseText.match(/KEY TAKEAWAYS:\s*\n?([\s\S]*?)$/i);
  let keyTakeaways: string[] = [];

  if (takeawaysMatch) {
    const bulletText = takeawaysMatch[1];
    // Match bullet points (•, -, *, or numbered)
    const bullets = bulletText.match(/[•\-\*]\s*(.+?)(?=\n[•\-\*]|\n\n|$)/g);

    if (bullets) {
      keyTakeaways = bullets
        .map(b => b.replace(/^[•\-\*]\s*/, '').trim())
        .filter(b => b.length > 0);
    }
  }

  // Fallback if parsing failed
  if (keyTakeaways.length === 0) {
    keyTakeaways = [
      'Key strategies and insights were shared for improving copywriting effectiveness.',
      'Practical tips for implementing these strategies in your business.',
      'Watch the full recording for detailed examples and explanations.',
    ];
  }

  return {
    description,
    keyTakeaways,
  };
}

/**
 * Generate a topic from the transcript if not provided
 */
export async function extractTopic(transcript: string): Promise<string> {
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 100,
    messages: [
      {
        role: 'user',
        content: `Based on this transcript excerpt, provide a short (3-7 words) topic title that summarizes the main subject discussed. Just respond with the topic, nothing else.

Transcript excerpt (first 2000 chars):
${transcript.substring(0, 2000)}`,
      },
    ],
  });

  const topic =
    response.content[0].type === 'text'
      ? response.content[0].text.trim()
      : 'Training Call';

  // Clean up the topic
  return topic
    .replace(/^["']|["']$/g, '') // Remove quotes
    .replace(/^Topic:\s*/i, '') // Remove "Topic:" prefix
    .trim();
}

/**
 * Check if Claude API is properly configured
 */
export async function checkClaudeConnection(): Promise<boolean> {
  try {
    await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 10,
      messages: [{ role: 'user', content: 'Say "ok"' }],
    });
    return true;
  } catch (error) {
    console.error('Claude connection check failed:', error);
    return false;
  }
}
