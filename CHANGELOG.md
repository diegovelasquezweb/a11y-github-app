# Changelog

All notable changes to this project are documented here.

## Unreleased

### Added

- **Issue-based audit/fix flow** — audit any branch from a GitHub Issue without needing a PR. Commands in issue comments work the same as in PR comments. Welcome comment posted when an issue is created.
- **`branch:X` parameter** — specify a target branch for audit and fix commands (e.g., `/a11y-audit branch:stage`). In issue context, defaults to the repo's default branch when omitted.
- **Auto-detect project stack** — workflows detect the project stack from `package.json` and build output (Next.js, Vite, CRA, plain HTML) without requiring `.a11y-runner.json`.
- **Unified welcome comment** — PR and Issue welcome comments share a single `buildWelcomeComment()` function.
- **`issues: write` token permission** — installation tokens now include `issues: write` for posting comments on plain issues.
- **`issues` webhook event** — app subscribes to `issues` events to detect issue creation and post welcome comments.

### Fixed

- Skip welcome comment on `a11y-fix/*` branches to avoid noise on fix PRs.
- Use `git add -u` instead of `git add -A` to avoid staging untracked files in fix PRs.
- Plain bullets in suggested workflow to avoid GitHub task list drag handles in issue comments.
- Bare `/a11y-audit branch` (without a value) returns null instead of triggering an audit.
- Branch not found error posts an explanatory comment instead of failing silently.

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
