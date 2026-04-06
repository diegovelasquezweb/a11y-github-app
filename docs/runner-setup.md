# Runner Setup

**Navigation**: [Home](../README.md) • [Architecture](architecture.md) • [Commands](commands.md) • [Configuration](configuration.md) • [Runner Setup](runner-setup.md) • [Fix Engine](fix-engine.md)

---

## Table of Contents

- [Overview](#overview)
- [Required Workflow Files](#required-workflow-files)
- [Required Secrets](#required-secrets)
- [Required Workflow Permissions](#required-workflow-permissions)
- [Runner Repository Configuration](#runner-repository-configuration)
- [Workflow Inputs Reference](#workflow-inputs-reference)
  - [dom-audit.yml inputs](#dom-audityml-inputs)
  - [source-audit.yml inputs](#source-audityml-inputs)
  - [a11y-fix.yml inputs](#a11y-fixyml-inputs)
- [Runner Interaction Diagram](#runner-interaction-diagram)
- [Target Project Runtime Config](#target-project-runtime-config)

---

## Overview

The app does not execute scans or fixes directly. Instead, it dispatches `workflow_dispatch` events to a **runner repository** — a GitHub repository that hosts the workflow files and has the `@diegovelasquezweb/a11y-engine` package installed as a Node.js dependency.

The runner can be the same repository as the one being scanned, or a dedicated repository shared across multiple projects.

The runner repository must have:
- The three workflow files committed to the branch referenced by `SCAN_RUNNER_REF`
- The `@diegovelasquezweb/a11y-engine` package available via `npm install`
- The `ANTHROPIC_API_KEY` Actions secret configured
- The GitHub App **installed** on it (if it is a dedicated runner repo — see below)

---

## Required Workflow Files

| File | Purpose | Timeout |
|------|---------|---------|
| `.github/workflows/dom-audit.yml` | Builds and starts the target project locally, runs axe + cdp + pa11y engines, optionally runs the source pattern scanner, caches findings, and posts the callback. | 20 min |
| `.github/workflows/source-audit.yml` | Checks out the target repository and runs the source pattern scanner only. Caches pattern findings and posts the callback. No browser required. | 10 min |
| `.github/workflows/a11y-fix.yml` | Restores cached findings, applies AI-generated patches per finding with git checkpointing, verifies patches, commits to a new branch, and opens a PR. | 25 min |

---

## Required Secrets

Configure these in the runner repository under **Settings → Secrets and variables → Actions → New repository secret**.

| Secret | Required | Where to get it | Description |
|--------|----------|-----------------|-------------|
| `ANTHROPIC_API_KEY` | **Yes** | [console.anthropic.com](https://console.anthropic.com) | API key used by `a11y-fix.yml` to call the Claude API for patch generation. Not read by the Vercel webhook app — must live in the runner repo. |

---

## Required Workflow Permissions

Each workflow file must declare `permissions` at the job level. These are the minimum permissions needed:

```yaml
permissions:
  contents: write       # push fix branches (a11y-fix.yml)
  pull-requests: write  # create fix PRs, post comments
  issues: write         # post comments on PRs (issues API)
```

`dom-audit.yml` and `source-audit.yml` only need `issues: write` (to post callback comments). `a11y-fix.yml` needs all three.

> These permissions apply to the **target repository** and are authorized via the `target_token` passed as a workflow input — not via the runner's `GITHUB_TOKEN`. The `GITHUB_TOKEN` of the runner repo is only used to check out the runner repository itself.

---

## Runner Repository Configuration

The runner repository is controlled by three environment variables on the Vercel app:

| Variable | Behavior |
|----------|----------|
| `SCAN_RUNNER_OWNER` | Owner of the runner repo. If empty, defaults to the target repository's owner. |
| `SCAN_RUNNER_REPO` | Name of the runner repo. If empty, defaults to the target repository name. |
| `SCAN_RUNNER_REF` | Branch or tag to dispatch workflows on. Defaults to `"master"`. |

### Same-repo vs dedicated runner

| Setup | How to configure |
|-------|-----------------|
| **Same repo** (target = runner) | Leave `SCAN_RUNNER_OWNER` and `SCAN_RUNNER_REPO` empty. The workflows must exist in the target repo. |
| **Dedicated runner repo** | Set `SCAN_RUNNER_OWNER` and `SCAN_RUNNER_REPO` to the dedicated repo. **Install the GitHub App on that repo** — otherwise the app cannot authenticate to dispatch workflows. |

---

## Workflow Inputs Reference

These inputs are sent by the Vercel app when dispatching each workflow. They are defined in the `workflow_dispatch.inputs` block of each workflow file.

### dom-audit.yml inputs

Dispatched by `dispatchDomAuditWorkflow()` in `src/review/dom-workflow.ts`.

| Input | Required | Description |
|-------|----------|-------------|
| `scan_token` | Yes | Unique token identifying this scan run. |
| `callback_url` | Yes | Full URL to POST results to (`{APP_BASE_URL}/api/scan-callback`). |
| `callback_token` | Yes | Token for the `x-callback-token` header, verified by the callback handler. Must match `DOM_AUDIT_CALLBACK_TOKEN` on Vercel. |
| `target_owner` | Yes | Owner of the repository being scanned. |
| `target_repo` | Yes | Name of the repository being scanned. |
| `pull_number` | Yes | PR number as a string. |
| `head_sha` | Yes | PR head commit SHA. Used to check out the target and as the findings cache key. |
| `check_run_id` | Yes | ID of the Check Run to update on callback. |
| `target_token` | Yes | GitHub installation token with write access to the target repository. |
| `comment_id` | No | ID of the initial PR comment to update with results. `"0"` = create a new comment. |
| `source_scan_enabled` | No | Whether to run the source pattern scanner (`"true"` / `"false"`). Set to `"false"` for `/a11y-audit-dom`. |

### source-audit.yml inputs

Dispatched by `dispatchSourceAuditWorkflow()` in `src/review/dom-workflow.ts`. Always sends `audit_mode: "source"` as a fixed value.

| Input | Required | Description |
|-------|----------|-------------|
| `scan_token` | Yes | Unique token identifying this scan run. |
| `callback_url` | Yes | Full URL to POST results to. |
| `callback_token` | Yes | Token for the `x-callback-token` header. |
| `target_owner` | Yes | Owner of the repository being scanned. |
| `target_repo` | Yes | Name of the repository being scanned. |
| `pull_number` | Yes | PR number as a string. |
| `head_sha` | Yes | PR head commit SHA. |
| `check_run_id` | Yes | ID of the Check Run to update on callback. |
| `target_token` | Yes | GitHub installation token with access to the target repository. |
| `comment_id` | No | ID of the initial PR comment to update with results. |

### a11y-fix.yml inputs

Dispatched by `dispatchFixWorkflow()` in `src/review/fix-workflow.ts`.

| Input | Required | Description |
|-------|----------|-------------|
| `target_owner` | Yes | Owner of the repository to fix. |
| `target_repo` | Yes | Name of the repository to fix. |
| `pull_number` | Yes | PR number as a string. |
| `head_sha` | Yes | PR head commit SHA. Used to restore cached findings. |
| `head_ref` | Yes | PR head branch name. The fix PR targets this branch. |
| `base_ref` | Yes | PR base branch. |
| `finding_ids` | Yes | Comma-separated finding IDs or `"all"`. |
| `requested_by` | Yes | GitHub username who triggered the fix command. |
| `target_token` | Yes | GitHub installation token for the target repository. |
| `check_run_id` | Yes | ID of the `A11y Fix` Check Run to update. |
| `ai_model` | No | Claude model for patch generation. Defaults to `"claude-haiku-4-5-20251001"`. Controlled by `FIX_AI_MODEL` on Vercel. |

---

## Runner Interaction Diagram

```mermaid
%%{init: { 'theme': 'base', 'themeVariables': { 'primaryColor': '#3b5cd9', 'primaryTextColor': '#1e293b', 'primaryBorderColor': '#1e308a', 'lineColor': '#64748b', 'secondaryColor': '#f1f5f9', 'tertiaryColor': '#fff', 'mainBkg': '#fff', 'nodeBorder': '#e2e8f0', 'clusterBkg': '#f8fafc', 'clusterBorder': '#cbd5e1' } } }%%
flowchart TD
    APP["Webhook App\n(Vercel)"]
    RUNNER_REPO["Runner Repository\n(GitHub Actions)"]
    TARGET_REPO["Target Repository\n(PR under review)"]
    CALLBACK["/api/scan-callback"]

    subgraph Dispatch ["workflow_dispatch (via Actions API)"]
        direction LR
        WD["inputs: callback_url, callback_token,\ntarget coords, head_sha, check_run_id,\ntarget_token, ai_model"]
    end

    subgraph Runner ["Runner Workflow Execution"]
        direction TB
        CO["Checkout runner repo\n(GITHUB_TOKEN)"]
        CT["Checkout target repo\nat PR head SHA\n(target_token)"]
        SCAN["Run scan / apply fix\n(ANTHROPIC_API_KEY)"]
        POST["POST callback payload\n(callback_token header)"]
        CO --> CT --> SCAN --> POST
    end

    APP -->|"App installation token\n(Actions: write)"| Dispatch
    Dispatch --> RUNNER_REPO
    RUNNER_REPO --> Runner
    Runner -->|"target_token\n(Contents + PR write)"| TARGET_REPO
    POST --> CALLBACK
    CALLBACK -->|"x-callback-token\nverified timing-safe"| APP

    classDef default font-family:Inter,sans-serif,font-size:12px;
    classDef core fill:#3b5cd9,color:#fff,stroke:#1e308a,stroke-width:2px;
    classDef entry fill:#1e293b,color:#fff,stroke:#0f172a;

    class SCAN core;
    class APP,CALLBACK entry;
```

---

## Target Project Runtime Config

The DOM audit and fix workflows read an optional `.a11y-runner.json` file from the root of the checked-out target repository. This file lets the project control how the local server is started during scans.

| Field | Default | Description |
|-------|---------|-------------|
| `workdir` | `"target"` | Working directory for install, build, and start commands. |
| `installCommand` | `""` | Command to install dependencies. Skipped if empty. |
| `buildCommand` | `""` | Command to build the project. Skipped if empty. |
| `startCommand` | `"python3 -m http.server 4173 --bind 127.0.0.1"` | Command to start the local server. |
| `healthUrl` | `"http://127.0.0.1:4173"` | URL polled until the server responds `200 OK`. |
| `readyTimeoutMs` | `120000` | Max milliseconds to wait for server readiness. |

Example `.a11y-runner.json` for a Vite project:

```json
{
  "installCommand": "npm install",
  "buildCommand": "npm run build",
  "startCommand": "npx serve dist -l 4173",
  "healthUrl": "http://127.0.0.1:4173"
}
```
