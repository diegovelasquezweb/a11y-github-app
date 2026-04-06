# a11y GitHub App

A GitHub App that automatically audits pull requests for WCAG accessibility issues and applies AI-generated fixes — triggered entirely through PR comments.

When installed on a repository, the app posts a welcome comment on every opened or reopened pull request listing the available commands. Collaborators, members, and owners can then trigger audits or request fixes on demand.

## Documentation

| Document | Description |
| :------- | :---------- |
| [Architecture](docs/architecture.md) | System design, request flow, component roles, data flow diagrams |
| [Commands](docs/commands.md) | All available PR comment commands and their output |
| [Configuration](docs/configuration.md) | Environment variables reference and Vercel setup |
| [Runner Setup](docs/runner-setup.md) | GitHub Actions runner repo setup and required workflow files |
| [Fix Engine](docs/fix-engine.md) | How AI-powered fixes work, git checkpoint pattern, result statuses |

## Quick Start

### 1. Create the GitHub App

Go to **GitHub Settings → Developer settings → GitHub Apps → New GitHub App** and configure:

**Permissions (Repository):** Contents (Read & write), Pull requests (Read & write), Checks (Read & write), Issues (Read-only), **Actions (Read & write)**

**Subscribe to events:** `Pull request`, `Issue comment`

### 2. Deploy to Vercel

```bash
git clone https://github.com/your-org/a11y-github-app
cd a11y-github-app
vercel deploy
```

Set the [required environment variables](docs/configuration.md) on your Vercel project.

### 3. Configure the webhook

Set the webhook URL to `https://<your-vercel-domain>/api/webhook` and set the **Webhook secret** to the same value as `GITHUB_WEBHOOK_SECRET`.

### 4. Install the app on repositories

From the GitHub App settings page, install the app on any repository you want to audit.

See [Runner Setup](docs/runner-setup.md) for the GitHub Actions workflows the app dispatches.

## Development

```bash
npm install
npm run dev
```

The local server starts on `PORT` (default `8787`). Use [ngrok](https://ngrok.com/) to expose it for webhook testing.
