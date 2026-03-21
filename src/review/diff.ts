const HUNK_RE = /^@@\s+-\d+(?:,\d+)?\s+\+(\d+)(?:,(\d+))?\s+@@/;

export function getAddedLinesFromPatch(patch: string): Set<number> {
  const lines = patch.split("\n");
  const added = new Set<number>();

  let rightLine = 0;
  let insideHunk = false;

  for (const line of lines) {
    const hunkMatch = line.match(HUNK_RE);
    if (hunkMatch) {
      rightLine = Number(hunkMatch[1]);
      insideHunk = true;
      continue;
    }

    if (!insideHunk) {
      continue;
    }

    if (line.startsWith("+") && !line.startsWith("+++")) {
      added.add(rightLine);
      rightLine += 1;
      continue;
    }

    if (line.startsWith("-") && !line.startsWith("---")) {
      continue;
    }

    rightLine += 1;
  }

  return added;
}
