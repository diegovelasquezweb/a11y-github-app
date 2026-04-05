import type { AuditMode } from "../types.js";

export interface AuditCommand {
  auditMode: AuditMode;
  targetUrl?: string;
}

const AUDIT_DOM_RE = /^\/a11y-audit-dom$/i;
const AUDIT_SOURCE_RE = /^\/a11y-audit-source$/i;
const AUDIT_UNIFIED_RE = /^\/a11y-audit(?:\s+(.+))?$/i;

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

export function parseAuditCommand(input: string): AuditCommand | null {
  const text = input.trim();

  if (AUDIT_DOM_RE.test(text)) {
    return { auditMode: "dom" };
  }

  if (AUDIT_SOURCE_RE.test(text)) {
    return { auditMode: "source" };
  }

  const match = text.match(AUDIT_UNIFIED_RE);
  if (!match) {
    return null;
  }

  const args = (match[1] ?? "").trim();
  if (!args) {
    return { auditMode: "unified" };
  }

  const tokens = args.split(/\s+/);
  const urlToken = tokens.find((token) => isHttpUrl(token));

  return { auditMode: "unified", targetUrl: urlToken };
}
