import Anthropic from '@anthropic-ai/sdk';
import { env } from '../config/env.js';
import type { CallSummary, StructuredRecap, GeneratedRecaps, CallType } from '../types/index.js';

const anthropic = new Anthropic({
  apiKey: env.ANTHROPIC_API_KEY,
});

/**
 * Generate a summary of a call transcript using the structured prompt
 */
export async function generateCallSummary(
  transcript: string,
  topic: string,
  speakerName: string = 'Stefan'
): Promise<CallSummary> {
  const prompt = `# Call Summary Generator

You are generating a structured summary of a coaching/training call from a transcript. Follow these exact specifications:

## Output Format

### Description
Write 2-3 sentences following this formula:
- Sentence 1: "[Speaker name] leads a [session type] focused on [primary topic]."
- Sentence 2-3: "The call features [main activities/content covered], with [Speaker name] [specific actions/demonstrations]."

Session types to choose from: training session, funnel breakdown session, open Q&A session, feedback session, strategy session, workshop, masterclass

### Summary
Write 6-8 bullet points covering distinct topics from the call.

Format each bullet as:
**[2-4 Word Heading]**: [2-4 sentences describing what was covered, with specific details]

Heading style rules:
- Use noun phrases, not sentences ("Ad Structure Analysis" not "Stefan Analyzed Ad Structure")
- Categories: [Topic] + [Content Type], [Strategy/Concept], [Process/Technique], or [Plural Noun]
- Examples: "Funnel Diagnostics", "Rewrite Process", "Market Awareness Strategy", "Optimization Notes"

Content rules for each bullet:
- Include concrete details: product names, price points, percentages, tool names
- Describe actions taken, not just topics discussed
- End with the insight or why it matters
- Follow rough chronological order of the call

### Key Takeaways
Write 4-6 actionable insights or lessons from the call.

Format as a bulleted list. Each takeaway should:
- Be a standalone insight someone could apply
- Capture strategic thinking, not just facts
- Be specific enough to be useful, general enough to transfer

---

## Tone & Style Rules

1. **Third-person only**: "${speakerName} shared" not "I shared"
2. **Active voice**: "${speakerName} broke down" not "was broken down"
3. **Observational, not promotional**: Describe what happened without evaluating quality
4. **Specific over vague**: Use exact numbers, names, and details from the transcript
5. **Industry jargon acceptable**: VSL, AOV, advertorial, mechanism, funnel, etc.
6. **No timestamps**: Summarize topics, don't reference time codes
7. **No filler**: Every sentence must carry information

---

## Process

1. Read the full transcript
2. Identify the speaker leading the call (likely ${speakerName})
3. Identify 6-8 distinct topics/segments discussed
4. Extract specific details, examples, and numbers mentioned
5. Determine the 4-6 most transferable lessons
6. Write the summary following all formatting rules above

---

## Transcript

${transcript}

---

Now generate the Description, Summary (6-8 bullets), and Key Takeaways (4-6 bullets) following the format above. Do NOT include the Resources section - that will be added separately.`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2048,
    messages: [
      {
        role: 'user',
        content: prompt,
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
  // Extract description (text between ### Description and ### Summary)
  const descriptionMatch = responseText.match(
    /###?\s*Description\s*\n+([\s\S]*?)(?=###?\s*Summary|$)/i
  );
  let description = descriptionMatch
    ? descriptionMatch[1].trim()
    : '';

  // If no markdown headers, try to get first paragraph
  if (!description) {
    const firstParagraph = responseText.split('\n\n')[0];
    if (firstParagraph && !firstParagraph.startsWith('**') && !firstParagraph.startsWith('•') && !firstParagraph.startsWith('-')) {
      description = firstParagraph.trim();
    }
  }

  // Fallback description
  if (!description) {
    description = 'This training call covered strategies and insights for copywriting and business growth.';
  }

  // Extract summary bullets (between ### Summary and ### Key Takeaways)
  const summaryMatch = responseText.match(
    /###?\s*Summary\s*\n+([\s\S]*?)(?=###?\s*Key\s*Takeaways|$)/i
  );

  let summaryBullets: string[] = [];
  if (summaryMatch) {
    const summaryText = summaryMatch[1];
    // Match bullets that start with ** (bold heading format)
    const bulletMatches = summaryText.match(/\*\*[^*]+\*\*:?\s*[^\n*]+(?:\n(?!\*\*|\n)[^\n]+)*/g);
    if (bulletMatches) {
      summaryBullets = bulletMatches.map(b => b.trim());
    }
  }

  // Extract key takeaways (after ### Key Takeaways)
  const takeawaysMatch = responseText.match(
    /###?\s*Key\s*Takeaways\s*\n+([\s\S]*?)(?=###?\s*Resources|---|\n\n\n|$)/i
  );

  let keyTakeaways: string[] = [];
  if (takeawaysMatch) {
    const takeawaysText = takeawaysMatch[1];
    // Match bullet points (-, *, •, or numbered)
    const bullets = takeawaysText.match(/(?:^|\n)\s*(?:[-•*]|\d+\.)\s*(.+?)(?=\n\s*(?:[-•*]|\d+\.)|\n\n|$)/g);
    if (bullets) {
      keyTakeaways = bullets
        .map(b => b.replace(/^\s*(?:[-•*]|\d+\.)\s*/, '').trim())
        .filter(b => b.length > 0);
    }
  }

  // Combine summary bullets and key takeaways for the output
  // The description goes in the description field
  // Everything else goes in keyTakeaways (which will be formatted in Circle post)
  const allBullets = [...summaryBullets, ...keyTakeaways];

  // Fallback if parsing failed
  if (allBullets.length === 0) {
    // Try to extract any bullet-like content from the response
    const anyBullets = responseText.match(/(?:^|\n)\s*(?:[-•*]|\*\*).+/g);
    if (anyBullets) {
      allBullets.push(...anyBullets.map(b => b.trim()).slice(0, 10));
    }
  }

  if (allBullets.length === 0) {
    allBullets.push(
      '**Training Content**: Key strategies and insights were shared during this session.',
      '**Practical Application**: Actionable tips for implementation were discussed.',
      'Watch the full recording for detailed examples and explanations.'
    );
  }

  return {
    description,
    keyTakeaways: allBullets,
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

// ===========================================
// Topic Detection (for #ca-pro channel monitoring)
// ===========================================

/**
 * Detect if a Slack message contains a call topic announcement
 */
export async function detectTopicInMessage(
  messageText: string,
  channelContext?: string,
  expectingTopic?: boolean
): Promise<{
  isTopic: boolean;
  topic: string;
  description: string;
}> {
  const contextSection = channelContext
    ? `\n\nRecent channel context:\n${channelContext}`
    : '';

  const expectingNote = expectingTopic
    ? '\n\nNote: Someone recently asked about the topic in this channel, so this message is more likely to be a topic announcement response.'
    : '';

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 300,
    messages: [
      {
        role: 'user',
        content: `Analyze this Slack message to determine if it's announcing a topic for an upcoming training call.

Message: "${messageText}"${contextSection}${expectingNote}

Context: This is from a Slack channel where topics for weekly and monthly training calls are shared. Topic announcements are usually:
- A description of what will be covered in the upcoming call
- Often in response to someone asking "what's the topic for tomorrow?"
- May mention things like "checklist", "breakdown", "how to", "strategy", specific copywriting concepts, etc.
- Often formatted as "@person - Topic Name - Description" or similar
- Could come from Stefan or anyone else sharing on his behalf

NOT topic announcements:
- Casual conversation
- Thank you messages
- Simple acknowledgments like "K" or "will share soon"
- Questions asking about the topic
- Messages that say they'll share the topic later (but don't include it yet)
- General chat unrelated to upcoming calls

Respond in JSON format:
{
  "isTopic": true/false,
  "topic": "Short topic title (3-8 words) if isTopic is true, empty string if false",
  "description": "Brief description of what the topic covers if isTopic is true, empty string if false"
}

Only set isTopic to true if the message actually contains the topic content, not just a promise to share it later.`,
      },
    ],
  });

  try {
    const responseText =
      response.content[0].type === 'text' ? response.content[0].text : '';

    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        isTopic: parsed.isTopic === true,
        topic: parsed.topic || '',
        description: parsed.description || '',
      };
    }
  } catch (error) {
    console.error('Failed to parse topic detection response:', error);
  }

  return { isTopic: false, topic: '', description: '' };
}

// ===========================================
// Reminder Generation
// ===========================================

export interface ReminderGenerationContext {
  topic: string;
  callType: CallType;
  callTime: string; // e.g., "1 PM"
  callDay?: string; // e.g., "Tuesday"
  callDate?: string; // e.g., "February 4, 2026"
  zoomLink: string;
  lastSessionContext?: string;
}

/**
 * Generate a 1-sentence description for a reminder based on the topic
 */
export async function generateReminderDescription(
  topic: string,
  callType: CallType
): Promise<string> {
  const typeLabel = callType === 'weekly' ? 'Weekly Training Call' : 'Monthly Business Owner Call';

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 150,
    messages: [
      {
        role: 'user',
        content: `Write a single compelling sentence (15-25 words) describing what attendees will learn or gain from a CA Pro ${typeLabel} about "${topic}".

Rules:
- Start with an action verb or benefit
- Be specific about the value they'll get
- Don't use generic phrases like "learn about" or "discuss"
- Don't mention the call type or time
- Write from third person perspective (Stefan will share...)

Example topics and descriptions:
- "Email Funnel Breakdown" → "Stefan breaks down a high-converting email funnel and shows exactly what makes each piece work."
- "VSL Rewrite Session" → "Watch Stefan rewrite a struggling VSL live, explaining the psychology behind each change."
- "Q&A and Hot Seats" → "Get your copy questions answered live and see Stefan diagnose real funnels from members."

Now write a description for: "${topic}"`,
      },
    ],
  });

  const description =
    response.content[0].type === 'text'
      ? response.content[0].text.trim()
      : `Stefan covers ${topic} with actionable strategies you can implement immediately.`;

  // Clean up any quotes or extra formatting
  return description.replace(/^["']|["']$/g, '').trim();
}

// ===========================================
// Recap Generation
// ===========================================

/**
 * Extract a compelling quote from the transcript
 */
export async function extractQuote(
  transcript: string,
  topic: string,
  speakerName: string = 'Stefan'
): Promise<{ quote: string; speaker: string }> {
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 300,
    messages: [
      {
        role: 'user',
        content: `From this transcript, find a compelling direct quote from ${speakerName} that captures a key insight about "${topic}".

Rules for selecting the quote:
1. Must be an actual quote from the transcript (not paraphrased)
2. Should be 10-30 words
3. Must be self-contained and make sense without context
4. Should capture a valuable insight, strategy, or memorable statement
5. Avoid quotes that are just questions or mundane statements
6. Look for moments of teaching, revelation, or emphasis

Format your response as JSON:
{
  "quote": "the exact quote here",
  "speaker": "${speakerName}"
}

Transcript (first 8000 chars):
${transcript.substring(0, 8000)}`,
      },
    ],
  });

  try {
    const responseText =
      response.content[0].type === 'text' ? response.content[0].text : '';

    // Extract JSON from the response
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        quote: parsed.quote || 'Great insights shared on today\'s call.',
        speaker: parsed.speaker || speakerName,
      };
    }
  } catch (error) {
    console.error('Failed to parse quote extraction:', error);
  }

  return {
    quote: 'Great insights shared on today\'s call.',
    speaker: speakerName,
  };
}

/**
 * Generate structured recap content for all channels
 */
export async function generateStructuredRecap(
  transcript: string,
  topic: string,
  callType: CallType,
  speakerName: string = 'Stefan'
): Promise<StructuredRecap> {
  const isWeekly = callType === 'weekly';

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1500,
    messages: [
      {
        role: 'user',
        content: `Generate a structured recap of this ${isWeekly ? 'Weekly Training' : 'Monthly Business Owner'} call about "${topic}".

Output format (respond as JSON):
{
  "description": "A single sentence (15-25 words) recap of what was covered",
  "quote": "A compelling direct quote from ${speakerName} (10-30 words)",
  "speaker": "${speakerName}",
  ${isWeekly ? `"sections": [
    {
      "title": "First major topic heading (3-5 words)",
      "bullets": ["Bullet 1 (specific insight)", "Bullet 2", "Bullet 3"]
    },
    {
      "title": "Second major topic heading (3-5 words)",
      "bullets": ["Bullet 1", "Bullet 2", "Bullet 3"]
    }
  ]` : `"bullets": ["Key point 1 (specific insight)", "Key point 2", "Key point 3", "Key point 4"]`}
}

Rules:
- Description should be compelling and specific, not generic
- Quote must be an actual quote from the transcript
- Bullets should be actionable insights, not vague summaries
- Include specific details: names, numbers, tools mentioned
- ${isWeekly ? 'Create exactly 2 sections with 3 bullets each' : 'Create exactly 4 bullets'}
- Each bullet should be 10-20 words
- Use active voice and third person

Transcript:
${transcript.substring(0, 10000)}`,
      },
    ],
  });

  try {
    const responseText =
      response.content[0].type === 'text' ? response.content[0].text : '';

    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        description: parsed.description || `Key insights from the ${callType} call on ${topic}.`,
        quote: parsed.quote || 'Great insights shared on today\'s call.',
        speaker: parsed.speaker || speakerName,
        sections: parsed.sections || [],
        bullets: parsed.bullets || [],
      };
    }
  } catch (error) {
    console.error('Failed to parse structured recap:', error);
  }

  // Fallback
  return {
    description: `Key insights from the ${callType} call on ${topic}.`,
    quote: 'Great insights shared on today\'s call.',
    speaker: speakerName,
    sections: isWeekly ? [
      { title: 'Key Strategies', bullets: ['Strategy insight 1', 'Strategy insight 2', 'Strategy insight 3'] },
      { title: 'Implementation Tips', bullets: ['Tip 1', 'Tip 2', 'Tip 3'] },
    ] : [],
    bullets: isWeekly ? [] : ['Key point 1', 'Key point 2', 'Key point 3', 'Key point 4'],
  };
}

/**
 * Generate all recap formats from transcript
 * Returns formatted messages ready for each channel
 */
export async function generateAllRecaps(
  transcript: string,
  topic: string,
  callType: CallType,
  circleLink: string,
  driveLinks?: { video?: string; transcript?: string; chat?: string },
  youtubeId?: string
): Promise<GeneratedRecaps> {
  // Get the structured recap data
  const structured = await generateStructuredRecap(transcript, topic, callType);

  const isWeekly = callType === 'weekly';
  const callLabel = isWeekly ? 'Weekly Training Call' : 'Monthly Business Owner Call';

  // Format sections/bullets for templates
  let formattedSections = '';
  let formattedBullets = '';

  if (isWeekly && structured.sections.length >= 2) {
    formattedSections = structured.sections.map((section, i) => {
      const bullets = section.bullets.map(b => `• ${b}`).join('\n');
      return `**${section.title}**\n${bullets}`;
    }).join('\n\n');
  }

  if (structured.bullets.length > 0) {
    formattedBullets = structured.bullets.map(b => `• ${b}`).join('\n');
  }

  // Generate WhatsApp message
  let whatsapp = '';
  if (isWeekly) {
    whatsapp = `🎬 The Weekly Training Call recap is posted!

${structured.description}

"${structured.quote}" — ${structured.speaker} (live on the call)

📌 What You Missed

${formattedSections}

Check it out: ${circleLink}`;
  } else {
    whatsapp = `🎬 The Monthly Business Owner Call recap is posted!

${structured.description}

"${structured.quote}" — ${structured.speaker} (live on the call)

📌 What You Missed:
${formattedBullets}

Check it out: ${circleLink}`;
  }

  // Generate Email message
  let email = '';
  if (isWeekly) {
    email = `Hey [first name],

This week's training call is now posted in Circle.

${structured.description}

"${structured.quote}" — ${structured.speaker} (live on the call)

📌 What You Missed

${formattedSections}

Check it out here: ${circleLink}

Let us know in WhatsApp what you think.

—Stefan + Angela`;
  } else {
    email = `Hey [first name],

This month's Business Owner call is now posted in Circle.

${structured.description}

"${structured.quote}" — ${structured.speaker} (live on the call)

📌 What You Missed:
${formattedBullets}

Check it out here: ${circleLink}

Let us know in WhatsApp what you think.

—Stefan + Angela`;
  }

  // Generate Circle post body
  const videoEmbed = youtubeId ? `https://www.youtube.com/watch?v=${youtubeId}` : '';
  const resourcesSection = driveLinks ? `

---

**Resources**
- [Video](${driveLinks.video || '#'})
- [Call Transcript](${driveLinks.transcript || '#'})
- [Chat Transcript](${driveLinks.chat || '#'})` : '';

  let circle = '';
  if (isWeekly) {
    circle = `${videoEmbed}

${structured.description}

"${structured.quote}" — ${structured.speaker} (live on the call)

**📌 What You Missed**

${formattedSections}${resourcesSection}`;
  } else {
    circle = `${videoEmbed}

${structured.description}

"${structured.quote}" — ${structured.speaker} (live on the call)

**📌 What You Missed**
${formattedBullets}${resourcesSection}`;
  }

  return {
    whatsapp: whatsapp.trim(),
    email: email.trim(),
    circle: circle.trim(),
    structured,
  };
}
