const ORDER: Record<string, number> = {
  critical: 4,
  serious: 3,
  moderate: 2,
  minor: 1,
};

export const SEVERITY_LEVELS = ["Critical", "Serious", "Moderate", "Minor"] as const;

export type Severity = (typeof SEVERITY_LEVELS)[number] | "Unknown";

/**
 * Canonicalizes an arbitrary severity string. Unmappable input stays honest as
 * "Unknown" — it is never silently reclassified. Matches the engine, which emits
 * "Unknown" for missing severity and sorts it last.
 */
export function normalizeSeverity(input: string): Severity {
  const lower = input.trim().toLowerCase();
  if (lower in ORDER) {
    return (lower[0].toUpperCase() + lower.slice(1)) as Severity;
  }
  return "Unknown";
}

const EMOJI: Record<Severity, string> = {
  Critical: "🔴",
  Serious: "🟠",
  Moderate: "🟡",
  Minor: "🔵",
  Unknown: "⚪",
};

const SLACK: Record<Severity, string> = {
  Critical: ":red_circle:",
  Serious: ":large_orange_circle:",
  Moderate: ":large_yellow_circle:",
  Minor: ":large_blue_circle:",
  Unknown: ":white_circle:",
};

/** Maps a severity to its display glyph for the given surface. */
export function severityIcon(severity: string, style: "emoji" | "slack" = "emoji"): string {
  return (style === "slack" ? SLACK : EMOJI)[normalizeSeverity(severity)];
}

/** Buckets items by canonical severity. Unknown is tracked so counts always reconcile. */
export function countBySeverity<T>(
  items: T[],
  getSeverity: (item: T) => string,
): Record<Severity, number> {
  const counts: Record<Severity, number> = {
    Critical: 0,
    Serious: 0,
    Moderate: 0,
    Minor: 0,
    Unknown: 0,
  };
  for (const item of items) {
    counts[normalizeSeverity(getSeverity(item))]++;
  }
  return counts;
}
