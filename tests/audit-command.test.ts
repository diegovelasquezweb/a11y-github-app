import { describe, expect, it } from "vitest";

import { parseAuditCommand } from "../src/review/audit-command.js";

describe("parseAuditCommand", () => {
  it("returns unified for /a11y-audit", () => {
    expect(parseAuditCommand("/a11y-audit")).toEqual({ auditMode: "unified" });
  });

  it("returns dom for /a11y-audit-dom", () => {
    expect(parseAuditCommand("/a11y-audit-dom")).toEqual({ auditMode: "dom" });
  });

  it("returns source for /a11y-audit-source", () => {
    expect(parseAuditCommand("/a11y-audit-source")).toEqual({ auditMode: "source" });
  });

  it("/a11y-audit-dom does not match as unified", () => {
    const result = parseAuditCommand("/a11y-audit-dom");
    expect(result?.auditMode).not.toBe("unified");
  });

  it("/a11y-audit-source does not match as unified", () => {
    const result = parseAuditCommand("/a11y-audit-source");
    expect(result?.auditMode).not.toBe("unified");
  });

  it("returns null for random text", () => {
    expect(parseAuditCommand("hello world")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseAuditCommand("")).toBeNull();
  });

  it("returns null for /a11y-audit-domain (edge case)", () => {
    expect(parseAuditCommand("/a11y-audit-domain")).toBeNull();
  });

  it("is case insensitive for /A11Y-AUDIT", () => {
    expect(parseAuditCommand("/A11Y-AUDIT")).toEqual({ auditMode: "unified" });
  });

  it("parses targetUrl from /a11y-audit with URL argument", () => {
    expect(parseAuditCommand("/a11y-audit http://localhost:4173")).toEqual({
      auditMode: "unified",
      targetUrl: "http://localhost:4173",
    });
  });
});
