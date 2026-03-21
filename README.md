# a11y-github-app

Express-based GitHub App webhook service for pull request accessibility reviews, with Vercel function support.

## Features

- Verifies GitHub webhook signatures (`X-Hub-Signature-256`)
- Handles `pull_request` events (`opened`, `reopened`, `synchronize`)
- Scans changed files with `@diegovelasquezweb/a11y-engine` source patterns
- Publishes a GitHub Check Run and PR Review comments
- Requests changes when findings include `Critical` or `Serious`

## Environment

Copy `.env.example` and set:

- `GITHUB_APP_ID`
- `GITHUB_APP_PRIVATE_KEY`
- `GITHUB_WEBHOOK_SECRET`
- `PORT` (optional)
- `MAX_INLINE_COMMENTS` (optional)

## Development

```bash
npm install
npm run dev
```

## Endpoints

- `GET /health`
- `POST /webhook`

## Vercel

This repo includes serverless routes under `api/`.

- `POST /api/webhook`
- `GET /api/health`

Set the GitHub App webhook URL to:

`https://<your-vercel-domain>/api/webhook`
