import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyWebhookSignature } from "../src/webhook/verify-signature.js";

describe("verifyWebhookSignature", () => {
  it("returns true for valid signatures", () => {
    const secret = "top-secret";
    const body = Buffer.from('{"hello":"world"}', "utf8");
    const digest = crypto.createHmac("sha256", secret).update(body).digest("hex");

    expect(verifyWebhookSignature(body, `sha256=${digest}`, secret)).toBe(true);
  });

  it("returns false for invalid signatures", () => {
    const secret = "top-secret";
    const body = Buffer.from('{"hello":"world"}', "utf8");

    expect(verifyWebhookSignature(body, "sha256=deadbeef", secret)).toBe(false);
  });
});
