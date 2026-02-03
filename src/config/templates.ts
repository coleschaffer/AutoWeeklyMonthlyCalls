import type { CallType } from '../types/index.js';

// ===========================================
// Template Types
// ===========================================

export type MessageChannel = 'whatsapp' | 'email' | 'circle';
export type MessageType = 'reminder' | 'recap';
export type ReminderTiming = 'dayBefore' | 'dayOf';

// Template IDs for lookup
export const TEMPLATE_IDS = {
  // Reminders
  WHATSAPP_WEEKLY_REMINDER_DAY_BEFORE: 'whatsapp-weekly-reminder-dayBefore',
  WHATSAPP_WEEKLY_REMINDER_DAY_OF: 'whatsapp-weekly-reminder-dayOf',
  WHATSAPP_MONTHLY_REMINDER_DAY_OF: 'whatsapp-monthly-reminder-dayOf',
  EMAIL_WEEKLY_REMINDER_DAY_OF: 'email-weekly-reminder-dayOf',
  EMAIL_MONTHLY_REMINDER_DAY_OF: 'email-monthly-reminder-dayOf',
  // Recaps
  WHATSAPP_WEEKLY_RECAP: 'whatsapp-weekly-recap',
  WHATSAPP_MONTHLY_RECAP: 'whatsapp-monthly-recap',
  EMAIL_WEEKLY_RECAP: 'email-weekly-recap',
  EMAIL_MONTHLY_RECAP: 'email-monthly-recap',
  CIRCLE_WEEKLY_RECAP: 'circle-weekly-recap',
  CIRCLE_MONTHLY_RECAP: 'circle-monthly-recap',
} as const;

export interface MessageTemplate {
  id: string;
  name: string;
  channel: MessageChannel;
  type: MessageType;
  callType: CallType;
  timing?: ReminderTiming;
  template: string;
}

// ===========================================
// WhatsApp Reminder Templates
// ===========================================

export const WHATSAPP_WEEKLY_REMINDER_DAY_BEFORE: MessageTemplate = {
  id: 'whatsapp-weekly-reminder-dayBefore',
  name: 'WhatsApp Weekly Reminder (Day Before)',
  channel: 'whatsapp',
  type: 'reminder',
  callType: 'weekly',
  timing: 'dayBefore',
  template: `📣 Tomorrow is our Weekly Training Call!
⏰ {{day}}, {{date}} @ {{time}} EST
✏️ {{topic}}

{{description}}

{{lastSessionContext}}

Join Here: {{zoomLink}}`,
};

export const WHATSAPP_WEEKLY_REMINDER_DAY_OF: MessageTemplate = {
  id: 'whatsapp-weekly-reminder-dayOf',
  name: 'WhatsApp Weekly Reminder (Day Of)',
  channel: 'whatsapp',
  type: 'reminder',
  callType: 'weekly',
  timing: 'dayOf',
  template: `📣 Today's Weekly Training Call starts @ {{time}} EST!

{{description}}

Join Here: {{zoomLink}}`,
};

export const WHATSAPP_MONTHLY_REMINDER_DAY_OF: MessageTemplate = {
  id: 'whatsapp-monthly-reminder-dayOf',
  name: 'WhatsApp Monthly Reminder (Day Of)',
  channel: 'whatsapp',
  type: 'reminder',
  callType: 'monthly',
  timing: 'dayOf',
  template: `📣 Today's Monthly Business Owner Call starts @ {{time}} EST!

{{description}}

Join Here: {{zoomLink}}`,
};

// ===========================================
// Email Reminder Templates
// ===========================================

export const EMAIL_WEEKLY_REMINDER_DAY_OF: MessageTemplate = {
  id: 'email-weekly-reminder-dayOf',
  name: 'Email Weekly Reminder (Day Of)',
  channel: 'email',
  type: 'reminder',
  callType: 'weekly',
  timing: 'dayOf',
  template: `Hey [first name],

Quick reminder - for today's Weekly Training Call, Stefan's doing {{topic}}.

{{description}}

The call is today @ {{time}} EST.

Join here: {{zoomLink}}

See you there,
CA PRO Team`,
};

export const EMAIL_MONTHLY_REMINDER_DAY_OF: MessageTemplate = {
  id: 'email-monthly-reminder-dayOf',
  name: 'Email Monthly Reminder (Day Of)',
  channel: 'email',
  type: 'reminder',
  callType: 'monthly',
  timing: 'dayOf',
  template: `Hey [first name],

Just a quick reminder that our Monthly Business Owner Call with Stefan kicks off today @ {{time}} EST.

{{description}}

Join here: {{zoomLink}}

See you there,
CA PRO Team`,
};

// ===========================================
// WhatsApp Recap Templates
// ===========================================

export const WHATSAPP_WEEKLY_RECAP: MessageTemplate = {
  id: 'whatsapp-weekly-recap',
  name: 'WhatsApp Weekly Recap',
  channel: 'whatsapp',
  type: 'recap',
  callType: 'weekly',
  template: `🎬 The Weekly Training Call recap is posted!

{{description}}

"{{quote}}" — {{speaker}} (live on the call)

📌 What You Missed

{{section1Title}}
{{section1Bullets}}

{{section2Title}}
{{section2Bullets}}

Check it out: {{circleLink}}`,
};

export const WHATSAPP_MONTHLY_RECAP: MessageTemplate = {
  id: 'whatsapp-monthly-recap',
  name: 'WhatsApp Monthly Recap',
  channel: 'whatsapp',
  type: 'recap',
  callType: 'monthly',
  template: `🎬 The Monthly Business Owner Call recap is posted!

{{description}}

"{{quote}}" — {{speaker}} (live on the call)

📌 What You Missed:
{{bullets}}

Check it out: {{circleLink}}`,
};

// ===========================================
// Email Recap Templates
// ===========================================

export const EMAIL_WEEKLY_RECAP: MessageTemplate = {
  id: 'email-weekly-recap',
  name: 'Email Weekly Recap',
  channel: 'email',
  type: 'recap',
  callType: 'weekly',
  template: `Hey [first name],

This week's training call is now posted in Circle.

{{description}}

"{{quote}}" — {{speaker}} (live on the call)

📌 What You Missed

{{section1Title}}
{{section1Bullets}}

{{section2Title}}
{{section2Bullets}}

Check it out here: {{circleLink}}

Let us know in WhatsApp what you think.

—Stefan + Angela`,
};

export const EMAIL_MONTHLY_RECAP: MessageTemplate = {
  id: 'email-monthly-recap',
  name: 'Email Monthly Recap',
  channel: 'email',
  type: 'recap',
  callType: 'monthly',
  template: `Hey [first name],

This month's Business Owner call is now posted in Circle.

{{description}}

"{{quote}}" — {{speaker}} (live on the call)

📌 What You Missed:
{{bullets}}

Check it out here: {{circleLink}}

Let us know in WhatsApp what you think.

—Stefan + Angela`,
};

// ===========================================
// Circle Recap Templates
// ===========================================

export const CIRCLE_WEEKLY_RECAP: MessageTemplate = {
  id: 'circle-weekly-recap',
  name: 'Circle Weekly Recap',
  channel: 'circle',
  type: 'recap',
  callType: 'weekly',
  template: `{{videoEmbed}}

{{description}}

"{{quote}}" — {{speaker}} (live on the call)

**📌 What You Missed**

{{section1Title}}
{{section1Bullets}}

{{section2Title}}
{{section2Bullets}}

---

**Resources**
- [Video]({{driveVideoLink}})
- [Call Transcript]({{driveTranscriptLink}})
- [Chat Transcript]({{driveChatLink}})`,
};

export const CIRCLE_MONTHLY_RECAP: MessageTemplate = {
  id: 'circle-monthly-recap',
  name: 'Circle Monthly Recap',
  channel: 'circle',
  type: 'recap',
  callType: 'monthly',
  template: `{{videoEmbed}}

{{description}}

"{{quote}}" — {{speaker}} (live on the call)

**📌 What You Missed**
{{bullets}}

---

**Resources**
- [Video]({{driveVideoLink}})
- [Call Transcript]({{driveTranscriptLink}})
- [Chat Transcript]({{driveChatLink}})`,
};

// ===========================================
// Template Lookup Functions
// ===========================================

export function getReminderTemplates(
  callType: CallType,
  timing: ReminderTiming
): { whatsapp: MessageTemplate | null; email: MessageTemplate | null } {
  const templates = {
    whatsapp: null as MessageTemplate | null,
    email: null as MessageTemplate | null,
  };

  if (callType === 'weekly') {
    if (timing === 'dayBefore') {
      templates.whatsapp = WHATSAPP_WEEKLY_REMINDER_DAY_BEFORE;
      // No email day-before template
    } else if (timing === 'dayOf') {
      templates.whatsapp = WHATSAPP_WEEKLY_REMINDER_DAY_OF;
      templates.email = EMAIL_WEEKLY_REMINDER_DAY_OF;
    }
  } else if (callType === 'monthly') {
    if (timing === 'dayOf') {
      templates.whatsapp = WHATSAPP_MONTHLY_REMINDER_DAY_OF;
      templates.email = EMAIL_MONTHLY_REMINDER_DAY_OF;
    }
  }

  return templates;
}

export function getRecapTemplates(callType: CallType): {
  whatsapp: MessageTemplate;
  email: MessageTemplate;
  circle: MessageTemplate;
} {
  if (callType === 'weekly') {
    return {
      whatsapp: WHATSAPP_WEEKLY_RECAP,
      email: EMAIL_WEEKLY_RECAP,
      circle: CIRCLE_WEEKLY_RECAP,
    };
  } else {
    return {
      whatsapp: WHATSAPP_MONTHLY_RECAP,
      email: EMAIL_MONTHLY_RECAP,
      circle: CIRCLE_MONTHLY_RECAP,
    };
  }
}

/**
 * Get all available templates for a given call type
 */
export function getAllTemplates(callType: CallType): {
  reminders: {
    dayBefore: { whatsapp: MessageTemplate | null; email: MessageTemplate | null };
    dayOf: { whatsapp: MessageTemplate | null; email: MessageTemplate | null };
  };
  recaps: {
    whatsapp: MessageTemplate;
    email: MessageTemplate;
    circle: MessageTemplate;
  };
} {
  return {
    reminders: {
      dayBefore: getReminderTemplates(callType, 'dayBefore'),
      dayOf: getReminderTemplates(callType, 'dayOf'),
    },
    recaps: getRecapTemplates(callType),
  };
}

// ===========================================
// Template Rendering
// ===========================================

export interface ReminderContext {
  topic: string;
  description: string;
  day?: string; // e.g., "Tuesday"
  date?: string; // e.g., "February 4, 2026"
  time: string; // e.g., "1 PM"
  zoomLink: string;
  lastSessionContext?: string;
}

export interface RecapContext {
  description: string;
  quote: string;
  speaker: string;
  circleLink: string;
  // For weekly (sectioned)
  section1Title?: string;
  section1Bullets?: string;
  section2Title?: string;
  section2Bullets?: string;
  // For monthly (plain bullets)
  bullets?: string;
  // For Circle posts
  videoEmbed?: string;
  driveVideoLink?: string;
  driveTranscriptLink?: string;
  driveChatLink?: string;
}

/**
 * Render a template with context values
 */
export function renderTemplate(
  template: MessageTemplate,
  context: ReminderContext | RecapContext
): string {
  let result = template.template;

  // Replace all placeholders
  for (const [key, value] of Object.entries(context)) {
    if (value !== undefined && value !== null) {
      const placeholder = `{{${key}}}`;
      result = result.replace(new RegExp(placeholder, 'g'), value);
    }
  }

  // Remove any unreplaced optional placeholders
  result = result.replace(/\{\{[^}]+\}\}\n?/g, '');

  // Clean up multiple consecutive newlines
  result = result.replace(/\n{3,}/g, '\n\n');

  return result.trim();
}
