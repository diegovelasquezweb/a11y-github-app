import { describe, expect, it } from "vitest";
import { parseFixCommand } from "../src/review/fix-command.js";

describe("parseFixCommand", () => {
  it("parses single ID", () => {
    expect(parseFixCommand("/a11y-fix A11Y-54ed50")).toEqual({
      requested: true,
      findingIds: ["A11Y-54ed50"],
    });
  });

  it("parses multiple IDs", () => {
    expect(parseFixCommand("/a11y-fix F-001 F-002 F-003")).toEqual({
      requested: true,
      findingIds: ["F-001", "F-002", "F-003"],
    });
  });

  it("parses all keyword", () => {
    expect(parseFixCommand("/a11y-fix all")).toEqual({
      requested: true,
      findingIds: ["all"],
    });
  });

  it("returns empty array when no args", () => {
    expect(parseFixCommand("/a11y-fix")).toEqual({
      requested: true,
      findingIds: [],
    });
  });

  it("rejects unrelated comments", () => {
    expect(parseFixCommand("looks good")).toEqual({ requested: false, findingIds: [] });
  });

  it("handles multiple spaces between IDs", () => {
    const result = parseFixCommand("/a11y-fix  F-001   F-002");
    expect(result.findingIds).toEqual(["F-001", "F-002"]);
  });

  it("parses hint from 'all' command", () => {
    expect(parseFixCommand('/a11y-fix all "use sr-only labels"')).toEqual({
      requested: true,
      findingIds: ["all"],
      hint: "use sr-only labels",
    });
  });

  it("parses hint with multiple IDs", () => {
    expect(parseFixCommand('/a11y-fix A11Y-abc123 A11Y-def456 "use sr-only labels"')).toEqual({
      requested: true,
      findingIds: ["A11Y-abc123", "A11Y-def456"],
      hint: "use sr-only labels",
    });
  });

  it("parses hint with single ID", () => {
    expect(parseFixCommand('/a11y-fix A11Y-abc123 "prefer aria-label over title"')).toEqual({
      requested: true,
      findingIds: ["A11Y-abc123"],
      hint: "prefer aria-label over title",
    });
  });

  it("does not set hint when no quotes present", () => {
    expect(parseFixCommand("/a11y-fix all").hint).toBeUndefined();
  });

  it("does not set hint for empty quoted string", () => {
    expect(parseFixCommand('/a11y-fix all ""').hint).toBeUndefined();
  });
});
