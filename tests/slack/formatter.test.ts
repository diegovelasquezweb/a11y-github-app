import { describe, expect, it } from "vitest";
import { formatAuditResultBlocks, formatScanningBlocks, formatFixProgressBlocks } from "../../src/slack/formatter.js";
import type { DomAuditSummary } from "../../src/types.js";

const baseSummary: DomAuditSummary = {
  scanToken: "test",
  targetUrl: "http://localhost",
  status: "success",
  totalFindings: 0,
  totals: { Critical: 0, Serious: 0, Moderate: 0, Minor: 0 },
};

const ctx = { owner: "acme", repo: "site", branch: "main" };

describe("formatAuditResultBlocks", () => {
  it("shows success message for 0 findings", () => {
    const blocks = formatAuditResultBlocks(baseSummary, ctx);
    const header = blocks[0] as { text: { text: string } };
    expect(header.text.text).toContain("✅");
    expect(blocks.some((b: Record<string, unknown>) => b.type === "actions" && JSON.stringify(b).includes("Fix All"))).toBe(false);
  });

  it("shows findings with severity icons", () => {
    const summary: DomAuditSummary = {
      ...baseSummary,
      totalFindings: 2,
      totals: { Critical: 1, Serious: 1, Moderate: 0, Minor: 0 },
      findings: [
        { id: "A11Y-001", title: "Missing alt text", severity: "Critical", wcag: null, url: "http://localhost/about", selector: "img.hero", recommendedFix: null },
        { id: "A11Y-002", title: "Low contrast", severity: "Serious", wcag: null, url: "", selector: ".text", recommendedFix: null },
      ],
    };
    const blocks = formatAuditResultBlocks(summary, ctx);
    const content = JSON.stringify(blocks);
    expect(content).toContain(":red_circle:");
    expect(content).toContain(":large_orange_circle:");
    expect(content).toContain("Fix A11Y-001");
    expect(content).toContain("Fix A11Y-002");
  });

  it("caps DOM findings at 20", () => {
    const findings = Array.from({ length: 25 }, (_, i) => ({
      id: `A11Y-${i}`, title: `Finding ${i}`, severity: "Minor", wcag: null, url: "", selector: ".x", recommendedFix: null,
    }));
    const summary: DomAuditSummary = {
      ...baseSummary,
      totalFindings: 25,
      totals: { Critical: 0, Serious: 0, Moderate: 0, Minor: 25 },
      findings,
    };
    const blocks = formatAuditResultBlocks(summary, ctx);
    const fixButtons = blocks.filter((b: Record<string, unknown>) =>
      b.type === "actions" && JSON.stringify(b).includes("a11y_fix_finding"),
    );
    expect(fixButtons.length).toBeLessThanOrEqual(20);
    const content = JSON.stringify(blocks);
    expect(content).toContain("Showing");
    expect(content).toContain("of 25");
  });

  it("shows Fix All button when findings exist", () => {
    const summary: DomAuditSummary = {
      ...baseSummary,
      totalFindings: 1,
      totals: { Critical: 0, Serious: 1, Moderate: 0, Minor: 0 },
      findings: [{ id: "A11Y-001", title: "Test", severity: "Serious", wcag: null, url: "", selector: "", recommendedFix: null }],
    };
    const blocks = formatAuditResultBlocks(summary, ctx);
    const content = JSON.stringify(blocks);
    expect(content).toContain("Fix All");
    expect(content).toContain('"style":"primary"');
  });

  it("shows error state for failure status", () => {
    const summary: DomAuditSummary = {
      ...baseSummary,
      status: "failure",
      error: "Timeout waiting for server",
    };
    const blocks = formatAuditResultBlocks(summary, ctx);
    const header = blocks[0] as { text: { text: string } };
    expect(header.text.text).toContain("❌");
    const content = JSON.stringify(blocks);
    expect(content).toContain("Timeout waiting for server");
    expect(content).toContain("Retry Audit");
  });

  it("separates pattern findings from DOM findings", () => {
    const summary: DomAuditSummary = {
      ...baseSummary,
      totalFindings: 1,
      totals: { Critical: 0, Serious: 1, Moderate: 0, Minor: 0 },
      findings: [{ id: "A11Y-001", title: "DOM issue", severity: "Serious", wcag: null, url: "", selector: ".x", recommendedFix: null }],
      patternFindings: {
        totalFindings: 1,
        totals: { Critical: 0, Serious: 0, Moderate: 1, Minor: 0 },
        findings: [{ id: "PAT-001", title: "Pattern issue", severity: "Moderate", file: "src/App.tsx", line: 10, patternId: "no-outline-none" }],
      },
    };
    const blocks = formatAuditResultBlocks(summary, ctx);
    const content = JSON.stringify(blocks);
    expect(content).toContain("Source Pattern Analysis");
    expect(content).toContain("DOM Audit");
    expect(content).toContain("PAT-001");
    expect(content).toContain("A11Y-001");
  });

  it("includes View on GitHub button when URL provided", () => {
    const blocks = formatAuditResultBlocks(baseSummary, { ...ctx, githubCommentUrl: "https://github.com/acme/site/issues/1#issuecomment-123" });
    const content = JSON.stringify(blocks);
    expect(content).toContain("View on GitHub");
  });
});

describe("formatScanningBlocks", () => {
  it("shows scanning state", () => {
    const blocks = formatScanningBlocks("acme", "site", "Full Audit", "main");
    const header = blocks[0] as { text: { text: string } };
    expect(header.text.text).toContain("⏳");
    expect(header.text.text).toContain("acme/site");
  });
});

describe("formatFixProgressBlocks", () => {
  it("shows fix progress state", () => {
    const blocks = formatFixProgressBlocks("acme", "site", "A11Y-001 A11Y-002");
    const header = blocks[0] as { text: { text: string } };
    expect(header.text.text).toContain("🔧");
    const content = JSON.stringify(blocks);
    expect(content).toContain("A11Y-001 A11Y-002");
  });
});
