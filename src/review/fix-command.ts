export interface FixCommand {
  requested: boolean;
  findingIds: string[];
}

const FIX_COMMAND_RE = /^\/a11y-fix(?:\s+(.+))?$/i;

export function parseFixCommand(input: string): FixCommand {
  const text = input.trim();
  const match = text.match(FIX_COMMAND_RE);
  if (!match) {
    return { requested: false, findingIds: [] };
  }

  const args = (match[1] ?? "").trim();
  if (!args) {
    return { requested: true, findingIds: [] };
  }

  const findingIds = args.split(/\s+/).filter(Boolean);
  return { requested: true, findingIds };
}
