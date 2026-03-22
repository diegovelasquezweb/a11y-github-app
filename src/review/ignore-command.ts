export type IgnoreCommandAction = "ignore" | "unignore";

export interface IgnoreCommand {
  requested: boolean;
  action?: IgnoreCommandAction;
  findingId?: string;
}

const IGNORE_COMMAND_RE = /^\/a11y-(ignore|unignore)(?:\s+(\S+))?$/i;

export function parseIgnoreCommand(input: string): IgnoreCommand {
  const text = input.trim();
  const match = text.match(IGNORE_COMMAND_RE);
  if (!match) {
    return { requested: false };
  }

  const action = match[1].toLowerCase() as IgnoreCommandAction;
  const findingId = (match[2] ?? "").trim();

  if (!findingId) {
    return { requested: true, action };
  }

  return {
    requested: true,
    action,
    findingId,
  };
}
