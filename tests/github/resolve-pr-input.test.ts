import { describe, expect, it, vi } from "vitest";
import { resolvePr } from "../../src/github/resolve-pr-input.js";

describe("resolvePr", () => {
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
