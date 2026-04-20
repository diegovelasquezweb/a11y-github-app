# Commands

**Navigation**: [Home](../README.md) • [Architecture](architecture.md) • [Commands](commands.md) • [Configuration](configuration.md) • [Runner Setup](runner-setup.md) • [Slack Setup](slack-setup.md) • [Jira Setup](jira-setup.md) • [Fix Engine](fix-engine.md)

---

## Table of Contents

- [Authorization](#authorization)
- [Contexts](#contexts)
- [Commands Reference](#commands-reference)
- [Audit Commands](#audit-commands)
  - [/a11y-audit](#a11y-audit)
  - [/a11y-audit dom](#a11y-audit-dom)
  - [/a11y-audit source](#a11y-audit-source)
- [Fix Commands](#fix-commands)
  - [/a11y-fix](#a11y-fix)
- [Audit Output Format](#audit-output-format)
- [Fix Result Statuses](#fix-result-statuses)

## Authorization

Commands are triggered via PR comments or Issue comments. Only users with `COLLABORATOR`, `MEMBER`, or `OWNER` association can trigger them. Comments from users with any other association (e.g., `CONTRIBUTOR`, `NONE`, `FIRST_TIME_CONTRIBUTOR`) are silently ignored — no error is posted.

## Contexts

Commands work in two contexts:

| Context | Trigger | Branch resolution | Results posted to |
|---------|---------|-------------------|-------------------|
| **Pull Request** | PR comment | Uses PR head SHA and branch | PR comment + Check Run |
| **Issue** | Issue comment | Defaults to repo's default branch; use `branch:X` for a specific branch | Issue comment + Check Run |

When a PR is opened or an Issue is created, the app posts a **welcome comment** listing all available commands.

## Commands Reference

| Command | Context | What it does | Output |
|---------|---------|--------------|--------|
| `/a11y-audit` | PR or Issue | Full audit: DOM scan + static source pattern analysis | Comment with both sections |
| `/a11y-audit dom` | PR or Issue | DOM scan only using a real browser | Comment with DOM findings only |
| `/a11y-audit source` | PR or Issue | Static source pattern scan only | Comment with source pattern findings only |
| `/a11y-audit branch:stage` | Issue only | Audit a specific branch | Comment with findings from that branch |
| `/a11y-fix <ID>` | PR or Issue | Fix one finding | New branch + PR with the patch |
| `/a11y-fix <ID1> <ID2>` | PR or Issue | Fix multiple findings | New branch + PR with all applied patches |
| `/a11y-fix all` | PR or Issue | Fix all findings from the last audit | New branch + PR with all applied patches |

## Audit Commands

### /a11y-audit

Triggers a full audit combining a live DOM scan and a static source pattern analysis.

**Syntax**:
```
/a11y-audit                      # PR: scans PR head; Issue: scans default branch
/a11y-audit branch:stage         # Issue only: scans a specific branch
```

**What happens**:
1. The app resolves the target branch and SHA:
   - **PR context**: uses the PR head SHA and branch.
   - **Issue context**: defaults to the repo's default branch; if `branch:X` is provided, resolves that branch via the GitHub API. If the branch does not exist, an error comment is posted.
2. The app creates a `Check Run` named `A11y Audit` in `in_progress` state.
3. A `dom-audit.yml` workflow is dispatched to the runner repo.
4. The runner checks out the target at the resolved SHA, auto-detects the project stack, installs dependencies and builds (if applicable), starts a local server, and runs `a11y-audit` (axe + cdp + pa11y engines, up to 10 routes, crawl depth 3).
5. If `SOURCE_PATTERNS_ENABLED` is not `false`, the source pattern scanner also runs.
6. Findings are cached by head SHA for use by `/a11y-fix`.
7. The runner POSTs a callback to `/api/scan-callback`.
8. The app updates the Check Run and replaces the initial comment with the full results.

The resulting comment contains a **Source Pattern Analysis** section followed by a **DOM Audit** section, each with severity breakdowns and per-finding fix commands.

> **Note**: `/a11y-audit branch` (without a value) is treated as invalid and returns null — no audit is triggered.

---

### /a11y-audit dom

Triggers a DOM-only audit. The source pattern scanner does not run.

**Syntax**:
```
/a11y-audit dom
/a11y-audit dom branch:stage     # Issue only
```

**What happens**: Same as `/a11y-audit` except `source_scan_enabled` is set to `false` in the workflow dispatch. Only the DOM section appears in the resulting comment.

---

### /a11y-audit source

Triggers a source-only audit. No browser is launched.

**Syntax**:
```
/a11y-audit source
/a11y-audit source branch:stage  # Issue only
```

**What happens**:
1. The app dispatches `source-audit.yml` instead of `dom-audit.yml`.
2. The runner checks out the target at the resolved SHA and runs the source pattern scanner only.
3. Pattern findings are cached by head SHA.
4. The runner POSTs a callback with `audit_mode: "source"`.
5. The app updates the Check Run and comment with source pattern results only.

The timeout for this workflow is 10 minutes (versus 20 minutes for the DOM audit).

---

## Fix Commands

### /a11y-fix

Applies automated fixes to one or more findings from the last audit. Findings must have been cached by a prior audit run on the same head SHA.

**Syntax**:

```
/a11y-fix <ID>
/a11y-fix <ID1> <ID2> <ID3>
/a11y-fix all
/a11y-fix sonnet all              # Use a specific model (haiku · sonnet · opus)
/a11y-fix all "use sr-only labels" # Pass a hint to guide the fix
```

- `<ID>` is a finding ID printed in the audit comment (e.g., `A11Y-8cc6e6` for DOM findings, `PAT-143360` for source pattern findings).
- Multiple IDs are separated by spaces.
- `all` resolves to every finding from both the DOM findings cache and the pattern findings cache for the current head SHA.
- An optional model name (`haiku`, `sonnet`, `opus`) can be placed before the IDs to override the default AI model.
- An optional hint in quotes can be appended to guide the fix strategy.

**What happens**:
1. The app resolves the target branch and SHA (same logic as audit commands).
2. The app creates a `Check Run` named `A11y Fix` in `in_progress` state.
3. The app posts a confirmation comment.
4. An `a11y-fix.yml` workflow is dispatched to the runner repo.
5. The runner restores cached findings, applies patches using the Claude AI model, verifies each patch, and opens a PR with the passing patches.
6. On completion, the app updates the Check Run and posts a result summary comment.

If `/a11y-fix` is used without any IDs, the command is ignored with no visible response.

> **Note**: `/a11y-fix branch` (without a value) is treated as invalid — no fix is triggered. In issue context, fix commands printed in audit reports already include `branch:X` automatically.

---

## Audit Output Format

Findings in the PR comment are sorted by severity (Critical first, then Serious, Moderate, Minor) and presented as a numbered list.

**Severity icons**:

| Icon | Severity |
|------|----------|
| 🔴 | Critical |
| 🟠 | Serious |
| 🟡 | Moderate |
| 🔵 | Minor |

**DOM finding entry**:
```
1. 🔴 [Critical] Images must have alternative text
   WCAG: wcag111
   Selector: `img.hero-image`
   Fix: `/a11y-fix A11Y-001`
```

**Source pattern finding entry**:
```
1. 🟠 [Serious] Suppressed focus outline
   File: `src/components/Button.css:42`
   Rule: `no-outline-none`
   Fix: `/a11y-fix PAT-001`
```

If the total number of findings exceeds the inline limit (default 30), the comment shows the first 30 and notes the total count. The **Quick Fix** section below the findings always shows the fix command shortcuts.

---

## Fix Result Statuses

| Icon | Status | Description |
|------|--------|-------------|
| ✅ | Fixed & verified | Patch was applied and the DOM re-audit confirmed the rule violation no longer appears at the same selector. |
| ⚠️ | Patched but not verified | Patch was applied but re-verification was skipped or inconclusive (e.g., the rule or selector was not matched in the re-scan). |
| ⏭️ | Skipped | The search block for this finding was not found in the source file — the code was likely already patched by an earlier finding in the same run. |
| ❌ | Failed | The Claude API could not produce a valid patch, or the patch could not be applied to the target file. The git checkpoint is restored so prior good patches survive. |
