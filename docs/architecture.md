# Architecture

**Navigation**: [Home](../README.md) • [Architecture](architecture.md) • [Configuration](configuration.md) • [Runner Setup](runner-setup.md) • [Slack Setup](slack-setup.md) • [Jira Setup](jira-setup.md) • [Audit Engine](audit-engine.md) • [Fix Engine](fix-engine.md)

---

## Table of Contents

- [Overview](#overview)
- [End-User Flows](#end-user-flows)
- [Request Flow](#request-flow)
- [Internal Component Roles](#internal-component-roles)
- [Audit Data Flow](#audit-data-flow)
- [Fix Data Flow](#fix-data-flow)
- [Slack Data Flow](#slack-data-flow)
- [Jira Flow](#jira-flow)
- [Local Development](#local-development)
- [GitHub Commands](#github-commands)

## Overview

The A11y GitHub App is a webhook server that listens to GitHub events on installed repositories. When a pull request is opened, an issue is created, or a comment containing a command is posted on either, the app authenticates the request, determines the action, and dispatches GitHub Actions workflows to a configured runner repository. The runner performs the actual scanning or fix work and reports results back via a callback endpoint. The app then updates the GitHub Check Run and the comment with the final results.

The app supports two contexts:
- **Pull Request**: audit/fix the PR head branch. Commands in PR comments.
- **Issue**: audit/fix any branch in the repo (defaults to the repo's default branch). Commands in issue comments. Use `branch:X` to target a specific branch.

## End-User Flows

### PR Flow

1. PR opened → bot posts a welcome comment listing all available commands
2. Collaborator comments `/a11y-audit` → app creates a Check Run and dispatches `dom-audit.yml`
3. Runner builds the target project, runs axe + cdp + pa11y + source pattern scanner
4. Results posted as a single editable PR comment (finding IDs, severity, selectors, WCAG)
5. Collaborator comments `/a11y-fix all` → app dispatches `a11y-fix.yml`
6. Runner applies AI patches, verifies each one, commits to a new branch, opens a fix PR

### Issue Flow

1. Issue opened → bot posts a welcome comment listing all available commands
2. Collaborator comments `/a11y-audit` → audits the repo's default branch
3. `/a11y-audit branch:stage` → resolves that branch via the GitHub API and audits it
4. Results posted as an issue comment with finding IDs and fix commands (automatically include `branch:X`)
5. `/a11y-fix all` → same patch + PR flow as PRs, targeting the audited branch

### Slack Flow

1. User types `/a11y` in any channel → modal opens (repo URL, branch, audit mode)
2. Submit → app dispatches the audit workflow; a scanning message appears in the channel
3. Workflow reports progress → message updates live with a progress bar (6 steps)
4. Scan completes → results posted to Slack
5. **Fix All** button in Slack → fix modal opens (model, hint) → fix workflow dispatched
6. Fix completes → Slack message updated with patch results and a link to the fix PR

### Jira Flow

1. Scan completes in Slack → each finding has a **Create Jira Ticket** button
2. User clicks the button → modal opens asking for the Jira project key
3. User submits → app fetches available issue types for that project from the Jira API
4. Second modal opens → user selects the issue type and confirms
5. App creates the ticket via the Jira REST API and posts a confirmation in the Slack thread

## Request Flow

GitHub receives a webhook event → the app verifies the HMAC signature and deduplicates the delivery → routes by event type (`pull_request`, `issues`, `issue_comment`) → on commands, resolves the branch, creates a Check Run, and dispatches a workflow to the runner → the runner executes the scan or fix and POSTs a callback → the app updates the Check Run and the comment with results.

## Internal Component Roles

| File | Responsibility |
|------|----------------|
| `src/webhook/process.ts` | Entry point for all webhook events. Verifies HMAC signature, deduplicates deliveries, routes to `pull_request`, `issues`, or `issue_comment` handler, posts welcome comments (PR and Issue), checks author association, parses commands, resolves branch references (PR head or issue branch), creates Check Runs, and dispatches workflows. |
| `src/webhook/dom-callback.ts` | Handles `POST /api/scan-callback`. Validates the callback token with a timing-safe comparison, normalizes the findings payload, builds the final comment body (DOM section, source pattern section, quick-fix section), updates the Check Run to `completed`, and updates or creates the comment. Supports `branch` parameter to include `branch:X` in fix commands for issue-based scans. When Slack context is present in the callback payload, also posts results to Slack via `chat.update`. |
| `src/slack/handler.ts` | Entry point for Slack interactions. Verifies Slack signing secret, routes slash commands (`/a11y`), modal submissions (audit and fix), and button actions (Fix, Fix All). Opens Block Kit modals, resolves repos/branches, dispatches workflows, and posts progress messages. |
| `src/slack/progress.ts` | Handles `POST /api/slack-progress`. Receives progress updates from GitHub Actions workflows and updates the Slack message with a progress bar showing the current step. |
| `src/slack/formatter.ts` | Converts `DomAuditSummary` into Slack Block Kit blocks. Handles severity icons, finding overflow (max 20 DOM + 10 pattern), and action buttons per finding. |
| `src/slack/notifier.ts` | Wraps Slack `chat.postMessage` and `chat.update` calls. All calls are non-fatal — failures are logged but never block GitHub posting. |
| `src/review/audit-command.ts` | Parses audit commands from comment text. Matches `/a11y-audit`, `/a11y-audit dom`, and `/a11y-audit source` and returns an `AuditCommand` with `auditMode` and optional `branch`. Validates that `branch:` has a value — bare `branch` without a value returns null. |
| `src/review/fix-command.ts` | Parses fix commands from comment text. Matches `/a11y-fix` followed by one or more finding IDs (or `all`), an optional model name, and an optional hint. Returns a `FixCommand` with the resolved `findingIds` array and optional `branch`. Bare `branch` without a value returns an invalid command. |
| `src/review/dom-workflow.ts` | Dispatches `workflow_dispatch` events to the runner repo for DOM audits and source-only audits. Also provides `createScanToken()` which generates a unique, URL-safe token per PR scan. |
| `src/review/fix-workflow.ts` | Dispatches `workflow_dispatch` events to the runner repo for fix runs. Passes all required inputs including finding IDs, target repo coordinates, installation token, and AI model. |
| `src/review/dom-reporter.ts` | Creates and updates GitHub Check Runs (`A11y Audit`, `A11y Fix`). Provides `createDomAuditPendingCheck`, `completeDomAuditCheck`, `createFixPendingCheck`, and `failDomAuditCheck`. |
| `src/config.ts` | Single source of truth for all environment variable configuration. Reads required vars at startup and throws if any are missing. |
| `.github/workflows/dom-audit.yml` | Runner workflow for DOM audits. Builds and starts the target project locally, runs `a11y-audit` (axe + cdp + pa11y engines), optionally runs the source pattern scanner, caches findings by head SHA, and POSTs the callback payload. Timeout: 20 minutes. |
| `.github/workflows/source-audit.yml` | Runner workflow for source-only audits. Checks out target repo and runs the source pattern scanner only. Caches pattern findings by head SHA and POSTs the callback payload. Timeout: 10 minutes. |
| `.github/workflows/a11y-fix.yml` | Runner workflow for automated fixes. Restores cached findings, resolves finding IDs, applies patches per finding with git checkpointing, re-runs the audit for verification, commits passing patches to a new branch, and opens a PR. Timeout: 25 minutes. |

## Audit Data Flow

```mermaid
%%{init: { 'theme': 'base', 'themeVariables': { 'primaryColor': '#3b5cd9', 'primaryTextColor': '#1e293b', 'primaryBorderColor': '#1e308a', 'lineColor': '#64748b', 'secondaryColor': '#f1f5f9', 'tertiaryColor': '#fff', 'mainBkg': '#fff', 'nodeBorder': '#e2e8f0', 'clusterBkg': '#f8fafc', 'clusterBorder': '#cbd5e1' } } }%%
flowchart LR
    CMD(["PR or Issue comment:<br/>/a11y-audit"])
    CR1["Check Run created<br/>(in_progress)"]
    WF["workflow_dispatch<br/>→ dom-audit.yml"]
    BUILD["Build + start<br/>target project"]
    SCAN["axe + cdp + pa11y<br/>scan"]
    PAT["Source pattern<br/>scanner"]
    CB["POST /api/scan-callback"]
    CR2["Check Run updated<br/>(completed)"]
    CMT["Comment updated<br/>with findings"]

    CMD --> CR1 --> WF --> BUILD --> SCAN
    SCAN --> PAT --> CB --> CR2
    CB --> CMT

    classDef default font-family:Inter,sans-serif,font-size:12px;
    classDef core fill:#3b5cd9,color:#fff,stroke:#1e308a,stroke-width:2px;
    classDef trigger fill:#1e293b,color:#fff,stroke:#0f172a;
    classDef storage fill:#f1f5f9,stroke:#cbd5e1,stroke-dasharray: 5 5;

    class SCAN,PAT core;
    class CMD trigger;
    class CR1,CR2,CMT storage;
```

## Fix Data Flow

```mermaid
%%{init: { 'theme': 'base', 'themeVariables': { 'primaryColor': '#3b5cd9', 'primaryTextColor': '#1e293b', 'primaryBorderColor': '#1e308a', 'lineColor': '#64748b', 'secondaryColor': '#f1f5f9', 'tertiaryColor': '#fff', 'mainBkg': '#fff', 'nodeBorder': '#e2e8f0', 'clusterBkg': '#f8fafc', 'clusterBorder': '#cbd5e1' } } }%%
flowchart LR
    CMD2(["PR or Issue comment:<br/>/a11y-fix A11Y-001"])
    CR3["Check Run created<br/>(in_progress)"]
    WF2["workflow_dispatch<br/>→ a11y-fix.yml"]
    CACHE["Restore findings<br/>from cache"]
    AI["Claude API<br/>generates patch"]
    APPLY["Apply patch per finding<br/>(git checkpoint)"]
    VERIFY["Re-run audit<br/>for verification"]
    BRANCH["Commit to<br/>new branch"]
    PR["Open PR with<br/>fix summary"]
    CR4["Check Run updated<br/>(completed)"]

    CMD2 --> CR3 --> WF2 --> CACHE --> AI --> APPLY
    APPLY --> VERIFY --> BRANCH --> PR --> CR4

    classDef default font-family:Inter,sans-serif,font-size:12px;
    classDef core fill:#3b5cd9,color:#fff,stroke:#1e308a,stroke-width:2px;
    classDef trigger fill:#1e293b,color:#fff,stroke:#0f172a;
    classDef storage fill:#f1f5f9,stroke:#cbd5e1,stroke-dasharray: 5 5;

    class APPLY,AI,VERIFY core;
    class CMD2 trigger;
    class CR3,CR4,CACHE,BRANCH,PR storage;
```

## Slack Data Flow

```mermaid
%%{init: { 'theme': 'base', 'themeVariables': { 'primaryColor': '#3b5cd9', 'primaryTextColor': '#1e293b', 'primaryBorderColor': '#1e308a', 'lineColor': '#64748b', 'secondaryColor': '#f1f5f9', 'tertiaryColor': '#fff', 'mainBkg': '#fff', 'nodeBorder': '#e2e8f0', 'clusterBkg': '#f8fafc', 'clusterBorder': '#cbd5e1' } } }%%
flowchart LR
    CMD(["User types /a11y<br/>in Slack"])
    MODAL["Modal opens<br/>(repo, branch, mode)"]
    SCAN["POST /api/slack-progress<br/>scanning message"]
    WF["workflow_dispatch<br/>→ dom-audit.yml"]
    PROG["Progress updates<br/>(6 steps)"]
    CB["POST /api/scan-callback"]
    RES["Slack message updated<br/>with findings"]
    FIX["Fix All button<br/>→ fix modal"]
    WF2["workflow_dispatch<br/>→ a11y-fix.yml"]
    FIXRES["Slack message updated<br/>with fix PR link"]

    CMD --> MODAL --> SCAN --> WF --> PROG --> CB --> RES
    RES --> FIX --> WF2 --> FIXRES

    classDef default font-family:Inter,sans-serif,font-size:12px;
    classDef core fill:#3b5cd9,color:#fff,stroke:#1e308a,stroke-width:2px;
    classDef trigger fill:#1e293b,color:#fff,stroke:#0f172a;
    classDef storage fill:#f1f5f9,stroke:#cbd5e1,stroke-dasharray: 5 5;

    class WF,WF2 core;
    class CMD trigger;
    class MODAL,SCAN,PROG,RES,FIXRES storage;
```

## Jira Flow

```mermaid
%%{init: { 'theme': 'base', 'themeVariables': { 'primaryColor': '#3b5cd9', 'primaryTextColor': '#1e293b', 'primaryBorderColor': '#1e308a', 'lineColor': '#64748b', 'secondaryColor': '#f1f5f9', 'tertiaryColor': '#fff', 'mainBkg': '#fff', 'nodeBorder': '#e2e8f0', 'clusterBkg': '#f8fafc', 'clusterBorder': '#cbd5e1' } } }%%
flowchart LR
    SLK["Slack finding action<br/>Create Jira Ticket"]
    MODE{"JIRA_BASE_URL set?"}
    MODAL["Open modal<br/>Project Key"]
    ACK["ACK interaction<br/>(< 3s)"]
    API["Create issue via<br/>Jira REST API v3"]
    EPH["Post ephemeral<br/>success/failure"]
    URL["Open pre-filled Jira<br/>create URL"]

    SLK --> MODE
    MODE -->|Yes| MODAL --> ACK --> API --> EPH
    MODE -->|No| URL

    classDef default font-family:Inter,sans-serif,font-size:12px;
    classDef core fill:#3b5cd9,color:#fff,stroke:#1e308a,stroke-width:2px;
    classDef trigger fill:#1e293b,color:#fff,stroke:#0f172a;
    classDef storage fill:#f1f5f9,stroke:#cbd5e1,stroke-dasharray: 5 5;

    class SLK trigger;
    class API,MODAL core;
    class ACK,EPH,URL storage;
```

## Local Development

```bash
npm install
npm run dev        # starts the local server on PORT (default 8787)
```

Use [ngrok](https://ngrok.com/) to expose the local server for webhook testing:

```bash
ngrok http 8787
```

Update the GitHub App webhook URL to the ngrok URL while testing. Set `APP_BASE_URL` in `.env` to the ngrok URL so callback URLs are built correctly.

Create a `.env` file in the project root with the required variables (see the [Configuration](configuration.md) reference).

**Run tests:**

```bash
npm test
```

Tests use Vitest and cover the webhook handler, review logic, and Slack callback flow.

## GitHub Commands

Commands are triggered via PR or Issue comments. Only users with `COLLABORATOR`, `MEMBER`, or `OWNER` association can trigger them.

| Context | Trigger | Branch resolution |
|---------|---------|-------------------|
| **Pull Request** | PR comment | Uses PR head SHA and branch |
| **Issue** | Issue comment | Defaults to default branch; use `branch:X` for a specific branch |

| Command | Context | What it does |
|---------|---------|--------------|
| `/a11y-audit` | PR or Issue | Full audit: DOM scan + source pattern analysis |
| `/a11y-audit dom` | PR or Issue | DOM scan only |
| `/a11y-audit source` | PR or Issue | Source pattern scan only |
| `/a11y-audit branch:stage` | Issue only | Audit a specific branch |
| `/a11y-fix <ID>` | PR or Issue | Fix one finding |
| `/a11y-fix <ID1> <ID2>` | PR or Issue | Fix multiple findings |
| `/a11y-fix all` | PR or Issue | Fix all findings from the last audit |

### /a11y-audit

```
/a11y-audit
/a11y-audit branch:stage
```

Dispatches `dom-audit.yml`. The runner builds the target, runs axe + cdp + pa11y + source pattern scanner, caches findings by head SHA, and POSTs a callback. The app updates the Check Run and posts the results comment.

### /a11y-audit dom

```
/a11y-audit dom
/a11y-audit dom branch:stage
```

Same as `/a11y-audit` but with `source_scan_enabled=false`. Only the DOM section appears in the result.

### /a11y-audit source

```
/a11y-audit source
/a11y-audit source branch:stage
```

Dispatches `source-audit.yml`. No browser is launched — only the source pattern scanner runs.

### /a11y-fix

```
/a11y-fix <ID>
/a11y-fix <ID1> <ID2> <ID3>
/a11y-fix all
/a11y-fix sonnet all
/a11y-fix all "use sr-only labels"
```

Dispatches `a11y-fix.yml`. The runner restores cached findings, applies AI patches, verifies each one, commits to a new branch, and opens a fix PR. An optional model name (`haiku`, `sonnet`, `opus`) and an optional hint in quotes can be passed to guide the fix.
