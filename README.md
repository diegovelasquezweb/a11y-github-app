# a11y-github-app

Express-based GitHub App webhook service for pull request accessibility reviews.

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
