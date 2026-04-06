import fs from "node:fs";
import { applyFindingFix } from "@diegovelasquezweb/a11y-engine";

const findingId = process.env.FINDING_ID || "";
const targetDir = process.env.TARGET_DIR || "";
const findingsPath = process.env.FINDINGS_PATH || "";
const patternFindingsPath = process.env.PATTERN_FINDINGS_PATH || "";
const aiModel = process.env.AI_MODEL || "";
const githubOutput = process.env.GITHUB_OUTPUT || "";

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

const result = await applyFindingFix({
  findingId,
  payload,
  patternPayload,
  projectDir: targetDir,
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
