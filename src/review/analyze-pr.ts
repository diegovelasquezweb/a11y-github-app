import { getSourcePatterns, type SourcePatternFinding } from "@diegovelasquezweb/a11y-engine";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Octokit } from "@octokit/rest";
import { getFileContentAtRef } from "../github/client.js";
import type {
  AnalyzedFinding,
  ChangedFile,
  ReviewAnalysisResult,
  ReviewComment,
} from "../types.js";
import { getAddedLinesFromPatch } from "./diff.js";
import { normalizeSeverity } from "./severity.js";

const SUPPORTED_EXTENSIONS = new Set([
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".html",
  ".htm",
  ".vue",
  ".md",
  ".markdown",
  ".liquid",
]);

function isScannableFile(file: ChangedFile): boolean {
  if (file.status === "removed") {
    return false;
  }

  const ext = path.extname(file.filename).toLowerCase();
  return SUPPORTED_EXTENSIONS.has(ext);
}

function commentBody(finding: SourcePatternFinding): string {
  const severity = normalizeSeverity(finding.severity);
  const title = `**${finding.pattern_id}** — ${severity} | WCAG ${finding.wcag_criterion}`;
  const explanation = finding.fix_description
    ? finding.fix_description
    : "This pattern can create an accessibility barrier and should be remediated.";

  return [
    title,
    "",
    finding.title,
    "",
    explanation,
    "",
    "Source: a11y-engine intelligence",
  ].join("\n");
}

export interface AnalyzePullRequestInput {
  octokit: Octokit;
  owner: string;
  repo: string;
  headSha: string;
  files: ChangedFile[];
  maxInlineComments: number;
}

export async function analyzePullRequest(
  input: AnalyzePullRequestInput,
): Promise<ReviewAnalysisResult> {
  const scannableFiles = input.files.filter(isScannableFile);
  const ignoredFiles = input.files.length - scannableFiles.length;

  if (scannableFiles.length === 0) {
    return { findings: [], comments: [], scannedFiles: 0, ignoredFiles };
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "a11y-pr-review-"));
  try {
    const patchLinesByPath = new Map<string, Set<number>>();

    for (const file of scannableFiles) {
      const content = await getFileContentAtRef(
        input.octokit,
        input.owner,
        input.repo,
        file.filename,
        input.headSha,
      );

      if (typeof content !== "string") {
        continue;
      }

      const absolutePath = path.join(tempDir, file.filename);
      await fs.mkdir(path.dirname(absolutePath), { recursive: true });
      await fs.writeFile(absolutePath, content, "utf8");

      if (file.patch) {
        patchLinesByPath.set(file.filename, getAddedLinesFromPatch(file.patch));
      }
    }

    const result = await getSourcePatterns(tempDir);
    const changedPaths = new Set(scannableFiles.map((file) => file.filename));

    const findings: AnalyzedFinding[] = result.findings
      .filter((finding) => changedPaths.has(finding.file))
      .map((finding) => {
        const addedLines = patchLinesByPath.get(finding.file);
        const hasInlineLocation = addedLines ? addedLines.has(finding.line) : false;
        return {
          finding,
          path: finding.file,
          line: finding.line,
          hasInlineLocation,
        };
      });

    const comments: ReviewComment[] = findings
      .filter((item) => item.hasInlineLocation)
      .slice(0, input.maxInlineComments)
      .map((item) => ({
        path: item.path,
        line: item.line,
        body: commentBody(item.finding),
      }));

    return {
      findings,
      comments,
      scannedFiles: scannableFiles.length,
      ignoredFiles,
    };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}
