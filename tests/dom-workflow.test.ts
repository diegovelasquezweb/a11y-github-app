import { describe, expect, it } from "vitest";
import { createScanToken } from "../src/review/dom-workflow.js";

describe("createScanToken", () => {
  it("returns string in format {owner}-{repo}-pr{pullNumber}-{timestamp}", () => {
    const token = createScanToken("my-org", "my-repo", 42);
    expect(token).toMatch(/^my-org-my-repo-pr42-\d+$/);
  });

  it("normalizes owner and repo to lowercase and strips non-alphanumeric chars except -", () => {
    const token = createScanToken("My_Org", "My.Repo!", 1);
    expect(token).toMatch(/^myorg-myrepo-pr1-\d+$/);
  });

  it("two calls with same args return different tokens", async () => {
    const token1 = createScanToken("org", "repo", 5);
    await new Promise((r) => setTimeout(r, 2));
    const token2 = createScanToken("org", "repo", 5);
    expect(token1).not.toBe(token2);
  });

  it("pull number is embedded correctly", () => {
    const token = createScanToken("org", "repo", 999);
    expect(token).toContain("-pr999-");
  });
});
