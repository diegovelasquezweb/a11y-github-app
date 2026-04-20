# A11y GitHub App

---

## Table of Contents

- [How It Works](#how-it-works)
- [Prerequisites](#prerequisites)
- [Step 1: Create the GitHub App](#step-1-create-the-github-app)
- [Step 2: Deploy to Vercel](#step-2-deploy-to-vercel)
- [Step 3: Set Up the Runner Repository](#step-3-set-up-the-runner-repository)
- [Step 4: Complete Configuration and Install](#step-4-complete-configuration-and-install)
- [Step 5: Set Up the Slack Integration](#step-5-set-up-the-slack-integration)
- [Step 6: Set Up the Jira Integration](#step-6-set-up-the-jira-integration)
- [Step 7: Verify the Setup](#step-7-verify-the-setup)
- [Detailed Docs](#detailed-docs)

---

## How It Works

The system has three components:

| Component | Role |
|-----------|------|
| **Webhook app** (this repo, deployed on Vercel) | Receives GitHub and Slack events, orchestrates workflows, posts results |
| **Runner repository** (GitHub Actions) | Executes scans (axe, pa11y, CDP), generates AI patches, posts callbacks |
| **Target repositories** | The repos being audited — no code changes required |

See [Architecture](docs/architecture.md) for the full request flow and component breakdown.

---

## Prerequisites

Before you begin, make sure you have:

- A **GitHub organization** where you can create GitHub Apps
- A **Vercel account** for hosting the webhook server
- A **GitHub repository** to use as the runner
- An **Anthropic API key** for AI-powered fix generation
- A **Slack workspace** with permission to create apps (for the Slack integration)
- A **Jira Cloud account** with API token access (for the Jira integration)

---

## Step 1: Create the GitHub App

1. Go to **GitHub Settings → Developer settings → GitHub Apps → New GitHub App**

2. Fill in the basic fields:

   | Field | Value |
   |-------|-------|
   | **GitHub App name** | Any name |
   | **Homepage URL** | Your Vercel URL |
   | **Webhook URL** | Leave blank for now |
   | **Webhook secret** | Generate a strong random string and save it |

3. Set **Repository permissions**:

   | Permission | Level | Why |
   |------------|-------|-----|
   | Contents | Read & write | Check out PR code; push fix branches |
   | Pull requests | Read & write | Post PR comments; create fix PRs |
   | Checks | Read & write | Create and update audit status indicators |
   | Issues | Read & write | Post comments on Issues; receive issue events |
   | Actions | Read & write | Dispatch workflow runs to the runner repository |


4. Subscribe to these **webhook events**:

   - [x] Pull request
   - [x] Issues
   - [x] Issue comment

5. Under **Where can this GitHub App be installed?**, choose **Only on this account** → click **Create GitHub App**.

7. On the next page:
   - Copy the **App ID** — you will need it as `GITHUB_APP_ID`
   - Scroll to **Private keys** → click **Generate a private key** → download the `.pem` file — this is `GITHUB_APP_PRIVATE_KEY`

---

## Step 2: Deploy to Vercel

### 2.1 Import the repository

1. Fork or clone this repository into your GitHub organization.
2. Go to [vercel.com/new](https://vercel.com/new) and import the repository.
3. Click Deploy.

### 2.2 Set environment variables

In **Vercel → your project → Settings → Environment Variables**, add the following:

**Required:**

| Variable | Value | Where to get it |
|----------|-------|----------------|
| `GITHUB_APP_ID` | Numeric App ID from Step 1 | GitHub App settings page |
| `GITHUB_APP_PRIVATE_KEY` | Full PEM content from the `.pem` file | Paste the entire file contents including header and footer lines |
| `GITHUB_WEBHOOK_SECRET` | The random string from Step 1.2 | Your own value |
| `DOM_AUDIT_ENABLED` | `true` | — |
| `APP_BASE_URL` | `https://<your-project>.vercel.app` | Your Vercel deployment URL |
| `DOM_AUDIT_CALLBACK_TOKEN` | A strong random string | Your own value |
| `SCAN_RUNNER_OWNER` | GitHub org name of the runner repo | — |
| `SCAN_RUNNER_REPO` | Repository name of the runner repo | — |
| `SCAN_RUNNER_REF` | Branch where workflows live | Default: `master` |

### 2.3 Copy your webhook URL

Your webhook endpoint is:

```
https://<your-project>.vercel.app/api/webhook
```

---

## Step 3: Set Up the Runner Repository

The runner repository is where GitHub Actions workflows execute the actual scans and AI fixes.

### 3.1 Fork this repository

Fork this repository into your GitHub organization. The fork becomes your runner.

Set `SCAN_RUNNER_OWNER` and `SCAN_RUNNER_REPO` in Vercel to point to your fork.

### 3.2 Add the required secret

In the runner repository, go to **Settings → Secrets and variables → Actions → New repository secret**:

| Secret | Value |
|--------|-------|
| `ANTHROPIC_API_KEY` | Your Anthropic API key from [console.anthropic.com](https://console.anthropic.com) |

### 3.3 Check workflow permissions

In the runner repository: **Settings → Actions → General → Workflow permissions → Read and write permissions**.

---

## Step 4: Complete Configuration and Install

Go back to **GitHub Settings → Developer settings → GitHub Apps → your app**:

1. Set **Homepage URL** to your Vercel deployment URL.
2. Set **Webhook URL** to `https://<your-project>.vercel.app/api/webhook`.
3. Set the **Webhook secret** to match `GITHUB_WEBHOOK_SECRET`.
4. Click **Save changes**.
5. Go to **Install App** → install it on the runner repository and every target repo you want to audit.

---

## Step 5: Set Up the Slack Integration

The Slack integration lets users trigger audits directly from Slack. Results are posted back to the channel.

### 1. Create the Slack App

1. Go to [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → **From scratch**
2. Choose a name, pick your workspace → **Create App**

### 2. Configure the Slash Command

1. Go to **Slash Commands** → **Create New Command**

   | Field | Value |
   |-------|-------|
   | Command | `/a11y` (or any name) |
   | Request URL | `https://<your-vercel-domain>/api/slack` |
   | Short Description | Run accessibility audits |

2. Click **Save**

### 3. Enable Interactivity

1. Go to **Interactivity & Shortcuts** → toggle **Interactivity** to **On**
2. Request URL: `https://<your-vercel-domain>/api/slack`
3. **Save Changes**

### 4. Add Bot Token Scopes and install

1. Go to **OAuth & Permissions → Bot Token Scopes** and add: `commands`, `chat:write`, `chat:write.public`
2. Go to **Install App** → **Install to Workspace** → authorize
3. Copy the **Bot User OAuth Token** (`xoxb-...`)
4. Go to **Basic Information** → copy the **Signing Secret**

### 5. Add environment variables in Vercel

| Variable | Value |
|----------|-------|
| `SLACK_BOT_TOKEN` | `xoxb-...` token from step 4 |
| `SLACK_SIGNING_SECRET` | Signing secret from step 4 |

### 6. Invite the bot to a channel

In any Slack channel: `/invite @A11y Audit`

---

## Step 6: Set Up the Jira Integration

Enables one-click Jira ticket creation from Slack audit results. Requires a Jira Cloud account.

### 1. Generate a Jira API token

1. Go to [id.atlassian.com/manage-profile/security/api-tokens](https://id.atlassian.com/manage-profile/security/api-tokens)
2. Click **Create API token** → label it `a11y-app` → **Create**
3. Copy the token — it is shown only once

### 2. Add environment variables in Vercel

| Variable | Value |
|----------|-------|
| `JIRA_BASE_URL` | `https://<workspace>.atlassian.net` |
| `JIRA_EMAIL` | Your Atlassian account email |
| `JIRA_API_TOKEN` | Token from step 1 |

---

## Step 7: Verify the Setup

See [Configuration → Verifying the Setup](docs/configuration.md#verifying-the-setup).

---

## Detailed Docs

| Document | Description |
|----------|-------------|
| [Architecture](docs/architecture.md) | System design, request flow, component roles, data flow diagrams |
| [Commands](docs/commands.md) | Full command reference with output examples and fix result statuses |
| [Configuration](docs/configuration.md) | Full environment variables reference and Vercel deployment notes |
| [Runner Setup](docs/runner-setup.md) | Workflow file reference and auto-detection logic |
| [Fix Engine](docs/fix-engine.md) | AI patch engine internals, git checkpoint pattern, token cost |
| [Slack Setup](docs/slack-setup.md) | Full Slack App configuration and how the integration works |
| [Jira Setup](docs/jira-setup.md) | Jira Cloud integration details and ticket format |
| [Testing](docs/testing.md) | Test suite reference |
