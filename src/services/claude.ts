import Anthropic from '@anthropic-ai/sdk';
import { env } from '../config/env.js';
import type { CallSummary } from '../types/index.js';

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
