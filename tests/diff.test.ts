import { describe, expect, it } from "vitest";
import { getAddedLinesFromPatch } from "../src/review/diff.js";

describe("getAddedLinesFromPatch", () => {
  it("extracts added line numbers from a unified diff", () => {
    const patch = [
      "@@ -1,3 +1,5 @@",
      " line1",
      "+line2",
      " line3",
      "+line4",
    ].join("\n");

    const added = getAddedLinesFromPatch(patch);
    expect([...added]).toEqual([2, 4]);
  });
});
