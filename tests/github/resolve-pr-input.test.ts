import { describe, expect, it, vi } from "vitest";
import { parsePrInput, resolvePr } from "../../src/github/resolve-pr-input.js";

describe("parsePrInput", () => {
  it("bare number returns pr", () => {
    expect(parsePrInput("123", "acme", "foo")).toEqual({ kind: "pr", pullNumber: 123 });
  });

  it("hash-prefixed number returns pr", () => {
    expect(parsePrInput("#42", "acme", "foo")).toEqual({ kind: "pr", pullNumber: 42 });
  });

  it("PR URL matching repo returns pr", () => {
    expect(parsePrInput("https://github.com/acme/foo/pull/7", "acme", "foo")).toEqual({
      kind: "pr",
      pullNumber: 7,
    });
  });

  it("PR URL with query string still matches", () => {
    expect(parsePrInput("https://github.com/acme/foo/pull/7?diff=split", "acme", "foo")).toEqual({
      kind: "pr",
      pullNumber: 7,
    });
  });

  it("PR URL with anchor still matches", () => {
    expect(parsePrInput("https://github.com/acme/foo/pull/7/files#L10", "acme", "foo")).toEqual({
      kind: "pr",
      pullNumber: 7,
    });
  });

  it("PR URL from different repo returns url_repo_mismatch", () => {
    expect(parsePrInput("https://github.com/other/bar/pull/9", "acme", "foo")).toEqual({
      kind: "error",
      reason: "url_repo_mismatch",
    });
  });

  it("branch with digits is not a PR", () => {
    expect(parsePrInput("release-2024-11", "acme", "foo")).toEqual({
      kind: "branch",
      value: "release-2024-11",
    });
  });

  it("plain branch name returns branch", () => {
    expect(parsePrInput("feat/login", "acme", "foo")).toEqual({
      kind: "branch",
      value: "feat/login",
    });
  });

  it("empty string returns branch with empty value", () => {
    expect(parsePrInput("", "acme", "foo")).toEqual({ kind: "branch", value: "" });
  });

  it("whitespace-only input trims and returns branch with empty value", () => {
    expect(parsePrInput("   ", "acme", "foo")).toEqual({ kind: "branch", value: "" });
  });

  it("garbage string returns branch", () => {
    expect(parsePrInput("abc-xyz-123", "acme", "foo")).toEqual({
      kind: "branch",
      value: "abc-xyz-123",
    });
  });

  it("trims surrounding whitespace before matching", () => {
    expect(parsePrInput("  #5  ", "acme", "foo")).toEqual({ kind: "pr", pullNumber: 5 });
  });
});

describe("resolvePr", () => {
  function makeOctokit(result: unknown): { rest: { pulls: { get: ReturnType<typeof vi.fn> } } } {
    return {
      rest: {
        pulls: { get: vi.fn().mockImplementation(result instanceof Error ? () => { throw result; } : vi.fn().mockResolvedValue(result)) },
      },
    };
  }

  it("returns resolved head/base/number on success", async () => {
    const mock = {
      rest: {
        pulls: {
          get: vi.fn().mockResolvedValue({
            data: {
              number: 42,
              head: { sha: "abc123", ref: "feat/login" },
              base: { ref: "main" },
            },
          }),
        },
      },
    };
    const result = await resolvePr(mock as never, "acme", "foo", 42);
    expect(result).toEqual({
      headSha: "abc123",
      headRef: "feat/login",
      baseRef: "main",
      pullNumber: 42,
    });
    expect(mock.rest.pulls.get).toHaveBeenCalledWith({ owner: "acme", repo: "foo", pull_number: 42 });
  });

  it("propagates 404 errors", async () => {
    const err = Object.assign(new Error("Not Found"), { status: 404 });
    const mock = { rest: { pulls: { get: vi.fn().mockRejectedValue(err) } } };
    await expect(resolvePr(mock as never, "acme", "foo", 999)).rejects.toMatchObject({ status: 404 });
  });

  it("propagates generic errors", async () => {
    const mock = { rest: { pulls: { get: vi.fn().mockRejectedValue(new Error("boom")) } } };
    await expect(resolvePr(mock as never, "acme", "foo", 1)).rejects.toThrow("boom");
  });
});
