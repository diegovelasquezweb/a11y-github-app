export interface FixCommand {
  requested: boolean;
  findingIds: string[];
  hint?: string;
}

const FIX_COMMAND_RE = /^\/a11y-fix(?:\s+(.+))?$/i;
const HINT_RE = /"([^"]+)"\s*$/;

export function parseFixCommand(input: string): FixCommand {
  const text = input.trim();
  const match = text.match(FIX_COMMAND_RE);
  if (!match) {
    return { requested: false, findingIds: [] };
  }

  let args = (match[1] ?? "").trim();
  if (!args) {
    return { requested: true, findingIds: [] };
  }

  let hint: string | undefined;
  const hintMatch = args.match(HINT_RE);
  if (hintMatch) {
    hint = hintMatch[1].trim();
    args = args.slice(0, args.lastIndexOf(`"${hintMatch[1]}"`)).trim();
  }

  const findingIds = args ? args.split(/\s+/).filter(Boolean) : [];
  return { requested: true, findingIds, ...(hint ? { hint } : {}) };
}
