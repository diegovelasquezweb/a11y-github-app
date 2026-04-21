# Changelog

All notable changes to this project are documented here.

## 0.4.0 (2026-04-20)

### Added

- **Audit PRs from Slack.** The `/a11y` audit modal now accepts a branch name, a PR number (`123` or `#123`), or a PR URL in the "Branch or PR" field. PR references are resolved via `octokit.pulls.get` to the PR's head SHA, head ref, and pull number, so audit results comment on the PR instead of using the hardcoded `pullNumber: 0`.
- `src/github/resolve-pr-input.ts` — pure `parsePrInput` (regex detection, returns branch/pr/error kind) and `resolvePr` (Octokit PR fetch). 15 new unit tests.

### Known limitations

- Fix workflows triggered from Slack on a PR-based audit still use the audit's head ref as base (preexisting behavior). Propagating the real PR `base_ref` through the workflow callback is deferred to a follow-up.
- Handler integration tests for the PR audit flow are deferred (requires broader test-infra mocking). Unit tests cover the new logic exhaustively; handler wiring is type-checked and straight delegation.

## 0.3.0 (2026-04-20)

### Changed

- **`DOM_AUDIT_ENABLED` default is now `true`.** Previously the app silently ignored audit commands unless this env var was explicitly set to `"true"`, which was a common setup footgun. To disable, set `DOM_AUDIT_ENABLED=false` explicitly.
- **`GITHUB_ISSUES_ENABLED` default is now `true`.** The "Create GitHub Issue" button is shown in Slack findings by default. Set `GITHUB_ISSUES_ENABLED=false` to hide it.
- **Slack fix modal respects `FIX_AI_MODEL`.** The AI Model dropdown in the Slack modal now preselects the model configured in `FIX_AI_MODEL` instead of hardcoding Haiku.

### Security

- **CVE-avoidance: template injection in workflow `run`/`script` blocks.** All `${{ inputs.X }}` interpolations inside shell or `github-script` blocks moved to `env:` vars and read via `$VAR` or `process.env.X`. Prevents RCE via maliciously crafted `/a11y-fix all "hint"` comments, which previously could inject shell commands onto the runner.

### Fixed

- README Step 1 numbering (skipped `6.`).

## 0.2.0 (2026-04-20)

### Added

- **Issue-based audit/fix flow** — audit any branch from a GitHub Issue without needing a PR. Commands in issue comments work the same as in PR comments. Welcome comment posted when an issue is created.
- **`branch:X` parameter** — specify a target branch for audit and fix commands (e.g., `/a11y-audit branch:stage`). In issue context, defaults to the repo's default branch when omitted.
- **Auto-detect project stack** — workflows detect the project stack from `package.json` and build output (Next.js, Vite, CRA, plain HTML) without requiring `.a11y-runner.json`.
- **Unified welcome comment** — PR and Issue welcome comments share a single `buildWelcomeComment()` function.
- **`issues: write` token permission** — installation tokens now include `issues: write` for posting comments on plain issues.
- **`issues` webhook event** — app subscribes to `issues` events to detect issue creation and post welcome comments.
- **Slack integration** — trigger audits and fixes from Slack via `/a11y` slash command. Interactive modals for audit (repo URL, branch, mode) and fix (model, hint). Results posted to both Slack and GitHub.
- **Slack real-time progress** — workflow steps update the Slack message in real time with a progress bar (`▓▓░░░░ Installing dependencies…`).
- **Slack severity indicators** — findings use colored squares (🟥 Critical, 🟧 Serious, 🟨 Moderate, 🟦 Minor) in Slack messages.
- **Fix modal UX** — finding IDs pre-filled from button context (no manual ID entry). Modal shows description explaining what will happen.
- **GitHub URL input** — Slack audit modal accepts full GitHub URLs (e.g., `https://github.com/owner/repo`), not just `owner/repo`.
- **`api/slack` endpoint** — receives Slack slash commands, modal submissions, and button actions.
- **`api/slack-progress` endpoint** — receives progress updates from workflows to update Slack messages.
- **Jira integration** — create Jira tickets directly from Slack audit results. Per-finding or bulk ticket via Jira REST API v3. Falls back to pre-filled browser URLs when Jira env vars are not set.
- **Documented `GITHUB_ISSUES_ENABLED`** — configuration var to enable the "Create GitHub Issue" button next to each Slack finding.
- **Documented `JIRA_PROJECT_KEY`** — optional pre-fill for the Slack Jira project key modal.

### Fixed

- Skip welcome comment on `a11y-fix/*` branches to avoid noise on fix PRs.
- Use `git add -u` instead of `git add -A` to avoid staging untracked files in fix PRs.
- Plain bullets in suggested workflow to avoid GitHub task list drag handles in issue comments.
- Bare `/a11y-audit branch` (without a value) returns null instead of triggering an audit.
- Branch not found error posts an explanatory comment instead of failing silently.
- Docs: Jira flow in `architecture.md` now describes the actual one-step flow (project key → hardcoded `Task` → create) instead of the inexistent five-step flow with issue type selection.
- Docs: Slack formatter cap in `architecture.md` corrected to `max 20 findings total` (up to 10 pattern + remaining DOM) instead of the misleading `20 DOM + 10 pattern`.
- Docs: Jira success/failure replies in `jira-setup.md` correctly described as thread messages (`chat.postMessage`) instead of ephemeral replies.

### Removed

- `JIRA_ISSUE_TYPE` env var — dead code residual from the pre-`jira-modal` design. Issue type is hardcoded to `"Task"` in the handler.

## 0.1.0

Initial release.

### Added

- Webhook server (Express v5, Vercel deployment).
- HMAC signature verification and delivery deduplication.
- PR welcome comment on `pull_request` opened/reopened.
- `/a11y-audit` — full audit: DOM scan + source pattern analysis.
- `/a11y-audit dom` — DOM scan only.
- `/a11y-audit source` — source pattern scan only.
- `/a11y-fix <ID>`, `/a11y-fix <ID1> <ID2>`, `/a11y-fix all` — automated fixes via Claude API.
- Model alias support in `/a11y-fix` (`haiku`, `sonnet`, `opus`).
- Hint support in `/a11y-fix` (e.g., `/a11y-fix all "use sr-only labels"`).
- Check Runs for audit and fix status visibility on PRs.
- Callback endpoint (`/api/scan-callback`) with timing-safe token verification.
- Findings cached by head SHA for cross-workflow data sharing.
- AI token usage and cost reporting in fix comments.
- Configurable AI model via `FIX_AI_MODEL` environment variable.
- Runner repository configuration (same-repo or dedicated).
- `.a11y-runner.json` for custom server configuration.
- GitHub Actions workflows: `dom-audit.yml`, `source-audit.yml`, `a11y-fix.yml`.
