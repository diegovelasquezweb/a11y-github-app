# Configuration

**Navigation**: [Home](../README.md) • [Architecture](architecture.md) • [Commands](commands.md) • [Configuration](configuration.md) • [Runner Setup](runner-setup.md) • [Fix Engine](fix-engine.md)

---

## Table of Contents

- [Environment Variables](#environment-variables)
- [Vercel Deployment Notes](#vercel-deployment-notes)

## Environment Variables

All configuration is read from environment variables at startup via `src/config.ts`. Variables marked **Required** will cause the server to throw and refuse to start if absent or empty.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `GITHUB_APP_ID` | Yes | — | The numeric ID of the installed GitHub App. Found in the App settings page. |
| `GITHUB_APP_PRIVATE_KEY` | Yes | — | PEM-encoded RSA private key for the GitHub App. Newlines may be escaped as `\n` — the app normalizes them automatically. |
| `GITHUB_WEBHOOK_SECRET` | Yes | — | The webhook secret configured in the GitHub App settings. Used to verify the `X-Hub-Signature-256` header on all incoming events. |
| `PORT` | No | `8787` | Port the HTTP server listens on. |
| `DOM_AUDIT_ENABLED` | No | `false` | Must be set to `"true"` to enable DOM audits. When `false`, all audit commands are silently ignored. |
| `APP_BASE_URL` | No | `""` | Public base URL of the deployed app (e.g., `https://your-app.vercel.app`). Used to build the callback URL: `{APP_BASE_URL}/api/scan-callback`. Required in practice for audit commands to work. |
| `DOM_AUDIT_CALLBACK_TOKEN` | No | `""` | Secret token included in the `x-callback-token` header by the runner and verified (timing-safe) by the callback handler. Required in practice for the runner to authenticate its callback. |
| `SCAN_RUNNER_OWNER` | No | `""` | GitHub owner (user or org) of the runner repository. Defaults to the target repository's owner when empty. |
| `SCAN_RUNNER_REPO` | No | `""` | GitHub repository name where runner workflows are hosted. Defaults to the target repository when empty. |
| `SCAN_RUNNER_REF` | No | `"master"` | Git ref (branch or tag) to use when dispatching runner workflows. |
| `SCAN_RUNNER_WORKFLOW` | No | `"dom-audit.yml"` | Filename of the DOM audit workflow in the runner repo. |
| `SCAN_FIX_WORKFLOW` | No | `"a11y-fix.yml"` | Filename of the fix workflow in the runner repo. |
| `SCAN_SOURCE_WORKFLOW` | No | `"source-audit.yml"` | Filename of the source-only audit workflow in the runner repo. |
| `SOURCE_PATTERNS_ENABLED` | No | `true` | Set to `"false"` to disable the source pattern scanner step inside the DOM audit workflow. Has no effect on `/a11y-audit-source`, which always runs source scanning. |
| `FIX_AI_MODEL` | No | `"claude-haiku-4-5-20251001"` | Claude model identifier passed as `ai_model` to the fix workflow. Controls which model the runner uses when calling the Anthropic API to generate patches. |
| `ANTHROPIC_API_KEY` | No* | — | Anthropic API key. Not read by the webhook server directly — it is used as a repository secret (`secrets.ANTHROPIC_API_KEY`) in the runner repo workflows. Listed here for completeness. |

> *`ANTHROPIC_API_KEY` is not consumed by the Node.js app — it must be configured as a GitHub Actions secret in the runner repository. See [Runner Setup](runner-setup.md).

## Vercel Deployment Notes

When deploying on Vercel, set all required and optional environment variables in **Project Settings → Environment Variables**.

Key points for Vercel:

- `GITHUB_APP_PRIVATE_KEY`: Paste the full PEM key. Vercel stores it as a single-line value with `\n` escapes, which the app normalizes automatically via `normalizePrivateKey()`.
- `APP_BASE_URL`: Set this to your Vercel deployment URL (e.g., `https://your-app.vercel.app`). Without this, the callback URL cannot be constructed and audit commands will return a `503`.
- `DOM_AUDIT_ENABLED`: Must be explicitly set to `"true"` — the default is `false`.
- `FIX_AI_MODEL`: Set this if you want to use a model other than `claude-haiku-4-5-20251001`. The value is forwarded to the runner workflow at dispatch time, so changing it here takes effect immediately without redeploying the runner.
- `PORT`: Not needed on Vercel — the platform manages the HTTP server binding.
