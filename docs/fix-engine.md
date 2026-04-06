# Fix Engine

**Navigation**: [Home](../README.md) • [Architecture](architecture.md) • [Commands](commands.md) • [Configuration](configuration.md) • [Runner Setup](runner-setup.md) • [Fix Engine](fix-engine.md)

---

## Table of Contents

- [Overview](#overview)
- [Fix Strategies](#fix-strategies)
  - [DOM Findings (A11Y-*)](#dom-findings-a11y-)
  - [Pattern Findings (PAT-*)](#pattern-findings-pat-)
- [Git Checkpoint Pattern](#git-checkpoint-pattern)
- [Fix Result Statuses](#fix-result-statuses)
- [AI Usage Reporting](#ai-usage-reporting)
- [Model Configuration](#model-configuration)

## Overview

The fix engine is implemented in `runner/scripts/apply-finding-fix.mjs` and runs inside the `a11y-fix.yml` GitHub Actions workflow. For each finding ID, the workflow invokes the script with environment variables pointing to the target directory, findings cache, and the AI model to use. The script calls `applyFindingFix()` from the `@diegovelasquezweb/a11y-engine` package, which handles the full patch lifecycle: locating the element, generating a code patch via the Claude API, and writing the result to disk.

## Fix Strategies

The engine selects a fix strategy based on the finding ID prefix.

### DOM Findings (A11Y-*)

DOM findings originate from the axe + cdp + pa11y browser scan. Each finding carries a CSS `selector` that uniquely identifies the element in the rendered page.

**Strategy**:
1. Load the finding from the DOM findings cache (`findings/a11y-findings.json`).
2. Use the CSS selector to locate the element in the target source files.
3. Call the Claude API with the element's HTML context and the recommended fix guidance from the engine's intelligence database.
4. Apply the generated patch to the target file.
5. After all findings in the batch have been patched, restart the local server and re-run `a11y-audit` with `--routes` and `--only-rule` targeting the specific pages and rules that were fixed.
6. Compare the re-scan results to the original: if the same `rule_id` + `selector` combination no longer appears, the finding is marked `verified` → status `fixed`.

### Pattern Findings (PAT-*)

Pattern findings originate from the static source pattern scanner. Each finding carries a `file` path and `line` number.

**Strategy**:
1. Load the finding from the pattern findings cache (`findings/a11y-pattern-findings.json`).
2. Open the target file at the recorded path and line number.
3. Call the Claude API with the surrounding code context and the pattern's remediation guidance.
4. Apply the generated patch to the target file.
5. No DOM re-verification is performed for pattern findings — the fix is marked `patched` after successful application.

## Git Checkpoint Pattern

Before each finding is processed, the workflow saves the current diff of the target directory to a checkpoint file:

```sh
git -C target diff > "$CHECKPOINT_FILE"
```

If the patch application fails or the finding status is not `patched`, the workflow resets the working tree to the pre-patch state and reapplies only the checkpoint (preserving any earlier successful patches in the same run):

```sh
git -C target checkout -- .
git -C target apply "$CHECKPOINT_FILE"
```

This ensures that a failure on finding N does not discard the patches already applied for findings 1 through N-1. Each finding in a multi-fix run is independent at the git level.

## Fix Result Statuses

| Status | Icon | Trigger Condition |
|--------|------|-------------------|
| `fixed` | ✅ | Patch was applied and DOM re-verification confirmed the `rule_id` + `selector` combination no longer appears in the re-scan results. |
| `patched` (unverified) | ⚠️ | Patch was applied but re-verification was skipped (pattern finding) or the re-scan result was inconclusive (selector not matched, scan failed). Reported as "Patched but not verified". |
| `skipped` | ⏭️ | The engine returned `"search block not found"` in its message — the code at the target location was already modified by an earlier finding in the same run, so there was nothing to patch. |
| `failed` | ❌ | The Claude API could not produce a valid patch, or the patch could not be applied to the file. The git checkpoint is restored so prior successful patches in the run are preserved. |

## AI Usage Reporting

Every `apply-finding-fix.mjs` invocation outputs `input_tokens` and `output_tokens` consumed by the Claude API for that finding. The workflow accumulates them across all findings in the run:

```sh
TOTAL_INPUT_TOKENS=$((TOTAL_INPUT_TOKENS + ${FINDING_INPUT_TOKENS:-0}))
TOTAL_OUTPUT_TOKENS=$((TOTAL_OUTPUT_TOKENS + ${FINDING_OUTPUT_TOKENS:-0}))
```

The totals are reported in both the fix PR description and the result comment posted on the original PR:

| Metric | Value |
|--------|-------|
| Model | `claude-haiku-4-5-20251001` (or the configured model) |
| Input tokens | Accumulated across all findings |
| Output tokens | Accumulated across all findings |
| Estimated cost | Calculated as shown below |

**Cost formula** (Haiku 4.5 pricing):

```
estimated_cost = (input_tokens × $0.80 + output_tokens × $4.00) / 1,000,000
```

The result is formatted to 6 decimal places (e.g., `$0.000420`).

## Model Configuration

The Claude model used for patch generation is controlled by the `FIX_AI_MODEL` environment variable on the webhook app. Its value is forwarded to the runner workflow as the `ai_model` input at dispatch time and passed to `apply-finding-fix.mjs` via the `AI_MODEL` environment variable.

The default model is `claude-haiku-4-5-20251001`.

To switch models, update `FIX_AI_MODEL` in your deployment environment (e.g., Vercel project settings). No runner redeployment is required — the value is injected fresh with each workflow dispatch.
