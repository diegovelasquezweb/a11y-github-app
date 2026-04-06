# a11y GitHub App

A GitHub App that automatically audits pull requests for WCAG accessibility issues and applies AI-generated fixes — triggered entirely through PR comments.

When installed on a repository, the app posts a welcome comment on every opened or reopened pull request listing the available commands. Collaborators, members, and owners can then trigger audits or request fixes on demand.

## How It Works

| Event | Trigger | What happens |
| :---- | :------ | :----------- |
| PR opened / reopened | Automatic | App posts a welcome comment with available commands |
| PR comment `/a11y-audit` | Collaborator+ | Full audit: DOM browser scan + source pattern analysis. Creates a Check Run. Posts a single editable PR comment with findings. |
| PR comment `/a11y-audit-dom` | Collaborator+ | DOM-only audit via GitHub Actions browser run. Creates a Check Run. Posts a separate PR comment. |
| PR comment `/a11y-audit-source` | Collaborator+ | Source pattern scan only — no browser required. Creates a Check Run. Posts a separate PR comment. |
| PR comment `/a11y-fix <ID>` | Collaborator+ | Dispatches fix workflow for a single finding (`A11Y-*` or `PAT-*`). Opens a fix PR. Posts fix status and AI usage report. |
| PR comment `/a11y-fix all` | Collaborator+ | Dispatches fix workflow for all findings from the last audit. Opens a fix PR. Posts fix status and AI usage report. |

## Commands

| Command | Description | Output |
| :------ | :---------- | :----- |
| `/a11y-audit` | Full audit: DOM scan + source pattern analysis | GitHub Check Run + single editable PR comment with findings table |
| `/a11y-audit-dom` | DOM-only audit via GitHub Actions | GitHub Check Run + separate PR comment |
| `/a11y-audit-source` | Source pattern scan, no browser | GitHub Check Run + separate PR comment |
| `/a11y-fix <ID>` | AI fix for one finding (`A11Y-*` or `PAT-*`) | Fix PR targeting the feature branch + fix status comment |
| `/a11y-fix all` | AI fix for all findings from the last audit | Fix PR targeting the feature branch + fix status comment |

Only users with `COLLABORATOR`, `MEMBER`, or `OWNER` association on the repository can trigger commands.

### Audit output

Each audit comment groups findings by severity:

| Severity | Meaning |
| :------- | :------ |
| Critical | Blocks access entirely |
| Serious | Significant barrier |
| Moderate | Partial barrier |
| Minor | Cosmetic / best practice |

For each finding the comment shows: ID, title, WCAG criterion, selector, recommended fix, and inline quick-fix commands.

### Fix output

The fix comment reports the result per finding:

| Status | Meaning |
| :----- | :------ |
| Fixed & verified | Fix applied and re-audit confirmed no regression |
| Patched but not verified | Fix applied; re-audit was inconclusive |
| Skipped | Finding was excluded from this run |
| Failed | AI could not produce a valid patch |

An AI usage table is included in every fix comment: model, input tokens, output tokens, and estimated cost.

## Installation & Setup

### 1. Create the GitHub App

Go to **GitHub Settings → Developer settings → GitHub Apps → New GitHub App** and configure:

**Permissions (Repository)**

| Permission | Access |
| :--------- | :----- |
| Contents | Read & write |
| Pull requests | Read & write |
| Checks | Read & write |
| Issues | Read-only |

**Subscribe to events**

- `Pull request`
- `Issue comment`

Set the webhook URL after deployment (see step 3).

### 2. Deploy to Vercel

```bash
git clone https://github.com/your-org/a11y-github-app
cd a11y-github-app
vercel deploy
```

Set the environment variables listed in the [Configuration Reference](#configuration-reference) on your Vercel project.

### 3. Configure the webhook

In your GitHub App settings, set the webhook URL to:

```
https://<your-vercel-domain>/api/webhook
```

Set the **Webhook secret** to the same value as `GITHUB_WEBHOOK_SECRET`.

### 4. Install the app on repositories

From the GitHub App settings page, install the app on any repository you want to audit.

## Runner Repository Setup

The app dispatches GitHub Actions workflows to run browser audits and fix generation. By default, it dispatches to the repository that triggered the PR. You can point to a dedicated runner repo using `SCAN_RUNNER_OWNER` and `SCAN_RUNNER_REPO`.

The following workflow files must exist in the runner repository:

| File | Purpose |
| :--- | :------ |
| `.github/workflows/dom-audit.yml` | Checks out the PR head, starts the app, runs the browser scan, and posts results to `/api/scan-callback` |
| `.github/workflows/source-audit.yml` | Checks out the PR head, runs source pattern analysis, and posts results to `/api/scan-callback` |
| `.github/workflows/a11y-fix.yml` | Checks out the PR head, generates AI patches via Claude, commits changes to a fix branch, and opens a PR |

**Required GitHub Actions secret in the runner repository:**

| Secret | Purpose |
| :----- | :------ |
| `ANTHROPIC_API_KEY` | Used by the fix workflow to call the Claude API for patch generation |

## Configuration Reference

| Variable | Required | Default | Description |
| :------- | :------- | :------ | :---------- |
| `GITHUB_APP_ID` | Yes | — | GitHub App ID, found in the App settings page |
| `GITHUB_APP_PRIVATE_KEY` | Yes | — | GitHub App private key in PEM format; use `\n` for newlines in environment strings |
| `GITHUB_WEBHOOK_SECRET` | Yes | — | Webhook secret used to verify the `X-Hub-Signature-256` header on incoming events |
| `DOM_AUDIT_ENABLED` | No | `false` | Set to `true` to enable DOM (browser) audit via GitHub Actions workflow dispatch |
| `APP_BASE_URL` | When DOM enabled | — | Public URL of this app deployment (e.g. `https://your-app.vercel.app`); used to construct the callback URL sent to the runner |
| `DOM_AUDIT_CALLBACK_TOKEN` | When DOM enabled | — | Secret token included in the callback request; the app validates this token before processing scan results |
| `SCAN_RUNNER_OWNER` | No | Target repo owner | GitHub owner of the repository containing the runner workflows |
| `SCAN_RUNNER_REPO` | No | Target repo name | Repository containing the runner workflows |
| `SCAN_RUNNER_REF` | No | `master` | Branch or ref used when dispatching runner workflows |
| `SCAN_RUNNER_WORKFLOW` | No | `dom-audit.yml` | Filename of the DOM audit workflow |
| `SCAN_FIX_WORKFLOW` | No | `a11y-fix.yml` | Filename of the fix workflow |
| `SCAN_SOURCE_WORKFLOW` | No | `source-audit.yml` | Filename of the source audit workflow |
| `SOURCE_PATTERNS_ENABLED` | No | `true` | Set to `false` to disable the source pattern scanner entirely |
| `FIX_AI_MODEL` | No | `claude-haiku-4-5-20251001` | Claude model used by the fix workflow for patch generation |
| `ANTHROPIC_API_KEY` | For fix workflow | — | Anthropic API key; set as a GitHub Actions secret in the runner repo, not as an app environment variable |
| `PORT` | No | `8787` | Local development server port |

## API Endpoints

| Method | Path | Description |
| :----- | :--- | :---------- |
| `GET` | `/api/health` | Health check — returns `200 OK` when the service is running |
| `POST` | `/api/webhook` | GitHub webhook receiver — validates signature, routes `pull_request` and `issue_comment` events |
| `POST` | `/api/scan-callback` | Callback endpoint called by GitHub Actions runners after an audit or fix completes; updates the Check Run and edits the PR comment with final results |

## Architecture

```
GitHub webhook
  → POST /api/webhook
    → verify X-Hub-Signature-256
    → pull_request (opened / reopened)
        → post welcome comment with available commands
    → issue_comment (/a11y-audit, /a11y-audit-dom, /a11y-audit-source)
        → check author association (COLLABORATOR / MEMBER / OWNER)
        → create Check Run (queued)
        → /a11y-audit-source or inline source scan: run immediately, post comment, update Check Run
        → /a11y-audit-dom or /a11y-audit: dispatch GitHub Actions workflow
            → runner checks out PR head
            → runs browser scan and/or source analysis
            → POST /api/scan-callback
                → validate callback token
                → update Check Run (pass / fail)
                → edit PR comment with findings table
    → issue_comment (/a11y-fix <ID|all>)
        → check author association
        → create Check Run (queued)
        → dispatch fix workflow
            → runner generates AI patches via Claude
            → commits changes to fix branch
            → opens fix PR targeting feature branch
            → POST /api/scan-callback
                → update Check Run
                → post fix status comment (per-finding results + AI usage table)
```

## Development

```bash
npm install
npm run dev
```

The local server starts on `PORT` (default `8787`). Use a tool like [ngrok](https://ngrok.com/) to expose it for webhook testing.

```bash
npx ngrok http 8787
```

Update the GitHub App webhook URL to the ngrok URL during local development.

## External Resources

- [WCAG 2.2 Specification](https://www.w3.org/TR/WCAG22/)
- [GitHub Apps documentation](https://docs.github.com/en/apps)
- [GitHub Webhooks](https://docs.github.com/en/webhooks)
- [Vercel deployment](https://vercel.com/docs)
