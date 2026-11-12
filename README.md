# Life OS — Personal Executive Command Center

> An intelligent, autonomous personal life operating system that unifies Apple Calendar, Apple Reminders, and Gmail into a centralized command dashboard with a cloud-scheduled 8:00 AM AI Daily Briefing.

---

## Architecture Overview

Life OS runs a full-stack, cloud-first serverless architecture with **zero local device dependencies** and **$0.00/mo operating costs**:

* **Frontend:** Next.js 15 (App Router, React 19, TypeScript, Tailwind CSS, Lucide Icons, PWA).
* **AI Engine:** Google AI Studio Gemini API (`gemini-3.1-flash-lite`, `gemini-3.5-flash-lite`) with structured JSON schema outputs.
* **Apple Integrations:** Direct bidirectional RFC 4791 CalDAV client connecting to `caldav.icloud.com` for Calendar events (`VEVENT`) and Reminders (`VTODO`).
* **Google Integration:** Google Cloud OAuth 2.0 with offline refresh token rotation communicating with the Gmail REST API.
* **Database & Persistence:** Supabase PostgreSQL for historical briefings, sync health telemetry, and action proposals.
* **Automated Cloud Cron:** Vercel Cron scheduled daily at `0 0 * * *` (00:00 UTC = 8:00 AM Malaysia Time).

---

## Features

1. **Executive Command Center:** Glanceable situational awareness in under 10 seconds—schedule, priorities, unread correspondence, and sync health.
2. **AI Daily Briefing:** Synthesized executive summary generated daily at 8:00 AM MYT, complete with Web Speech audio reading and on-demand AI re-synthesis.
3. **Top 3 Priorities:** Grounded, non-negotiable focus items synthesized from calendar meetings, deadlines, and urgent emails.
4. **Interactive Apple Calendar:** Multi-day event expansion (e.g., Shanghai Fair across Nov 16–17), upcoming vs. past event tabs, and date headers.
5. **Two-Way Apple Reminders:** Live interactive task completion that checks off tasks on your iPhone/Mac in real time via CalDAV, with quick-add task modal.
6. **Priority Gmail Triage:** Fast preview of unread threads with 1-click "Convert to Reminder" workflow.
7. **Conversational Life Assistant:** Slide-over assistant drawer grounded exclusively in live ground-truth data (no hallucinations).
8. **Progressive Web App (PWA):** Installable on macOS and iOS with standalone app shell, service worker offline caching, and responsive bento grid.

---

## Local Setup

### 1. Clone & Install
```bash
git clone https://github.com/CreatifMind/Life-OS.git
cd Life-OS
npm install
```

### 2. Configure Environment
Copy `.env.example` to `.env.local` and populate the keys:
```bash
cp .env.example .env.local
```

### 3. Initialize Database
Initialize the Supabase PostgreSQL tables:
```bash
node scripts/init-db.mjs
```

### 4. Verify Apple CalDAV & Gmail
```bash
node scripts/test-apple-sync.mjs
node scripts/auth-gmail.mjs
```

### 5. Run Development Server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## Vercel Deployment Guide

1. **Push to GitHub:** Push your code to `https://github.com/CreatifMind/Life-OS`.
2. **Import to Vercel:** Create a new project on [Vercel](https://vercel.com) and select this repository.
3. **Set Environment Variables:** Add the variables from `.env.local` in Vercel Project Settings:
   - `APPLE_ID`
   - `APPLE_APP_SPECIFIC_PASSWORD`
   - `GEMINI_API_KEY`
   - `DATABASE_URL`
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`
   - `GOOGLE_REFRESH_TOKEN`
   - `USER_NAME` / `NEXT_PUBLIC_USER_NAME`
   - `APP_TIMEZONE` / `TIMEZONE_OFFSET`
   - `CRON_SECRET`
4. **Google Cloud OAuth Redirect URI:**
   In [Google Cloud Console](https://console.cloud.google.com/), add your production URL to Authorized Redirect URIs:
   `https://<your-project>.vercel.app/api/auth/callback/google`
5. **Automated Cron:** Vercel automatically detects `vercel.json` and runs `/api/cron/briefing` daily at 00:00 UTC (8:00 AM MYT).

---

## License
MIT
