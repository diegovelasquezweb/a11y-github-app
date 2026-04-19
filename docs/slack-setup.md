# Slack Integration Setup

**Navigation**: [Home](../README.md) • [Architecture](architecture.md) • [Commands](commands.md) • [Configuration](configuration.md) • [Runner Setup](runner-setup.md) • [Fix Engine](fix-engine.md) • [Slack Setup](slack-setup.md)

---

## Table of Contents

- [Overview](#overview)
- [Step 1: Create the Slack App](#step-1-create-the-slack-app)
- [Step 2: Configure Slash Command](#step-2-configure-slash-command)
- [Step 3: Enable Interactivity](#step-3-enable-interactivity)
- [Step 4: Add Bot Token Scopes](#step-4-add-bot-token-scopes)
- [Step 5: Install to Workspace](#step-5-install-to-workspace)
- [Step 6: Set Environment Variables](#step-6-set-environment-variables)
- [Step 7: Invite the Bot](#step-7-invite-the-bot)
- [Verifying the Setup](#verifying-the-setup)
- [How It Works](#how-it-works)
- [Disabling Slack Integration](#disabling-slack-integration)

---

## Overview

The Slack integration lets users trigger accessibility audits and fixes from any Slack channel. Commands open an interactive modal (Block Kit) where users select a repository, branch, and audit mode. Results are posted back to both Slack and GitHub.

The integration is **opt-in** — the app works exactly as before without Slack configured.

---

## Step 1: Create the Slack App

1. Go to [api.slack.com/apps](https://api.slack.com/apps)
2. Click **Create New App** → **From scratch**
3. Name: `A11y Audit` (or any name you prefer)
4. Pick your workspace
5. Click **Create App**

---

## Step 2: Configure Slash Command

1. In the app settings, go to **Slash Commands**
2. Click **Create New Command**
3. Fill in:

| Field | Value |
|-------|-------|
| Command | `/a11y` |
| Request URL | `https://<your-vercel-domain>/api/slack` |
| Short Description | Run accessibility audits |
| Usage Hint | (leave empty) |
| Escape channels, users, and links | OFF |

4. Click **Save**

---

## Step 3: Enable Interactivity

1. Go to **Interactivity & Shortcuts**
2. Toggle **Interactivity** to **On**
3. Set **Request URL** to: `https://<your-vercel-domain>/api/slack`
4. Click **Save Changes**

> The same endpoint handles both slash commands and modal interactions.

---

## Step 4: Add Bot Token Scopes

1. Go to **OAuth & Permissions**
2. Scroll to **Scopes** → **Bot Token Scopes**
3. Add these scopes:

| Scope | Why |
|-------|-----|
| `commands` | Receive the `/a11y` slash command |
| `chat:write` | Post and update messages in channels where the bot is invited |

Optional:

| Scope | Why |
|-------|-----|
| `chat:write.public` | Post to channels without explicit bot invite |

---

## Step 5: Install to Workspace

1. Go to **Install App** (or **OAuth & Permissions** → **Install to Workspace**)
2. Click **Install to Workspace** and authorize
3. Copy the **Bot User OAuth Token** (`xoxb-...`)
4. Go to **Basic Information** → scroll to **App Credentials**
5. Copy the **Signing Secret**

---

## Step 6: Set Environment Variables

In **Vercel → Project Settings → Environment Variables**, add:

| Variable | Value |
|----------|-------|
| `SLACK_BOT_TOKEN` | The `xoxb-...` token from step 5 |
| `SLACK_SIGNING_SECRET` | The signing secret from step 5 |

No redeploy needed if using Vercel's runtime env vars.

---

## Step 7: Invite the Bot

In any Slack channel where you want to use `/a11y`:

```
/invite @A11y Audit
```

Or mention the bot: `@A11y Audit` — Slack will prompt you to invite it.

> If you added the `chat:write.public` scope, this step is optional.

---

## Verifying the Setup

1. In a Slack channel, type `/a11y`
2. A modal should appear with fields for Repository, Branch, and Audit Mode
3. Paste a GitHub repository URL (e.g., `https://github.com/your-org/your-repo`), leave Branch empty, select "Full Audit"
4. Click **Run Audit**
5. A "⏳ Scanning..." message should appear in the channel
6. When the audit completes, the message updates with findings and Fix buttons

If the modal does not appear:
- Check that `SLACK_BOT_TOKEN` and `SLACK_SIGNING_SECRET` are set in Vercel
- Check that the Request URL matches your Vercel deployment URL
- Check the Vercel function logs for errors

---

## How It Works

```
User types /a11y in Slack
  → Modal opens (repo URL, branch, mode)
  → Submit: app dispatches GitHub Actions workflow
  → "⏳ Scanning..." message posted to channel
  → Workflow reports progress → message updates in real time:
      ▓░░░░░  Checking out repository…
      ▓▓░░░░  Installing dependencies…
      ▓▓▓░░░  Building project…
      ▓▓▓▓░░  Starting local server…
      ▓▓▓▓▓░  Running DOM scan…
      ▓▓▓▓▓▓  Running source pattern analysis…
  → Callback arrives at /api/scan-callback
  → Results posted to GitHub (PR/Issue comment) AND Slack (message updated)
  → Findings displayed with severity indicators (🟥 Critical, 🟧 Serious, 🟨 Moderate, 🟦 Minor)
  → "Fix All" button → opens fix modal (model + hint) → dispatches fix workflow
  → Individual "Fix" buttons per finding → same flow
```

Slack is only the messaging layer. All audit/fix logic, workflow dispatch, and GitHub integration remain unchanged.

### Endpoints

| Endpoint | Purpose |
|----------|---------|
| `api/slack` | Receives slash commands, modal submissions, and button actions |
| `api/slack-progress` | Receives progress updates from workflows to update the Slack message in real time |

---

## Disabling Slack Integration

Remove or clear `SLACK_BOT_TOKEN` in Vercel. The `/api/slack` endpoint returns 503 and all Slack code paths become no-ops. No code changes or redeployment needed.
