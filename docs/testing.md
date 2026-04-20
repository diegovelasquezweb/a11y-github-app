# Testing

**Navigation**: [Home](../README.md) • [Architecture](architecture.md) • [Configuration](configuration.md) • [Runner Setup](runner-setup.md) • [Slack Setup](slack-setup.md) • [Jira Setup](jira-setup.md) • [Audit Engine](audit-engine.md) • [Fix Engine](fix-engine.md)

---

## Table of Contents

- [Running Tests](#running-tests)
- [Test Suites](#test-suites)
  - [Webhook](#webhook)
  - [Slack](#slack)
  - [Jira](#jira)
  - [Utilities](#utilities)

---

## Running Tests

```bash
npm test
```

17 test files · 162 tests · ~500ms

---

## Test Suites

### Webhook

| File | What it covers |
|------|---------------|
| `tests/process.test.ts` | `processWebhook` — signature validation, pull_request events (opened/closed/synchronize, deduplication, welcome comment), issue_comment events (author association guard, audit command dispatch, fix command dispatch), unsupported event types |
| `tests/dom-callback.test.ts` | DOM audit callback handler — payload parsing, comment creation and update, Check Run completion, Slack dual-post when context is present |
| `tests/dom-callback-process.test.ts` | Callback processing edge cases — missing fields, failure status, source pattern findings merge |
| `tests/dom-workflow.test.ts` | `createScanToken` — format, lowercase normalization, uniqueness per call, pull number embedding |
| `tests/audit-command.test.ts` | `parseAuditCommand` — all audit modes (`unified`, `dom`, `source`), `branch:X` parsing, invalid inputs |
| `tests/fix-command.test.ts` | `parseFixCommand` — single ID, multiple IDs, `all`, model override, hint parsing, invalid inputs |
| `tests/verify-signature.test.ts` | `verifyWebhookSignature` — valid and invalid HMAC-SHA256 signatures |

### Slack

| File | What it covers |
|------|---------------|
| `tests/slack/handler.test.ts` | Slack interaction handler — Jira button click (single and bulk payloads), project key modal submission (empty key validation, valid key triggers ticket creation), deferred block_actions work, `errorCodeToMessage` mappings |
| `tests/slack/formatter.test.ts` | `formatAuditResultBlocks` — 0 findings (success state), findings with severity icons, DOM cap at 20, Fix All button, error state, pattern findings separation; `formatScanningBlocks`; `formatFixProgressBlocks` |
| `tests/slack/modals.test.ts` | All modal builders — `buildAuditModal` (callback_id, blocks, options, metadata round-trip), `buildFixModal` (title/description variants, metadata), `buildJiraProjectKeyModal` (submit label, initial_value), loading/issue-type/error modals |
| `tests/slack/notifier.test.ts` | `postScanningMessage`, `updateWithAuditResults`, `postFixProgress` — success, API failure resilience, thread_ts propagation, fallback from `chat.update` to `postMessage` |
| `tests/slack/verify.test.ts` | `verifySlackSignature` — valid signature, invalid signature, expired timestamp, future timestamp, missing headers, wrong prefix, non-numeric timestamp |

### Jira

| File | What it covers |
|------|---------------|
| `tests/jira/create-issue.test.ts` | `createJiraIssue` — 201/200 success (issueKey, issueUrl), all HTTP error codes (401/403/400/404/500), network error, missing config guard, no priority field in payload, AbortSignal passed |
| `tests/jira/fetch-issue-types.test.ts` | `fetchJiraIssueTypes` — missing config guard, 200 with issue types, empty response, all HTTP error codes, network error, project key in URL, AbortSignal passed |
| `tests/jira/adf.test.ts` | `buildAdf` — empty sections, heading node shape, paragraph with label (strong mark), paragraph without label, section ordering |

### Utilities

| File | What it covers |
|------|---------------|
| `tests/severity.test.ts` | Severity helpers — string normalization, sort ranking (critical → serious → moderate → minor), `requestsChanges` flag for serious/critical |
| `tests/diff.test.ts` | `getAddedLinesFromPatch` — added line number extraction from unified diff format |
