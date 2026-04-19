import type { AdfSection, JiraAdfDoc, JiraAdfNode } from "./types.js";

export function buildAdf(sections: AdfSection[]): JiraAdfDoc {
  const content: JiraAdfNode[] = sections.map((section) => {
    if (section.kind === "heading") {
      return {
        type: "heading",
        attrs: { level: section.level },
        content: [{ type: "text", text: section.text }],
      };
    }
    const children: JiraAdfNode[] = [];
    if (section.label) {
      children.push({ type: "text", text: `${section.label}: `, marks: [{ type: "strong" }] });
    }
    children.push({ type: "text", text: section.value });
    return { type: "paragraph", content: children };
  });
  return { version: 1, type: "doc", content };
}
