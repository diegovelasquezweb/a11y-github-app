import { buildAdf } from "./adf.js";
import type { AdfSection, JiraAdfDoc, JiraBulkPayload, JiraSinglePayload } from "./types.js";

export function buildSingleFindingBody(p: JiraSinglePayload): JiraAdfDoc {
  const sections: AdfSection[] = [
    { kind: "heading", level: 2, text: "Finding" },
    { kind: "paragraph", label: "ID", value: p.i },
    { kind: "paragraph", label: "Severity", value: p.v },
    { kind: "paragraph", label: "Title", value: p.t },
    { kind: "paragraph", label: "Repo", value: `${p.o}/${p.r}` },
    ...(p.h ? [{ kind: "paragraph" as const, label: "Branch", value: p.h }] : []),
  ];
  return buildAdf(sections);
}

export function buildSingleFindingSummary(p: JiraSinglePayload): string {
  const raw = `[${p.v}] ${p.t}`;
  return raw.length > 255 ? `${raw.slice(0, 252)}...` : raw;
}

export function buildBulkBody(p: JiraBulkPayload): JiraAdfDoc {
  const sections: AdfSection[] = [
    { kind: "heading", level: 2, text: "A11y Audit Summary" },
    { kind: "paragraph", label: "Repo", value: `${p.o}/${p.r}` },
    { kind: "paragraph", label: "Branch", value: p.h },
    { kind: "paragraph", label: "Total findings", value: String(p.count) },
    { kind: "paragraph", label: "Breakdown", value: `Critical: ${p.totals.c}, Serious: ${p.totals.s}, Moderate: ${p.totals.m}, Minor: ${p.totals.mi}` },
  ];
  return buildAdf(sections);
}

export function buildBulkSummary(p: JiraBulkPayload): string {
  return `A11y Audit: ${p.count} findings in ${p.o}/${p.r}`;
}
