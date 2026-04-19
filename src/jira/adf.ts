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
    if (section.kind === "link") {
      return {
        type: "paragraph",
        content: [
          { type: "text", text: `${section.label}: `, marks: [{ type: "strong" }] },
          { type: "text", text: section.text, marks: [{ type: "link", attrs: { href: section.href } }] },
        ],
      };
    }
    if (section.kind === "bulletList") {
      return {
        type: "bulletList",
        content: section.items.map((item) => ({
          type: "listItem",
          content: [{ type: "paragraph", content: [{ type: "text", text: item }] }],
        })),
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
