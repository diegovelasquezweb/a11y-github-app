import crypto from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { verifySlackSignature } from "../../src/slack/verify.js";

const SECRET = "test-signing-secret";
const BODY = "token=abc&command=%2Fa11y&text=";

function makeSignature(body: string, ts: string, secret: string): string {
  const base = `v0:${ts}:${body}`;
  return `v0=${crypto.createHmac("sha256", secret).update(base).digest("hex")}`;
}

function nowTs(): string {
  return String(Math.floor(Date.now() / 1000));
}

describe("verifySlackSignature", () => {
  it("returns true for a valid signature", () => {
    const ts = nowTs();
    const sig = makeSignature(BODY, ts, SECRET);
    expect(verifySlackSignature(BODY, ts, sig, SECRET)).toBe(true);
  });

  it("returns false for an invalid signature", () => {
    const ts = nowTs();
    const sig = makeSignature(BODY, ts, SECRET);
    expect(verifySlackSignature(BODY, ts, sig, "wrong-secret")).toBe(false);
  });

  it("returns false for expired timestamp (>300s old)", () => {
    const ts = String(Math.floor(Date.now() / 1000) - 400);
    const sig = makeSignature(BODY, ts, SECRET);
    expect(verifySlackSignature(BODY, ts, sig, SECRET)).toBe(false);
  });

  it("returns false for future timestamp (>300s ahead)", () => {
    const ts = String(Math.floor(Date.now() / 1000) + 400);
    const sig = makeSignature(BODY, ts, SECRET);
    expect(verifySlackSignature(BODY, ts, sig, SECRET)).toBe(false);
  });

  it("returns false when timestamp is missing", () => {
    const sig = makeSignature(BODY, nowTs(), SECRET);
    expect(verifySlackSignature(BODY, undefined, sig, SECRET)).toBe(false);
  });

  it("returns false when signature is missing", () => {
    expect(verifySlackSignature(BODY, nowTs(), undefined, SECRET)).toBe(false);
  });

  it("returns false when signature has wrong prefix", () => {
    const ts = nowTs();
    const sig = makeSignature(BODY, ts, SECRET).replace("v0=", "v1=");
    expect(verifySlackSignature(BODY, ts, sig, SECRET)).toBe(false);
  });

  it("returns false for non-numeric timestamp", () => {
    expect(verifySlackSignature(BODY, "not-a-number", "v0=abc", SECRET)).toBe(false);
  });
});
