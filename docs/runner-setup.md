# Runner Setup

**Navigation**: [Home](../README.md) • [Architecture](architecture.md) • [Commands](commands.md) • [Configuration](configuration.md) • [Runner Setup](runner-setup.md) • [Fix Engine](fix-engine.md)

---

## Table of Contents

- [Overview](#overview)
- [Required Workflow Files](#required-workflow-files)
- [Workflow Inputs Reference](#workflow-inputs-reference)
  - [dom-audit.yml inputs](#dom-audityml-inputs)
  - [source-audit.yml inputs](#source-audityml-inputs)
  - [a11y-fix.yml inputs](#a11y-fixyml-inputs)
- [Required Secrets](#required-secrets)
- [Runner Repository Configuration](#runner-repository-configuration)
- [Runner Interaction Diagram](#runner-interaction-diagram)
- [Target Project Runtime Config](#target-project-runtime-config)

## Overview

The app does not execute scans or fixes directly. Instead, it dispatches `workflow_dispatch` events to a **runner repository** — a GitHub repository that hosts the workflow files and has the `@diegovelasquezweb/a11y-engine` package installed as a Node.js dependency. The runner can be the same repository as the one being scanned, or a dedicated repository shared across multiple projects.

The runner repository must have:
- The three workflow files described below, committed to the branch referenced by `SCAN_RUNNER_REF`.
- The `@diegovelasquezweb/a11y-engine` package available via `npm install`.
- The `ANTHROPIC_API_KEY` secret configured in GitHub Actions.

## Required Workflow Files

| File | Purpose | Timeout |
|------|---------|---------|
| `dom-audit.yml` | Builds and starts the target project locally, runs axe + cdp + pa11y engines, optionally runs the source pattern scanner, caches findings, and posts the callback. | 20 minutes |
| `source-audit.yml` | Checks out the target repository and runs the source pattern scanner only. Caches pattern findings and posts the callback. | 10 minutes |
| `a11y-fix.yml` | Restores cached findings, resolves finding IDs, applies AI-generated patches per finding with git checkpointing, verifies patches, commits to a new branch, and opens a PR. | 25 minutes |

## Workflow Inputs Reference

### dom-audit.yml inputs

Dispatched by `dispatchDomAuditWorkflow()` in `src/review/dom-workflow.ts`.

| Input | Required | Description |
|-------|----------|-------------|
| `scan_token` | Yes | Unique token identifying this scan run. |
| `callback_url` | Yes | Full URL to POST results to (`{APP_BASE_URL}/api/scan-callback`). |
| `callback_token` | Yes | Token for the `x-callback-token` header, verified by the callback handler. |
| `target_owner` | Yes | Owner of the repository being scanned. |
| `target_repo` | Yes | Name of the repository being scanned. |
| `pull_number` | Yes | PR number as a string. |
| `head_sha` | Yes | PR head commit SHA. Used to check out the target and as the cache key. |
| `check_run_id` | Yes | ID of the Check Run to update on callback. |
| `target_token` | Yes | GitHub installation token with access to the target repository. |
| `comment_id` | No | ID of the initial PR comment to update with results (default `"0"` = create new). |
| `source_scan_enabled` | No | Whether to run the source pattern scanner (`"true"` / `"false"`, default `"true"`). Set to `"false"` for `/a11y-audit-dom`. |

### source-audit.yml inputs

Dispatched by `dispatchSourceAuditWorkflow()` in `src/review/dom-workflow.ts`. Includes `audit_mode: "source"` as a fixed input.

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
| `comment_id` | No | ID of the initial PR comment to update with results (default `"0"`). |

### a11y-fix.yml inputs

Dispatched by `dispatchFixWorkflow()` in `src/review/fix-workflow.ts`.

| Input | Required | Description |
|-------|----------|-------------|
| `target_owner` | Yes | Owner of the repository to fix. |
| `target_repo` | Yes | Name of the repository to fix. |
| `pull_number` | Yes | PR number as a string. |
| `head_sha` | Yes | PR head commit SHA. Used to restore cached findings. |
| `head_ref` | Yes | PR head branch name. The fix PR is opened against this branch. |
| `base_ref` | Yes | PR base branch. |
| `finding_ids` | Yes | Comma-separated finding IDs or `"all"`. |
| `requested_by` | Yes | GitHub username who triggered the fix command. |
| `target_token` | Yes | GitHub installation token for the target repository. |
| `check_run_id` | Yes | ID of the `A11y Fix` Check Run to update. |
| `ai_model` | No | Claude model to use for patch generation (default `"claude-haiku-4-5-20251001"`). |

## Required Secrets

| Secret | Repository | Description |
|--------|-----------|-------------|
| `ANTHROPIC_API_KEY` | Runner repo | Anthropic API key used by `apply-finding-fix.mjs` when calling the Claude API to generate patches. Required for fix workflows. Also used by the DOM audit workflow for analysis enrichment. |

Configure this secret in the runner repository under **Settings → Secrets and variables → Actions**.

## Runner Repository Configuration

The runner repository is determined by three environment variables on the webhook app:

| Variable | Behavior |
|----------|----------|
| `SCAN_RUNNER_OWNER` | Owner of the runner repo. If empty, defaults to the target repository's owner. |
| `SCAN_RUNNER_REPO` | Name of the runner repo. If empty, defaults to the target repository name. |
| `SCAN_RUNNER_REF` | Branch or tag to dispatch workflows on. Defaults to `"master"`. |

This means you can use the scanned repository itself as the runner by leaving all three variables unset — the workflows just need to be committed to the target repository's default branch.

## Runner Interaction Diagram

```mermaid
%%{init: { 'theme': 'base', 'themeVariables': { 'primaryColor': '#3b5cd9', 'primaryTextColor': '#1e293b', 'primaryBorderColor': '#1e308a', 'lineColor': '#64748b', 'secondaryColor': '#f1f5f9', 'tertiaryColor': '#fff', 'mainBkg': '#fff', 'nodeBorder': '#e2e8f0', 'clusterBkg': '#f8fafc', 'clusterBorder': '#cbd5e1' } } }%%
flowchart TD
    APP["Webhook App<br/>(Vercel / Node)"]
    RUNNER_REPO["Runner Repository<br/>(GitHub Actions)"]
    TARGET_REPO["Target Repository<br/>(PR being reviewed)"]
    CALLBACK["POST /api/scan-callback"]

    subgraph Dispatch
        direction LR
        WD["workflow_dispatch<br/>(inputs: token, target coords,<br/>check_run_id, target_token)"]
    end

    subgraph Runner Workflow
        direction TB
        CO["Checkout runner repo"]
        CT["Checkout target repo<br/>at PR head SHA"]
        SCAN["Run scan / fix"]
        POST["POST callback payload"]
        CO --> CT --> SCAN --> POST
    end

    APP -->|GitHub API| Dispatch
    Dispatch --> RUNNER_REPO
    RUNNER_REPO --> Runner Workflow
    Runner Workflow -->|uses target_token| TARGET_REPO
    POST --> CALLBACK
    CALLBACK --> APP

    classDef default font-family:Inter,sans-serif,font-size:12px;
    classDef core fill:#3b5cd9,color:#fff,stroke:#1e308a,stroke-width:2px;
    classDef entry fill:#1e293b,color:#fff,stroke:#0f172a;

    class SCAN core;
    class APP,CALLBACK entry;
```

## Target Project Runtime Config

The DOM audit and fix workflows read an optional `.a11y-runner.json` file from the root of the checked-out target repository. This file lets the project control how the local server is started.

| Field | Default | Description |
|-------|---------|-------------|
| `workdir` | `"target"` | Working directory for install, build, and start commands. |
| `installCommand` | `""` | Command to install dependencies. Skipped if empty. |
| `buildCommand` | `""` | Command to build the project. Skipped if empty. |
| `startCommand` | `"python3 -m http.server 4173 --bind 127.0.0.1"` | Command to start the local server. |
| `healthUrl` | `"http://127.0.0.1:4173"` | URL polled until the server responds with HTTP 200. |
| `readyTimeoutMs` | `120000` | Maximum time in milliseconds to wait for server readiness. |
