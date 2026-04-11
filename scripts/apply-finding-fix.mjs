import fs from "node:fs";
import * as engineModule from "@diegovelasquezweb/a11y-engine";
const applyFindingFix = engineModule.applyFindingFix;
const applyFindingsFix = engineModule.applyFindingsFix;

const findingId = process.env.FINDING_ID || "";
const findingIds = process.env.FINDING_IDS || "";
const targetDir = process.env.TARGET_DIR || "";
const findingsPath = process.env.FINDINGS_PATH || "";
const patternFindingsPath = process.env.PATTERN_FINDINGS_PATH || "";
const aiModel = process.env.AI_MODEL || "";
const projectHintsRaw = process.env.PROJECT_HINTS || "";
const githubOutput = process.env.GITHUB_OUTPUT || "";
const resultsOutputPath = process.env.RESULTS_OUTPUT_PATH || "";

function appendOutput(name, value) {
  if (!githubOutput) {
    return;
  }
  fs.appendFileSync(githubOutput, `${name}=${String(value ?? "").replace(/\n/g, "%0A")}\n`);
}

function readJson(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

const payload = readJson(findingsPath);
const patternPayload = readJson(patternFindingsPath);

if (!payload) {
  appendOutput("status", "error");
  appendOutput("reason", "Could not load the engine findings payload.");
  process.exit(1);
}

let projectHints = "";
if (projectHintsRaw) {
  try {
    projectHints = JSON.stringify(JSON.parse(projectHintsRaw));
  } catch {
    projectHints = projectHintsRaw;
  }
}

// Multi-finding DOM batch path (FINDING_IDS env var, comma-separated, no PAT-* IDs)
if (findingIds) {
  const ids = findingIds
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  let results;
  try {
    ({ results } = await applyFindingsFix({
      findingIds: ids,
      findingsPayload: payload,
      projectDir: targetDir,
      ...(projectHints ? { projectHints } : {}),
      ...(aiModel ? { ai: { model: aiModel } } : {}),
    }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[apply-findings-fix] error: ${msg}\n`);
    results = ids.map((id) => ({
      id,
      status: "error",
      reason: "patch-generation-failed",
      message: msg,
      patchedFile: "",
      findingTitle: "",
      verifyRule: "",
      verifyRoute: "/",
      usage: { input_tokens: 0, output_tokens: 0 },
    }));
  }

  if (resultsOutputPath) {
    fs.writeFileSync(resultsOutputPath, JSON.stringify(results, null, 2), "utf8");
  } else {
    process.stdout.write(JSON.stringify(results, null, 2) + "\n");
  }
  process.exit(0);
}

// Single-finding path (FINDING_ID env var — handles both DOM and PAT-* findings)
const result = await applyFindingFix({
  findingId,
  payload,
  patternPayload,
  projectDir: targetDir,
  ...(projectHints ? { projectHints } : {}),
  ...(aiModel ? { ai: { model: aiModel } } : {}),
});

appendOutput("status", result.status);
appendOutput("reason", result.reason || "");
appendOutput("message", result.message || "");
appendOutput("patched_file", result.patchedFile || "");
appendOutput("verify_rule", result.verifyRule || "");
appendOutput("verify_route", result.verifyRoute || "/");
appendOutput("finding_title", result.findingTitle || "");
appendOutput("branch_slug", result.branchSlug || "");
appendOutput("input_tokens", result.usage?.input_tokens ?? 0);
appendOutput("output_tokens", result.usage?.output_tokens ?? 0);
