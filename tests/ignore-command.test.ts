import { describe, expect, it } from "vitest";
import { parseIgnoreCommand } from "../src/review/ignore-command.js";

describe("parseIgnoreCommand", () => {
  it("parses ignore commands", () => {
    expect(parseIgnoreCommand("/a11y-ignore finding-123")).toEqual({
      requested: true,
      action: "ignore",
      findingId: "finding-123",
    });
  });

  it("parses unignore commands", () => {
    expect(parseIgnoreCommand("/a11y-unignore finding-123")).toEqual({
      requested: true,
      action: "unignore",
      findingId: "finding-123",
    });
  });

  it("rejects unrelated comments", () => {
    expect(parseIgnoreCommand("looks good")).toEqual({ requested: false });
  });
});
