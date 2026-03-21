import { describe, expect, it } from "vitest";
import {
  normalizeSeverity,
  rankSeverity,
  shouldRequestChanges,
} from "../src/review/severity.js";

describe("severity helpers", () => {
  it("normalizes severity strings", () => {
    expect(normalizeSeverity("critical")).toBe("Critical");
    expect(normalizeSeverity("SERIOUS")).toBe("Serious");
  });

  it("sorts by expected severity ranking", () => {
    expect(rankSeverity("Critical")).toBeGreaterThan(rankSeverity("Moderate"));
  });

  it("requests changes for serious or critical findings", () => {
    expect(shouldRequestChanges(["Minor", "Moderate"])).toBe(false);
    expect(shouldRequestChanges(["Serious"])).toBe(true);
    expect(shouldRequestChanges(["Critical"])).toBe(true);
  });
});
