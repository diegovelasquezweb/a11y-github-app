import { describe, expect, it } from "vitest";
import { parseFixCommand } from "../src/review/fix-command.js";

describe("parseFixCommand", () => {
  it("parses fix commands", () => {
    expect(parseFixCommand("/a11y-fix A11Y-54ed50")).toEqual({
      requested: true,
      findingId: "A11Y-54ed50",
    });
  });

  it("returns requested without id when missing", () => {
    expect(parseFixCommand("/a11y-fix")).toEqual({
      requested: true,
    });
  });

  it("rejects unrelated comments", () => {
    expect(parseFixCommand("looks good")).toEqual({ requested: false });
  });
});
