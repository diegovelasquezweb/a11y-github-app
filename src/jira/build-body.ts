import { buildAdf } from "./adf.js";
import type { AdfSection, BulkFinding, JiraAdfDoc, JiraBulkPayload, JiraSinglePayload } from "./types.js";

export function buildSingleFindingBody(p: JiraSinglePayload): JiraAdfDoc {
  const sections: AdfSection[] = [
    ...(p.rf ? [{ kind: "paragraph" as const, label: "How to fix", value: p.rf }] : []),
    ...(p.wcag ? [{ kind: "paragraph" as const, label: "WCAG", value: p.wcag }] : []),
    ...(p.pg ? [{ kind: "paragraph" as const, label: "Page", value: `/${p.pg}` }] : []),
    ...(p.sel ? [{ kind: "paragraph" as const, label: "Selector", value: p.sel }] : []),
    ...(p.file ? [{ kind: "paragraph" as const, label: "File", value: p.ln ? `${p.file}:${p.ln}` : p.file }] : []),
    { kind: "link", label: "Repo", text: `${p.o}/${p.r}`, href: `https://github.com/${p.o}/${p.r}` },
  ];
  return buildAdf(sections);
}

export function buildSingleFindingSummary(p: JiraSinglePayload): string {
  return p.t.length > 255 ? `${p.t.slice(0, 252)}...` : p.t;
}

function formatBulkFindingLine(f: BulkFinding): string {
  const parts: string[] = [f.t];
  if (f.pg) parts.push(`Page: /${f.pg}`);
  if (f.sel) parts.push(`Selector: ${f.sel}`);
  return parts.join(" · ");
}

export function buildBulkBody(p: JiraBulkPayload): JiraAdfDoc {
  const sections: AdfSection[] = [
    { kind: "heading", level: 2, text: "A11y Audit Summary" },
    { kind: "paragraph", label: "Repo", value: `${p.o}/${p.r}` },
    { kind: "paragraph", label: "Branch", value: p.h },
    { kind: "paragraph", label: "Total findings", value: String(p.count) },
    { kind: "paragraph", label: "Breakdown", value: `Critical: ${p.totals.c}, Serious: ${p.totals.s}, Moderate: ${p.totals.m}, Minor: ${p.totals.mi}` },
  ];
  if (p.f && p.f.length > 0) {
    sections.push({ kind: "heading", level: 3, text: `Findings (${p.f.length}${p.f.length < p.count ? ` of ${p.count}` : ""})` });
    sections.push({ kind: "bulletList", items: p.f.map(formatBulkFindingLine) });
  }
  return buildAdf(sections);
}

export function buildBulkSummary(p: JiraBulkPayload): string {
  return `A11y Audit: ${p.count} findings in ${p.o}/${p.r}`;
}
