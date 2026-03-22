# a11y-github-app

Express-based GitHub App webhook service for pull request accessibility reviews, with Vercel function support.

## Features

- Verifies GitHub webhook signatures (`X-Hub-Signature-256`)
- Handles `pull_request` events (`opened`, `reopened`, `synchronize`)
- Handles `issue_comment` events for on-demand DOM audits (`/audit`)
- Handles `issue_comment` events for automated fix attempts (`/a11y-fix <finding-id>`)
- Scans changed files with `@diegovelasquezweb/a11y-engine` source patterns
- Publishes a GitHub Check Run and PR Review comments
- Requests changes when findings include `Critical` or `Serious`
- Optionally dispatches a DOM audit GitHub Actions workflow and posts a final PR comment

## Environment

Copy `.env.example` and set:

- `GITHUB_APP_ID`
- `GITHUB_APP_PRIVATE_KEY`
- `GITHUB_WEBHOOK_SECRET`
- `PORT` (optional)
- `MAX_INLINE_COMMENTS` (optional)
- `DOM_AUDIT_ENABLED` (optional)
- `APP_BASE_URL` (required when DOM audit enabled)
- `DOM_AUDIT_CALLBACK_TOKEN` (required when DOM audit enabled)
- `SCAN_RUNNER_OWNER` / `SCAN_RUNNER_REPO` (runner workflow repository)

When `DOM_AUDIT_ENABLED=true`, trigger DOM scanning from a PR comment:

- `/audit`
- `/a11y-fix A11Y-54ed50`

The DOM runner spins up a local runtime from the PR head commit in GitHub Actions and scans that local server with the engine.

## Development

```bash
npm install
npm run dev
```

## Endpoints

- `GET /health`
- `POST /webhook`
- `POST /scan-callback`

## Vercel

This repo includes serverless routes under `api/`.

- `POST /api/webhook`
- `GET /api/health`
- `POST /api/scan-callback`

Set the GitHub App webhook URL to:

`https://<your-vercel-domain>/api/webhook`

If `DOM_AUDIT_ENABLED=true`, the callback endpoint must be reachable at:

`https://<your-vercel-domain>/api/scan-callback`
