export interface FixCommand {
  requested: boolean;
  findingId?: string;
}

const FIX_COMMAND_RE = /^\/a11y-fix(?:\s+(\S+))?$/i;

export function parseFixCommand(input: string): FixCommand {
  const text = input.trim();
  const match = text.match(FIX_COMMAND_RE);
  if (!match) {
    return { requested: false };
  }

  const findingId = (match[1] ?? "").trim();
  if (!findingId) {
    return { requested: true };
  }

  return {
    requested: true,
    findingId,
  };
}
