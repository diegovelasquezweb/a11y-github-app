import fs from "node:fs";
import path from "node:path";

const findingId = process.env.FINDING_ID || "";
const targetDir = process.env.TARGET_DIR || "";
const findingsPath = process.env.FINDINGS_PATH || "";
const patternFindingsPath = process.env.PATTERN_FINDINGS_PATH || "";
const githubOutput = process.env.GITHUB_OUTPUT || "";

function appendOutput(name, value) {
  if (!githubOutput) {
    return;
  }
  fs.appendFileSync(githubOutput, `${name}=${String(value).replace(/\n/g, "%0A")}\n`);
}

function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function walkFiles(rootDir) {
  const result = [];
  const stack = [rootDir];
  const ignoreDirs = new Set([
    ".git",
    "node_modules",
    "dist",
    "build",
    ".next",
    ".vercel",
    "coverage",
  ]);

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || !fs.existsSync(current)) {
      continue;
    }

    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!ignoreDirs.has(entry.name)) {
          stack.push(absolute);
        }
        continue;
      }

      if (!/\.(html?|tsx?|jsx|vue)$/i.test(entry.name)) {
        continue;
      }

      result.push(absolute);
    }
  }

  return result;
}

function readJson(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return null;
  }

  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function loadFinding() {
  const findingsPayload = readJson(findingsPath);
  const runtimeFindings = [
    ...(Array.isArray(findingsPayload?.ai_enriched_findings) ? findingsPayload.ai_enriched_findings : []),
    ...(Array.isArray(findingsPayload?.findings) ? findingsPayload.findings : []),
  ];
  const runtimeFinding = runtimeFindings.find((item) => String(item?.id || "") === findingId);
  if (runtimeFinding) {
    return {
      kind: "runtime",
      data: runtimeFinding,
    };
  }

  const patternPayload = readJson(patternFindingsPath);
  const patternFinding = Array.isArray(patternPayload?.findings)
    ? patternPayload.findings.find((item) => String(item?.id || "") === findingId)
    : null;

  if (patternFinding) {
    return {
      kind: "pattern",
      data: patternFinding,
    };
  }

  return null;
}

function getRuleId(finding) {
  return String(
    finding.rule_id ||
      finding.ruleId ||
      finding.pattern_id ||
      finding.patternId ||
      "",
  );
}

function getSelector(finding) {
  return String(finding.primary_selector || finding.primarySelector || finding.selector || "");
}

function getRoutePath(finding) {
  const url = String(finding.url || "");
  if (!url) {
    return "/";
  }

  try {
    const parsed = new URL(url);
    return `${parsed.pathname || "/"}${parsed.search || ""}`;
  } catch {
    return "/";
  }
}

function scoreFileForSelector(filePath, content, selector) {
  let score = 0;
  const normalized = selector.trim();

  if (!normalized) {
    return score;
  }

  const idMatch = normalized.match(/#([A-Za-z0-9_-]+)/);
  if (idMatch && new RegExp(`id=["']${idMatch[1]}["']`).test(content)) {
    score += 100;
  }

  const classMatch = normalized.match(/\.([A-Za-z0-9_-]+)/);
  if (classMatch && new RegExp(`class=["'][^"']*\\b${classMatch[1]}\\b`).test(content)) {
    score += 70;
  }

  const tagMatch = normalized.match(/^[a-z][a-z0-9-]*/i);
  if (tagMatch && new RegExp(`<${tagMatch[0]}\\b`, "i").test(content)) {
    score += 20;
  }

  if (/index\.html?$/i.test(filePath)) {
    score += 10;
  }

  return score;
}

function findBestFile(selector, preferredFile = "") {
  if (preferredFile) {
    const absolute = path.join(targetDir, preferredFile);
    if (fs.existsSync(absolute)) {
      return absolute;
    }
  }

  const files = walkFiles(targetDir);
  if (files.length === 0) {
    return null;
  }

  let bestFile = files[0];
  let bestScore = -1;

  for (const file of files) {
    const content = fs.readFileSync(file, "utf8");
    const score = scoreFileForSelector(file, content, selector);
    if (score > bestScore) {
      bestScore = score;
      bestFile = file;
    }
  }

  return bestFile;
}

function replaceTagAttribute(tag, attributeName, attributeValue) {
  if (new RegExp(`\\b${attributeName}=`, "i").test(tag)) {
    return tag;
  }

  return tag.replace(/>$/, ` ${attributeName}="${attributeValue}">`);
}

function applyImageAlt(content, selector) {
  const idMatch = selector.match(/#([A-Za-z0-9_-]+)/);
  if (idMatch) {
    const regex = new RegExp(`<img\\b([^>]*?)id=["']${idMatch[1]}["']([^>]*?)>`, "i");
    if (regex.test(content)) {
      return content.replace(regex, (match) => replaceTagAttribute(match, "alt", "Decorative image"));
    }
  }

  return content.replace(/<img\b(?![^>]*\balt=)([^>]*?)>/i, (match) =>
    replaceTagAttribute(match, "alt", "Decorative image"),
  );
}

function applyAutoplayFix(content, selector) {
  const idMatch = selector.match(/#([A-Za-z0-9_-]+)/);
  if (idMatch) {
    const regex = new RegExp(
      `<(video|audio)\\b([^>]*?)id=["']${idMatch[1]}["']([^>]*?)\\sautoplay(?:=["'][^"']*["'])?([^>]*?)>`,
      "i",
    );
    if (regex.test(content)) {
      return content.replace(regex, (match) =>
        match.replace(/\sautoplay(?:=["'][^"']*["'])?/i, ""),
      );
    }
  }

  return content.replace(
    /<(video|audio)\b([^>]*?)\sautoplay(?:=["'][^"']*["'])?([^>]*?)>/i,
    (match) => match.replace(/\sautoplay(?:=["'][^"']*["'])?/i, ""),
  );
}

function applySkipLinkFix(content) {
  if (!/<main\b/i.test(content)) {
    return content;
  }

  let next = content;

  if (!/href=["']#main-content["']/i.test(next)) {
    next = next.replace(
      /<body([^>]*)>/i,
      `<body$1>\n    <a class="skip-link" href="#main-content">Skip to main content</a>`,
    );
  }

  if (!/<main\b[^>]*\bid=["']main-content["']/i.test(next)) {
    next = next.replace(/<main\b([^>]*)>/i, `<main id="main-content"$1>`);
  }

  return next;
}

function deriveAccessibleName(tag) {
  const placeholder = tag.match(/\bplaceholder=["']([^"']+)["']/i)?.[1];
  if (placeholder) {
    return placeholder.trim();
  }

  const name = tag.match(/\bname=["']([^"']+)["']/i)?.[1];
  if (name) {
    return name
      .replace(/[-_]+/g, " ")
      .replace(/\b\w/g, (char) => char.toUpperCase())
      .trim();
  }

  return "Field";
}

function applyAccessibleNameFix(content, selector) {
  const idMatch = selector.match(/#([A-Za-z0-9_-]+)/);
  if (idMatch) {
    const regex = new RegExp(`<([a-z]+)\\b([^>]*?)id=["']${idMatch[1]}["']([^>]*?)>`, "i");
    if (regex.test(content)) {
      return content.replace(regex, (match) => replaceTagAttribute(match, "aria-label", deriveAccessibleName(match)));
    }
  }

  return content.replace(/<(input|button)\b(?![^>]*\baria-label=)([^>]*?)>/i, (match) =>
    replaceTagAttribute(match, "aria-label", deriveAccessibleName(match)),
  );
}

function applyDuplicateIdFix(content, selector) {
  const idMatch = selector.match(/#([A-Za-z0-9_-]+)/);
  const targetId = idMatch?.[1];
  if (!targetId) {
    return content;
  }

  let count = 0;
  return content.replace(new RegExp(`id=["']${targetId}["']`, "g"), () => {
    count += 1;
    if (count === 1) {
      return `id="${targetId}"`;
    }
    return `id="${targetId}-${count}"`;
  });
}

function applyPlaceholderOnlyLabelFix(content) {
  return content.replace(
    /<input\b(?![^>]*\baria-label=)([^>]*?)\bplaceholder=["']([^"']+)["']([^>]*?)>/i,
    (match, before, placeholder, after) =>
      `<input${before} placeholder="${placeholder}"${after} aria-label="${placeholder.trim()}">`,
  );
}

function applyFix(finding) {
  const ruleId = getRuleId(finding.data);
  const selector = getSelector(finding.data);
  const preferredFile = finding.kind === "pattern" ? String(finding.data.file || "") : "";
  const filePath = findBestFile(selector, preferredFile);
  if (!filePath) {
    return { status: "unsupported", reason: "No editable source file could be located for this finding." };
  }

  const original = fs.readFileSync(filePath, "utf8");
  let updated = original;

  if (finding.kind === "pattern" && ruleId === "placeholder-only-label") {
    updated = applyPlaceholderOnlyLabelFix(original);
  } else if (ruleId === "image-alt") {
    updated = applyImageAlt(original, selector);
  } else if (ruleId === "cdp-autoplay-media") {
    updated = applyAutoplayFix(original, selector);
  } else if (ruleId === "cdp-missing-skip-link") {
    updated = applySkipLinkFix(original);
  } else if (ruleId === "duplicate-id") {
    updated = applyDuplicateIdFix(original, selector);
  } else if (
    ruleId === "aria-input-field-name" ||
    ruleId === "label" ||
    ruleId === "button-name" ||
    ruleId === "input-button-name"
  ) {
    updated = applyAccessibleNameFix(original, selector);
  } else {
    return {
      status: "unsupported",
      reason: `Automatic fixes are not implemented yet for rule \`${ruleId}\`.`,
    };
  }

  if (updated === original) {
    return {
      status: "unsupported",
      reason: "The fixer located the source file but could not apply a safe patch.",
    };
  }

  fs.writeFileSync(filePath, updated, "utf8");

  return {
    status: "patched",
    filePath,
    ruleId,
    routePath: getRoutePath(finding.data),
    title: String(finding.data.title || finding.data.help || ruleId),
  };
}

if (!findingId || !targetDir || !findingsPath) {
  appendOutput("status", "error");
  appendOutput("reason", "Missing required fixer inputs.");
  process.exit(1);
}

const finding = loadFinding();
if (!finding) {
  appendOutput("status", "not_found");
  appendOutput("reason", `Finding ${findingId} was not found in the latest audit artifacts.`);
  process.exit(0);
}

const result = applyFix(finding);
appendOutput("status", result.status);
appendOutput("reason", result.reason || "");
appendOutput("patched_file", result.filePath ? path.relative(targetDir, result.filePath) : "");
appendOutput("verify_rule", result.ruleId || "");
appendOutput("verify_route", result.routePath || "/");
appendOutput("finding_title", result.title || "");
appendOutput("branch_slug", slugify(findingId));
