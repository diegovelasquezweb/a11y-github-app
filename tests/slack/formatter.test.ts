import { describe, expect, it } from "vitest";
import { formatAuditResultBlocks, formatScanningBlocks, formatFixProgressBlocks, formatFixResultBlocks } from "../../src/slack/formatter.js";
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
    expect(header.text.text).toContain("Audit Complete");
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
    expect(content).toContain("a11y_actions_A11Y-001");
    expect(content).toContain("A11Y-001");
    expect(content).toContain("A11Y-002");
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
    expect(header.text.text).toContain("Audit Failed");
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

});

describe("formatScanningBlocks", () => {
  it("shows scanning state", () => {
    const blocks = formatScanningBlocks("acme", "site", "Full Audit", "main");
    const header = blocks[0] as { text: { text: string } };
    expect(header.text.text).toContain("Auditing");
    expect(header.text.text).toContain("acme/site");
  });
});

describe("formatFixProgressBlocks", () => {
  it("shows fix progress state", () => {
    const blocks = formatFixProgressBlocks("acme", "site", "A11Y-001 A11Y-002");
    const header = blocks[0] as { text: { text: string } };
    expect(header.text.text).toContain("Applying Fix");
    const content = JSON.stringify(blocks);
    expect(content).toContain("A11Y-001 A11Y-002");
  });
});

describe("formatFixResultBlocks", () => {
  it("shows success with a View Fix link and no retry button when a PR was created", () => {
    const blocks = formatFixResultBlocks(
      {
        prUrl: "https://github.com/acme/site/pull/42",
        results: [
          { id: "A11Y-001", status: "patched", verified: true, title: "Missing alt text" },
          { id: "A11Y-002", status: "skipped", title: "Duplicate finding" },
        ],
      },
      { owner: "acme", repo: "site" },
    );
    const header = blocks[0] as { text: { text: string } };
    expect(header.text.text).toContain("Fix Complete");
    const content = JSON.stringify(blocks);
    expect(content).toContain("https://github.com/acme/site/pull/42");
    expect(content).toContain("View Fix");
    expect(content).not.toContain("a11y_retry_fix");
    expect(content).not.toContain("Retry Fix");
  });

  it("shows success even when the job also reports a failed step, as long as a PR exists (lost notification, not a real failure)", () => {
    const blocks = formatFixResultBlocks(
      { prUrl: "https://github.com/acme/site/pull/7", failedStep: "Rebuild target after patch" },
      { owner: "acme", repo: "site" },
    );
    const header = blocks[0] as { text: { text: string } };
    expect(header.text.text).toContain("Fix Complete");
    const content = JSON.stringify(blocks);
    expect(content).not.toContain("Retry Fix");
  });

  it("shows failure with the failed step and a retry button when no PR was created", () => {
    const blocks = formatFixResultBlocks(
      { failedStep: "Rebuild target after patch" },
      { owner: "acme", repo: "site", headSha: "abc1234", headRef: "feat/x", baseRef: "main", findingIds: "A11Y-001,A11Y-002" },
    );
    const header = blocks[0] as { text: { text: string } };
    expect(header.text.text).toContain("Fix Failed");
    const content = JSON.stringify(blocks);
    expect(content).toContain("Rebuild target after patch");
    expect(content).toContain("a11y_retry_fix");
    expect(content).toContain("Retry Fix");
    const retryValue = JSON.parse((blocks.at(-1) as any).elements[0].value);
    expect(retryValue.id).toBe("A11Y-001,A11Y-002");
    expect(retryValue.o).toBe("acme");
    expect(retryValue.r).toBe("site");
  });

  it("falls back to a generic reason when no step could be attributed", () => {
    const blocks = formatFixResultBlocks(
      {},
      { owner: "acme", repo: "site", pullNumber: 12 },
    );
    const content = JSON.stringify(blocks);
    expect(content).toContain("did not complete");
    expect(content).toContain("a11y_retry_fix");
    const retryValue = JSON.parse((blocks.at(-1) as any).elements[0].value);
    expect(retryValue.n).toBe(12);
    expect(retryValue.id).toBeUndefined();
  });

  it("uses the explicit reason (e.g. nothing to fix) over the generic fallback", () => {
    const blocks = formatFixResultBlocks(
      { reason: "No findings could be automatically fixed" },
      { owner: "acme", repo: "site" },
    );
    const content = JSON.stringify(blocks);
    expect(content).toContain("No findings could be automatically fixed");
  });

  it("splits a long results list across multiple section blocks instead of exceeding Slack's 3000-char limit", () => {
    const results = Array.from({ length: 80 }, (_, i) => ({
      id: `A11Y-${String(i).padStart(3, "0")}`,
      status: "patched",
      verified: true,
      title: "Missing alt text on decorative image inside the hero carousel",
    }));
    const blocks = formatFixResultBlocks(
      { prUrl: "https://github.com/acme/site/pull/42", results },
      { owner: "acme", repo: "site" },
    );
    const sectionTexts = (blocks as Array<{ type: string; text?: { text: string } }>)
      .filter((b) => b.type === "section")
      .map((b) => b.text!.text);
    expect(sectionTexts.length).toBeGreaterThan(1);
    for (const text of sectionTexts) {
      expect(text.length).toBeLessThanOrEqual(3000);
    }
    const rowCount = sectionTexts.join("\n").split("\n").filter((l) => l.startsWith(":")).length;
    expect(rowCount).toBe(results.length);
  });
});
