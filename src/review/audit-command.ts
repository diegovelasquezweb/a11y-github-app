export interface AuditCommand {
  requested: boolean;
  targetUrl?: string;
}

const AUDIT_COMMAND_RE = /^\/audit(?:\s+(.+))?$/i;

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

export function parseAuditCommand(input: string): AuditCommand {
  const text = input.trim();
  const match = text.match(AUDIT_COMMAND_RE);
  if (!match) {
    return { requested: false };
  }

  const args = (match[1] ?? "").trim();
  if (!args) {
    return { requested: true };
  }

  const tokens = args.split(/\s+/);
  const urlToken = tokens.find((token) => isHttpUrl(token));

  return {
    requested: true,
    targetUrl: urlToken,
  };
}
