import { describe, expect, it, vi } from "vitest";

vi.mock("../src/config.js", () => ({
  CONFIG: {
    webhookSecret: "test-secret",
    domAuditCallbackToken: "test-token",
    domAuditEnabled: true,
    appBaseUrl: "http://localhost:3000",
    maxInlineComments: 10,
    scanRunnerOwner: "",
    scanRunnerRepo: "",
    scanRunnerRef: "main",
    scanRunnerWorkflow: "dom-audit.yml",
    scanFixWorkflow: "a11y-fix.yml",
  },
}));

vi.mock("../src/github/auth.js", () => ({
  getRepoOctokit: vi.fn(),
  getInstallationOctokit: vi.fn(),
  createInstallationToken: vi.fn(),
}));

vi.mock("../src/review/dom-reporter.js", () => ({
  completeDomAuditCheck: vi.fn(),
}));

import { buildFinalComment } from "../src/webhook/dom-callback.js";
import type { DomAuditSummary } from "../src/types.js";

const baseSummary: DomAuditSummary = {
  scanToken: "tok-001",
  targetUrl: "http://127.0.0.1:4173",
  status: "success",
  totalFindings: 0,
  totals: { Critical: 0, Serious: 0, Moderate: 0, Minor: 0 },
};

describe("buildFinalComment", () => {
  it("renders DOM-only section when no patternFindings", () => {
    const result = buildFinalComment(baseSummary);
    expect(result).toContain("### DOM Audit");
    expect(result).not.toContain("### Source Pattern Analysis");
  });

  it("renders both sections when patternFindings is present", () => {
    const summary: DomAuditSummary = {
      ...baseSummary,
      patternFindings: {
        totalFindings: 1,
        totals: { Critical: 1, Serious: 0, Moderate: 0, Minor: 0 },
        findings: [
          {
            id: "PAT-abc123",
            title: "Input uses placeholder as only label",
            severity: "Critical",
            file: "index.html",
            line: 27,
            patternId: "placeholder-only-label",
          },
        ],
      },
    };
    const result = buildFinalComment(summary);
    expect(result).toContain("### Source Pattern Analysis");
    expect(result).toContain("### DOM Audit");
    expect(result).toContain("PAT-abc123");
    expect(result).toContain("/a11y-fix PAT-abc123");
  });

  it("renders Source Pattern Analysis before DOM Audit", () => {
    const summary: DomAuditSummary = {
      ...baseSummary,
      patternFindings: {
        totalFindings: 1,
        totals: { Critical: 0, Serious: 1, Moderate: 0, Minor: 0 },
        findings: [
          {
            id: "PAT-xyz",
            title: "Missing label",
            severity: "Serious",
            file: "form.html",
            patternId: "missing-label",
          },
        ],
      },
    };
    const result = buildFinalComment(summary);
    const patternIdx = result.indexOf("### Source Pattern Analysis");
    const domIdx = result.indexOf("### DOM Audit");
    expect(patternIdx).toBeLessThan(domIdx);
  });

  it("renders no-findings message in Source Pattern Analysis when totalFindings is 0", () => {
    const summary: DomAuditSummary = {
      ...baseSummary,
      patternFindings: {
        totalFindings: 0,
        totals: { Critical: 0, Serious: 0, Moderate: 0, Minor: 0 },
        findings: [],
      },
    };
    const result = buildFinalComment(summary);
    expect(result).toContain("No source pattern issues found");
  });

  it("renders failure message for DOM audit failure", () => {
    const summary: DomAuditSummary = {
      ...baseSummary,
      status: "failure",
      error: "Audit runner crashed",
    };
    const result = buildFinalComment(summary);
    expect(result).toContain("Audit runner crashed");
    expect(result).toContain("/a11y-audit");
  });
});
