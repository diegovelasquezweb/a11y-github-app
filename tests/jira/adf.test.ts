import { describe, expect, it } from "vitest";
import { buildAdf } from "../../src/jira/adf.js";
import type { AdfSection } from "../../src/jira/types.js";

describe("buildAdf", () => {
  it("returns a valid doc with empty content for empty sections array", () => {
    const doc = buildAdf([]);
    expect(doc.version).toBe(1);
    expect(doc.type).toBe("doc");
    expect(doc.content).toEqual([]);
  });

  it("produces heading node with correct shape", () => {
    const sections: AdfSection[] = [{ kind: "heading", level: 2, text: "Finding" }];
    const doc = buildAdf(sections);
    expect(doc.content).toHaveLength(1);
    const node = doc.content[0];
    expect(node.type).toBe("heading");
    expect(node.attrs).toEqual({ level: 2 });
    expect(node.content).toEqual([{ type: "text", text: "Finding" }]);
  });

  it("produces paragraph with label using strong mark", () => {
    const sections: AdfSection[] = [{ kind: "paragraph", label: "ID", value: "A11Y-001" }];
    const doc = buildAdf(sections);
    const node = doc.content[0];
    expect(node.type).toBe("paragraph");
    expect(node.content).toHaveLength(2);
    const labelNode = node.content![0];
    expect(labelNode.type).toBe("text");
    expect(labelNode.text).toBe("ID: ");
    expect(labelNode.marks).toEqual([{ type: "strong" }]);
    const valueNode = node.content![1];
    expect(valueNode.type).toBe("text");
    expect(valueNode.text).toBe("A11Y-001");
    expect(valueNode.marks).toBeUndefined();
  });

  it("produces paragraph without label — single text child", () => {
    const sections: AdfSection[] = [{ kind: "paragraph", value: "plain text" }];
    const doc = buildAdf(sections);
    const node = doc.content[0];
    expect(node.type).toBe("paragraph");
    expect(node.content).toHaveLength(1);
    expect(node.content![0]).toEqual({ type: "text", text: "plain text" });
  });

  it("preserves order of multiple sections", () => {
    const sections: AdfSection[] = [
      { kind: "heading", level: 1, text: "First" },
      { kind: "paragraph", label: "Label", value: "Value" },
      { kind: "heading", level: 3, text: "Third" },
    ];
    const doc = buildAdf(sections);
    expect(doc.content).toHaveLength(3);
    expect(doc.content[0].type).toBe("heading");
    expect(doc.content[0].attrs?.level).toBe(1);
    expect(doc.content[1].type).toBe("paragraph");
    expect(doc.content[2].type).toBe("heading");
    expect(doc.content[2].attrs?.level).toBe(3);
  });
});
