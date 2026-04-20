# Jira Integration Setup

**Navigation**: [Home](../README.md) • [Architecture](architecture.md) • [Commands](commands.md) • [Configuration](configuration.md) • [Runner Setup](runner-setup.md) • [Fix Engine](fix-engine.md) • [Slack Setup](slack-setup.md) • [Jira Setup](jira-setup.md)

---

## Table of Contents

- [Overview](#overview)
- [Step 1: Generate a Jira API token](#step-1-generate-a-jira-api-token)
- [Step 2: Set environment variables in Vercel](#step-2-set-environment-variables-in-vercel)
- [How ticket creation works](#how-ticket-creation-works)
- [Ticket content](#ticket-content)
- [Disabling the integration](#disabling-the-integration)

---

## Overview

The Jira integration lets users create Jira tickets directly from Slack audit results — either one ticket per finding or a single summary ticket for all findings.

The integration is **opt-in**: when `JIRA_BASE_URL` is not set, the "Create Jira Ticket" buttons open a pre-filled Jira URL in the browser (existing behavior). No behavior changes until the three env vars below are configured.

> **Slack required.** Jira tickets are created from Slack button interactions. This integration only works when the Slack integration is also configured — see [Slack Setup](slack-setup.md).

---

## Step 1: Generate a Jira API token

1. Go to [id.atlassian.com/manage-profile/security/api-tokens](https://id.atlassian.com/manage-profile/security/api-tokens)
2. Click **Create API token**
3. Give it a label (e.g., `a11y-app`) and click **Create**
4. Copy the token — **it is shown only once**

---

## Step 2: Set environment variables in Vercel

In **Vercel → Project Settings → Environment Variables**, add:

| Variable | Value |
|----------|-------|
| `JIRA_BASE_URL` | `https://<workspace>.atlassian.net` |
| `JIRA_EMAIL` | Your Atlassian account email |
| `JIRA_API_TOKEN` | Token from step 1 |

No redeploy needed — Vercel applies env var changes on the next request.

> **Note**: No `JIRA_PROJECT_KEY` or `JIRA_ISSUE_TYPE` env vars are required. Users choose the project key in the Slack modal at ticket creation time. The issue type is always `Task`.

---

## How ticket creation works

```
User clicks "Create Jira Ticket" in Slack
  → Modal opens with a "Project Key" field (e.g. A11Y, KAN, WEB)
  → User enters the project key and clicks "Create Ticket"
  → App ACKs HTTP 200 immediately (Slack 3s deadline met)
  → App calls Jira REST API v3 in the background (waitUntil)
  → On success: ephemeral reply with the ticket URL
  → On failure: ephemeral error message with remediation hint
```

The Jira API call happens after the HTTP response is sent. Slack receives the ACK within the 3-second window regardless of Jira's response time.

The project key is entered by the user each time — it is not stored. Different findings can be sent to different Jira projects.

---

## Ticket content

### Per-finding ticket

Clicking `…` → **Create Jira Ticket** on a specific finding:

- **Summary**: finding title
- **Issue type**: Task
- **Description**:
  - For DOM findings: WCAG criterion, recommended fix, page URL, CSS selector
  - For source pattern findings: file path and line number
- **Priority**: not set — uses the project default

### Bulk ticket

Clicking **Create Jira Ticket** at the bottom of the audit result:

- **Summary**: `A11y Audit: N findings in owner/repo`
- **Issue type**: Task
- **Description**: severity breakdown (Critical / Serious / Moderate / Minor) + list of the top finding titles
- **Priority**: not set

> A11y severity (Critical/Serious/Moderate/Minor) does **not** map to Jira priority. Severity is accessibility impact; priority is business urgency. Severity appears in the description body only.

---

## Disabling the integration

Clear or remove `JIRA_BASE_URL` in Vercel. The buttons revert to pre-filled browser URLs immediately. No code changes needed.
