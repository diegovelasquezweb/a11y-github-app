# Jira Integration Setup

**Navigation**: [Home](../README.md) • [Architecture](architecture.md) • [Commands](commands.md) • [Configuration](configuration.md) • [Runner Setup](runner-setup.md) • [Fix Engine](fix-engine.md) • [Slack Setup](slack-setup.md) • [Jira Setup](jira-setup.md)

---

## Table of Contents

- [Overview](#overview)
- [Step 1: Create a Jira Cloud workspace](#step-1-create-a-jira-cloud-workspace)
- [Step 2: Create a project](#step-2-create-a-project)
- [Step 3: Generate an API token](#step-3-generate-an-api-token)
- [Step 4: Set environment variables in Vercel](#step-4-set-environment-variables-in-vercel)
- [Step 5: Verify the issue type](#step-5-verify-the-issue-type)
- [How it works](#how-it-works)
- [Ticket types](#ticket-types)
- [Disabling the integration](#disabling-the-integration)

---

## Overview

The Jira integration lets users create Jira tickets directly from Slack audit results — either one ticket per finding or a single summary ticket for all findings.

The integration is **opt-in**: when `JIRA_BASE_URL` is not set, the "Create Jira Ticket" buttons open a pre-filled Jira URL in the browser (existing behavior). No behavior changes until all five env vars are configured.

---

## Step 1: Create a Jira Cloud workspace

If you don't have a Jira Cloud instance:

1. Go to [atlassian.com/software/jira](https://www.atlassian.com/software/jira)
2. Click **Get it free**
3. Create a workspace — your URL will be `https://<workspace>.atlassian.net`

---

## Step 2: Create a project

1. Inside your Jira workspace, click **Create project**
2. Choose **Scrum**, **Kanban**, or **Bug tracking** — any type works
3. Note the **Project Key** shown during setup (e.g. `A11Y`, `WEB`) — this goes in `JIRA_PROJECT_KEY`

---

## Step 3: Generate an API token

1. Go to [id.atlassian.com/manage-profile/security/api-tokens](https://id.atlassian.com/manage-profile/security/api-tokens)
2. Click **Create API token**
3. Give it a label (e.g. `a11y-app`) and click **Create**
4. Copy the token — **it is shown only once**

---

## Step 4: Set environment variables in Vercel

In **Vercel → Project Settings → Environment Variables**, add:

| Variable | Value |
|----------|-------|
| `JIRA_BASE_URL` | `https://<workspace>.atlassian.net` |
| `JIRA_EMAIL` | Your Atlassian account email |
| `JIRA_API_TOKEN` | Token from step 3 |
| `JIRA_PROJECT_KEY` | Project key from step 2 (e.g. `A11Y`) |
| `JIRA_ISSUE_TYPE` | `Bug` (or any issue type that exists in your project) |

No redeploy needed — Vercel applies env var changes on the next request.

---

## Step 5: Verify the issue type

The value of `JIRA_ISSUE_TYPE` must match an issue type that exists in your project.

To check:
1. Go to your Jira project → **Project settings** → **Issue types**
2. Confirm `Bug` (or whatever you set) is listed

If it does not exist, use `Task` or any type shown in the list.

---

## How it works

```
User clicks "Create Jira Ticket" in Slack
  → Slack fires block_actions to /api/slack
  → App ACKs HTTP 200 immediately (Slack 3s deadline met)
  → App calls Jira REST API v3 in the background (waitUntil)
  → On success: ephemeral reply with the ticket URL
  → On failure: ephemeral error message with remediation hint
```

The Jira API call happens after the HTTP response is sent. Slack receives the ACK within the 3-second window regardless of Jira's response time.

---

## Ticket types

### Per-finding ticket

Clicking `...` → **Create Jira Ticket** on a specific finding creates a ticket with:

- **Summary**: `[severity] finding title`
- **Description**: Finding ID, severity, title, repo, branch
- **Issue type**: value of `JIRA_ISSUE_TYPE`
- **Priority**: not set — uses the project default

### Bulk ticket

Clicking **Create Jira Ticket** at the bottom of the audit result creates a single summary ticket with:

- **Summary**: `A11y Audit: N findings in owner/repo`
- **Description**: repo, branch, total count, breakdown by severity (Critical / Serious / Moderate / Minor)
- **Issue type**: value of `JIRA_ISSUE_TYPE`
- **Priority**: not set

> A11y severity (Critical/Serious/Moderate/Minor) is **not** mapped to Jira priority. They are different concepts — a11y severity is accessibility impact; Jira priority is business urgency. Severity appears in the description body only.

---

## Disabling the integration

Clear or remove `JIRA_BASE_URL` in Vercel. The buttons revert to pre-filled browser URLs immediately. No code changes needed.
