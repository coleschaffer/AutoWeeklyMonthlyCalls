# CA Pro Call Automation - Complete Flow

This document describes the complete automation flow for CA Pro weekly and monthly training calls.

---

## Table of Contents

1. [Pre-Call Reminders](#pre-call-reminders)
2. [Post-Call Processing Pipeline](#post-call-processing-pipeline)
3. [Circle Post Format](#circle-post-format)
4. [Manual Trigger Endpoints](#manual-trigger-endpoints)
5. [Environment Variables](#environment-variables)

---

## Pre-Call Reminders

Reminders are sent automatically via cron jobs to both email (ActiveCampaign) and WhatsApp (Twilio).

**Important:** Reminders now check **Zoom's actual schedule** before sending. If a call is cancelled or not scheduled in Zoom, no reminder will be sent. This prevents errors during holidays (e.g., Christmas week) or schedule changes.

### Weekly Calls (Tuesdays at 1 PM ET)

| When | Cron | What Happens |
|------|------|--------------|
| **Monday 1 PM** | `0 13 * * 1` | Check Zoom → If call tomorrow, send Email + WhatsApp |
| **Tuesday 12 PM** | `0 12 * * 2` | Check Zoom → If call today, send Email + WhatsApp |

### Monthly Calls (Every 4 weeks on Monday at 2 PM ET)

| When | Cron | What Happens |
|------|------|--------------|
| **Week before (Monday 9 AM)** | `0 9 * * 1` | Check Zoom → If monthly call in 5-10 days, send reminder |
| **Day before (Sunday 1 PM)** | `0 13 * * 0` | Check Zoom → If monthly call tomorrow, send reminder |
| **Day of (Monday 1 PM)** | `0 13 * * 1` | Check Zoom → If monthly call today, send reminder |

> **Schedule Source:** All reminders are driven by **Zoom's scheduled meetings**, not calculated dates.
> - If a call is cancelled in Zoom → No reminder sent
> - If schedule changes → Reminders automatically adjust
> - Endpoint `GET /api/upcoming-calls` shows what Zoom has scheduled

---

## Post-Call Processing Pipeline

When a Zoom recording finishes processing, the `recording.completed` webhook triggers automatic processing.

```
Zoom Recording Completes
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  STEP 1: RECEIVE WEBHOOK                                        │
│  • Zoom sends POST to /webhooks/zoom                            │
│  • Validate signature using ZOOM_WEBHOOK_SECRET                 │
│  • Extract meeting ID and topic                                 │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  STEP 2: FETCH RECORDING DETAILS                                │
│  • Call Zoom API to get recording files                         │
│  • Identify: video URL, transcript URL, chat URL                │
│  • Detect call type (weekly/monthly) from meeting topic         │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  STEP 3: PROCESS TRANSCRIPT                                     │
│  • Download raw VTT transcript from Zoom                        │
│  • Parse into structured segments with timestamps               │
│  • Find conversation start (skip "Hi", "Can you hear me?")      │
│  • Calculate trim point: 2 seconds before first real speech     │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  STEP 4: DOWNLOAD VIDEO                                         │
│  • Download MP4 from Zoom Cloud to temp storage                 │
│  • File saved to /tmp/ca-pro-videos/                            │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  STEP 5: AI-POWERED TRIM                                        │
│  • Use FFmpeg to trim video from calculated start point         │
│  • Stream copy (no re-encoding) for speed                       │
│  • Add faststart flag for web playback                          │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  STEP 6: GENERATE AI SUMMARY (Claude Opus 4.5)                  │
│                                                                 │
│  Input: Full transcript text                                    │
│                                                                 │
│  Output:                                                        │
│  • Description: 2-3 sentences                                   │
│  • Summary: 6-8 bullets with **Bold Heading**: format           │
│  • Key Takeaways: 4-6 actionable insights                       │
│                                                                 │
│  Tone: Third-person, active voice, specific details             │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  STEP 7: UPLOAD TO YOUTUBE (Unlisted)                           │
│                                                                 │
│  Title format:                                                  │
│  "January 28, 2026 - CA Pro Weekly Training: [Topic]"           │
│                                                                 │
│  • Privacy: Unlisted                                            │
│  • Category: Education                                          │
│  • Description: AI-generated summary                            │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  STEP 8: UPLOAD TO GOOGLE DRIVE                                 │
│                                                                 │
│  Folder structure:                                              │
│  CA Pro Weekly Training Calls/                                  │
│  └── 2026.01.28/                                                │
│      ├── 2026.01.28_Topic_Name.mp4                              │
│      ├── 2026.01.28_Topic_Name_transcript.vtt                   │
│      └── 2026.01.28_Topic_Name_chat.txt                         │
│                                                                 │
│  OR for monthly:                                                │
│  CA Pro Business Owner Calls/                                   │
│  └── 2026.01.27/                                                │
│      └── [same file structure]                                  │
│                                                                 │
│  • All files set to "Anyone with link can view"                 │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  STEP 9: POST TO CIRCLE                                         │
│                                                                 │
│  Title: "January 28, 2026 - CA Pro Weekly Training: [Topic]"    │
│                                                                 │
│  Body:                                                          │
│  • Embedded YouTube video                                       │
│  • Description (2-3 sentences)                                  │
│  • Summary section (6-8 bullets)                                │
│  • Key Takeaways section (4-6 bullets)                          │
│  • Resources links to Drive files                               │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  STEP 10: SEND FOLLOW-UP NOTIFICATIONS                          │
│                                                                 │
│  Email (ActiveCampaign):                                        │
│  • Subject: "New Recording: [Topic]"                            │
│  • Body: Summary + link to Circle post                          │
│                                                                 │
│  WhatsApp (Twilio):                                             │
│  • "🎬 New CA Pro [Weekly/Monthly] Training Available!"         │
│  • Topic + Circle link                                          │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  CLEANUP                                                        │
│  • Delete temp video files from /tmp                            │
│  • Log completion status                                        │
└─────────────────────────────────────────────────────────────────┘
```

---

## Circle Post Format

### Example Output

```
┌──────────────────────────────────────────────────────────────────┐
│  January 28, 2026 - CA Pro Weekly Training:                      │
│  Simplifying Sales Arguments & Fixing Copy Logic                 │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │              [YouTube Video Player Embedded]               │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│  Stefan leads a training session focused on sales argument       │
│  simplification and copy logic. The call features live funnel    │
│  breakdowns and rewrite demonstrations, with Stefan analyzing    │
│  a $97 supplement VSL and identifying conversion blockers.       │
│                                                                  │
│  **Summary**                                                     │
│                                                                  │
│  **Funnel Diagnostics**: Stefan walked through a supplement      │
│  funnel with a 2.1% conversion rate, identifying that the        │
│  headline buried the main mechanism. The fix involved moving     │
│  the "cellular reset" angle to the first fold.                   │
│                                                                  │
│  **Ad Structure Analysis**: The Facebook ad used education-      │
│  first positioning but failed to bridge to the product. Stefan   │
│  demonstrated a rewrite using the "problem-agitate-mechanism"    │
│  framework to increase click-through intent.                     │
│                                                                  │
│  **Price Anchoring Strategy**: Stefan broke down how the $97     │
│  offer felt expensive without proper anchoring. Added a          │
│  comparison to monthly supplement costs ($3.23/day vs $5+/day    │
│  alternatives) to reframe value perception.                      │
│                                                                  │
│  **Checkout Flow Optimization**: The original checkout had 6     │
│  form fields above the fold. Stefan recommended reducing to 3    │
│  with progressive disclosure, citing a case study showing 23%    │
│  lift from similar changes.                                      │
│                                                                  │
│  **Objection Handling Section**: Stefan identified missing       │
│  FAQ content for the top 3 objections: ingredient sourcing,      │
│  money-back guarantee clarity, and shipping timeline. Added      │
│  specific copy recommendations for each.                         │
│                                                                  │
│  **Email Sequence Review**: The post-purchase sequence jumped    │
│  straight to upsells. Stefan suggested a "win reinforcement"     │
│  email on day 2 before any additional offers.                    │
│                                                                  │
│  **Key Takeaways**                                               │
│                                                                  │
│  • Always lead with the mechanism in health offers - the         │
│    "how it works" builds credibility before the pitch            │
│  • Price anchoring works best when comparing to familiar         │
│    daily costs, not lump sum alternatives                        │
│  • Education-first ads need a clear "bridge sentence" that       │
│    transitions from value to offer                               │
│  • Test moving your strongest proof point above the fold         │
│  • Post-purchase emails should reinforce the buying decision     │
│    before introducing upsells                                    │
│                                                                  │
│  ───────────────────────────────────────────────────────────     │
│                                                                  │
│  **Resources**                                                   │
│  - [Video](https://drive.google.com/file/d/xxx/view)             │
│  - [Call Transcript](https://drive.google.com/file/d/xxx/view)   │
│  - [Chat Transcript](https://drive.google.com/file/d/xxx/view)   │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

### AI Prompt Guidelines

| Section | Format |
|---------|--------|
| **Description** | 2-3 sentences: "[Name] leads a [session type] focused on [topic]..." |
| **Summary** | 6-8 bullets with `**Bold Heading**: Details...` format |
| **Key Takeaways** | 4-6 actionable insights as plain bullets |
| **Resources** | Links to Video, Transcript, Chat on Drive |

### Tone Rules

1. **Third-person only**: "Stefan shared" not "I shared"
2. **Active voice**: "Stefan broke down" not "was broken down"
3. **Observational, not promotional**: Describe what happened without evaluating quality
4. **Specific over vague**: Use exact numbers, names, and details from the transcript
5. **Industry jargon acceptable**: VSL, AOV, advertorial, mechanism, funnel, etc.
6. **No timestamps**: Summarize topics, don't reference time codes
7. **No filler**: Every sentence must carry information

---

## Manual Trigger Endpoints

### Process a Recording Manually

```bash
POST /api/process-call?meetingId=YOUR_MEETING_ID
```

Use this to:
- Reprocess a failed recording
- Test the pipeline with a specific meeting

### Test Reminders

```bash
# Weekly reminders
POST /api/reminders/weekly/day-before
POST /api/reminders/weekly/hour-before

# Monthly reminders
POST /api/reminders/monthly/week-before
POST /api/reminders/monthly/day-before
POST /api/reminders/monthly/day-of
```

### View Upcoming Calls from Zoom

```bash
GET /api/upcoming-calls
```

Returns scheduled calls from Zoom calendar:

```json
{
  "success": true,
  "data": {
    "upcomingCalls": [
      {
        "id": "123456789",
        "topic": "CA PRO Weekly Training Call",
        "type": "weekly",
        "startTime": "2026-02-03T18:00:00.000Z",
        "startTimeLocal": "Tuesday, February 3, 2026, 1:00 PM"
      },
      {
        "id": "987654321",
        "topic": "CA Pro Monthly Business Owners",
        "type": "monthly",
        "startTime": "2026-02-16T19:00:00.000Z",
        "startTimeLocal": "Monday, February 16, 2026, 2:00 PM"
      }
    ],
    "nextWeeklyCall": { ... },
    "nextMonthlyCall": { ... }
  }
}
```

### Check System Status

```bash
GET /api/status
```

Returns which services are configured:

```json
{
  "success": true,
  "data": {
    "environment": "production",
    "configured": {
      "zoom": true,
      "google": true,
      "activeCampaign": true,
      "twilio": true,
      "circle": true,
      "anthropic": true
    }
  }
}
```

### Health Check

```bash
GET /health
```

---

## Environment Variables

### Required Variables

| Variable | Description |
|----------|-------------|
| **Zoom** | |
| `ZOOM_ACCOUNT_ID` | Server-to-Server OAuth Account ID |
| `ZOOM_CLIENT_ID` | OAuth Client ID |
| `ZOOM_CLIENT_SECRET` | OAuth Client Secret |
| `ZOOM_WEBHOOK_SECRET` | Webhook validation secret token |
| **Google** | |
| `GOOGLE_CLIENT_ID` | OAuth 2.0 Client ID |
| `GOOGLE_CLIENT_SECRET` | OAuth 2.0 Client Secret |
| `GOOGLE_REFRESH_TOKEN` | OAuth refresh token (from setup script) |
| `YOUTUBE_CHANNEL_ID` | YouTube channel ID (starts with UC) |
| `DRIVE_FOLDER_ID` | Main recordings folder ID |
| `DRIVE_WEEKLY_FOLDER_ID` | Weekly calls folder ID |
| `DRIVE_MONTHLY_FOLDER_ID` | Monthly calls folder ID |
| **ActiveCampaign** | |
| `ACTIVECAMPAIGN_API_URL` | API URL (https://xxx.api-us1.com) |
| `ACTIVECAMPAIGN_API_KEY` | API Key |
| `ACTIVECAMPAIGN_LIST_ID` | List ID for CA Pro members |
| **Twilio** | |
| `TWILIO_ACCOUNT_SID` | Account SID |
| `TWILIO_AUTH_TOKEN` | Auth Token |
| `TWILIO_WHATSAPP_NUMBER` | WhatsApp sender number |
| `WHATSAPP_GROUP_NUMBERS` | Comma-separated recipient numbers |
| **Circle** | |
| `CIRCLE_API_KEY` | API Key |
| `CIRCLE_COMMUNITY_ID` | Community ID |
| `CIRCLE_SPACE_ID` | Space ID for posting |
| **Anthropic** | |
| `ANTHROPIC_API_KEY` | Claude API Key |
| **App** | |
| `PORT` | Server port (default: 3000) |
| `NODE_ENV` | Environment (production/development) |
| `TIMEZONE` | Timezone for cron jobs (default: America/New_York) |

---

## Deployment

### Railway

1. Push to GitHub
2. Connect repo to Railway
3. Add all environment variables
4. Set custom domain or use Railway-provided URL
5. Configure Zoom webhook to point to `/webhooks/zoom`

### Local Development

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Type check
npm run typecheck

# Run tests
npm test
```
