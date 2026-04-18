export interface FixCommand {
  requested: boolean;
  findingIds: string[];
  hint?: string;
  model?: string;
  branch?: string;
}

const FIX_COMMAND_RE = /^\/a11y-fix(?:\s+(.+))?$/i;
const HINT_RE = /"([^"]+)"\s*$/;

const MODEL_ALIASES: Record<string, string> = {
  haiku: "claude-haiku-4-5-20251001",
  sonnet: "claude-sonnet-4-6",
  opus: "claude-opus-4-6",
};

function resolveModel(token: string): string | null {
  const lower = token.toLowerCase();
  if (MODEL_ALIASES[lower]) return MODEL_ALIASES[lower];
  if (/^claude-(haiku|sonnet|opus)/.test(lower)) return lower;
  return null;
}

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

  let model: string | undefined;
  let branch: string | undefined;
  const tokens = args ? args.split(/\s+/).filter(Boolean) : [];
  const remaining: string[] = [];
  for (const token of tokens) {
    if (/^branch:/i.test(token)) {
      branch = token.replace(/^branch:/i, "");
    } else {
      const resolved = resolveModel(token);
      if (resolved && !model) {
        model = resolved;
      } else {
        remaining.push(token);
      }
    }
  }

  return {
    requested: true,
    findingIds: remaining,
    ...(hint ? { hint } : {}),
    ...(model ? { model } : {}),
    ...(branch ? { branch } : {}),
  };
}
