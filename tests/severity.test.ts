import { describe, expect, it } from "vitest";
import { countBySeverity, normalizeSeverity, severityIcon } from "../src/severity.js";

describe("severity helpers", () => {
  it("normalizes severity strings", () => {
    expect(normalizeSeverity("critical")).toBe("Critical");
    expect(normalizeSeverity("SERIOUS")).toBe("Serious");
  });

  it("keeps unknown severity honest instead of reclassifying to Moderate", () => {
    expect(normalizeSeverity("weird-value")).toBe("Unknown");
    expect(normalizeSeverity("")).toBe("Unknown");
    expect(normalizeSeverity("Unknown")).toBe("Unknown");
  });

  it("maps severity to per-surface icons", () => {
    expect(severityIcon("critical")).toBe("🔴");
    expect(severityIcon("critical", "slack")).toBe(":red_circle:");
    expect(severityIcon("weird-value")).toBe("⚪");
    expect(severityIcon("weird-value", "slack")).toBe(":white_circle:");
  });

  it("counts findings by severity and keeps Unknown reconciled", () => {
    const items = [
      { severity: "Critical" },
      { severity: "critical" },
      { severity: "minor" },
      { severity: "weird-value" },
    ];
    const counts = countBySeverity(items, (item) => item.severity);
    expect(counts.Critical).toBe(2);
    expect(counts.Minor).toBe(1);
    expect(counts.Unknown).toBe(1);
    expect(counts.Serious).toBe(0);
  });
});
