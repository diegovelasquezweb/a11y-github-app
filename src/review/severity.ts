const ORDER: Record<string, number> = {
  critical: 4,
  serious: 3,
  moderate: 2,
  minor: 1,
};

export function normalizeSeverity(input: string): string {
  const lower = input.trim().toLowerCase();
  if (lower in ORDER) {
    return lower[0].toUpperCase() + lower.slice(1);
  }
  return "Moderate";
}

export function rankSeverity(input: string): number {
  return ORDER[normalizeSeverity(input).toLowerCase()] ?? 0;
}

export function shouldRequestChanges(severities: string[]): boolean {
  return severities.some((severity) => rankSeverity(severity) >= ORDER.serious);
}
