# Configuration

**Navigation**: [Home](../README.md) • [Architecture](architecture.md) • [Commands](commands.md) • [Configuration](configuration.md) • [Runner Setup](runner-setup.md) • [Fix Engine](fix-engine.md) • [Testing](testing.md)

---

## Table of Contents

- [GitHub App Setup](#github-app-setup)
  - [Required Permissions](#required-permissions)
  - [Required Events](#required-events)
  - [App Installation](#app-installation)
- [Environment Variables](#environment-variables)
  - [Vercel (webhook server)](#vercel-webhook-server)
  - [GitHub Actions (runner repo)](#github-actions-runner-repo)
- [Verifying the Setup](#verifying-the-setup)
- [Vercel Deployment Notes](#vercel-deployment-notes)

---

## GitHub App Setup

Go to **GitHub Settings → Developer settings → GitHub Apps → New GitHub App** to create the app.

### Required Permissions

These permissions must be set when creating (or updating) the GitHub App. All of them are **Repository** permissions.

| Permission | Level | Why |
|------------|-------|-----|
| **Contents** | Read & write | Check out PR code; push fix branches |
| **Pull requests** | Read & write | Post PR comments; create fix PRs |
| **Checks** | Read & write | Create and update Check Runs (audit status indicators) |
| **Issues** | Read & write | Read `issue_comment` and `issues` events; post comments on issues |
| **Actions** | Read & write | Dispatch `workflow_dispatch` events to the runner repository |

> **`Actions: Read & write` is required.** Without it the app cannot trigger workflows and all audit/fix commands will silently fail at dispatch time.

### Required Events

Subscribe to these webhook events in the GitHub App settings:

| Event | Why |
|-------|-----|
| `Pull request` | Detects PR opened/reopened/synchronize to post the welcome comment |
| `Issues` | Detects issue opened to post the welcome comment |
| `Issue comment` | Detects `/a11y-audit`, `/a11y-audit dom`, `/a11y-audit source`, `/a11y-fix` commands on PRs and Issues |

### App Installation

After creating the app:

1. Go to the app's **Install App** tab and install it on every repository you want to audit (target repositories).
2. If you are using a **dedicated runner repository** (separate from the target), install the app on that repository too. The app needs to authenticate against the runner repo to dispatch workflows.

---

## Environment Variables

### Vercel (webhook server)

Set these in **Vercel → Project Settings → Environment Variables**.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `GITHUB_APP_ID` | **Yes** | — | Numeric ID of the GitHub App. Found on the App settings page. |
| `GITHUB_APP_PRIVATE_KEY` | **Yes** | — | PEM-encoded RSA private key. Paste the full key — Vercel stores it as a single-line value with `\n` escapes, which the app normalizes automatically. |
| `GITHUB_WEBHOOK_SECRET` | **Yes** | — | Webhook secret configured in the GitHub App settings. Used to verify `X-Hub-Signature-256` on every incoming event. |
| `DOM_AUDIT_ENABLED` | **Yes*** | `false` | Must be `"true"` to enable audit commands. Default is `false` — audits are silently ignored until this is set. |
| `APP_BASE_URL` | **Yes*** | `""` | Public URL of this Vercel deployment (e.g. `https://your-app.vercel.app`). Used to build the callback URL: `{APP_BASE_URL}/api/scan-callback`. Without this, audit commands return `503`. |
| `DOM_AUDIT_CALLBACK_TOKEN` | **Yes*** | `""` | Secret token sent by the runner in the `x-callback-token` header and verified (timing-safe) by the callback endpoint. Must match `CALLBACK_TOKEN` in the runner workflows. |
| `SCAN_RUNNER_OWNER` | No | target repo owner | GitHub owner of the runner repository. Omit to use the target repository's owner. |
| `SCAN_RUNNER_REPO` | No | target repo name | GitHub repository name where runner workflows live. Omit to use the target repository itself. |
| `SCAN_RUNNER_REF` | No | `"master"` | Branch or ref used when dispatching workflows. |
| `SCAN_RUNNER_WORKFLOW` | No | `"dom-audit.yml"` | Filename of the DOM audit workflow. |
| `SCAN_FIX_WORKFLOW` | No | `"a11y-fix.yml"` | Filename of the fix workflow. |
| `SCAN_SOURCE_WORKFLOW` | No | `"source-audit.yml"` | Filename of the source-only audit workflow. |
| `SOURCE_PATTERNS_ENABLED` | No | `true` | Set to `"false"` to disable the source pattern scanner inside DOM audit runs. Has no effect on `/a11y-audit-source`. |
| `FIX_AI_MODEL` | No | `"claude-haiku-4-5-20251001"` | Claude model forwarded to the fix workflow at dispatch time. Changing this takes effect immediately — no redeploy needed. |
| `PORT` | No | `8787` | Local dev server port. Not needed on Vercel. |

#### Jira Integration (optional)

When `JIRA_BASE_URL` is empty, the "Create Jira Ticket" buttons fall back to pre-filled browser URLs — no behavior change. Users choose the project key in the Slack modal at ticket creation time; no env var needed for it.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `JIRA_BASE_URL` | No | `""` | Your Atlassian Cloud base URL, e.g. `https://acme.atlassian.net`. **Setting this enables API mode.** |
| `JIRA_EMAIL` | If `JIRA_BASE_URL` set | `""` | Atlassian account email used for Basic auth. |
| `JIRA_API_TOKEN` | If `JIRA_BASE_URL` set | `""` | API token from `id.atlassian.com/manage-profile/security/api-tokens`. |

See [Jira Setup](jira-setup.md) for step-by-step configuration.

> \* Technically optional in the config schema, but required in practice for the app to work end-to-end.

### GitHub Actions (runner repo)

Set these in the runner repository under **Settings → Secrets and variables → Actions → New repository secret**.

| Secret | Required | Description |
|--------|----------|-------------|
| `ANTHROPIC_API_KEY` | **Yes** | Anthropic API key. Used by the fix workflow (`a11y-fix.yml`) to call the Claude API for patch generation. Also used by the DOM audit workflow for analysis enrichment. **Not read by the Vercel app** — must be set as a GitHub Actions secret. |

---

## Vercel Deployment Notes

- **Private key**: Paste the full PEM. Vercel collapses newlines to `\n` — the app handles this automatically via `normalizePrivateKey()`.
- **`APP_BASE_URL`**: Set to the production deployment URL. If you use preview deployments, each preview needs its own URL or you must point the GitHub App webhook at the production URL only.
- **`DOM_AUDIT_ENABLED`**: Defaults to `false`. You must explicitly set it to `"true"` or the app will accept webhooks but silently skip all commands.
- **`FIX_AI_MODEL`**: Hot-swappable — change the value in Vercel and it takes effect on the next `/a11y-fix` command without touching the runner repo.
- **`PORT`**: Vercel manages its own HTTP server binding. This variable is only relevant for local development.

---

## Verifying the Setup

### GitHub App

1. Go to GitHub App settings → **Advanced** → **Recent Deliveries**
2. Open a PR or Issue in a target repository — a `pull_request` or `issues` event should appear
3. Check that the delivery returned HTTP `200`
4. The bot should post a welcome comment within a few seconds

### Slack

Type `/a11y` in a channel — a modal should appear with Repository, Branch, and Audit Mode fields.

### Jira

Click **Create Jira Ticket** on any finding in a Slack audit result — a modal should ask for the project key and confirm the ticket was created.

