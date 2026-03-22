import fs from "node:fs";

const githubOutput = process.env.GITHUB_OUTPUT || "";

function appendOutput(name, value) {
  if (!githubOutput) {
    return;
  }
  fs.appendFileSync(githubOutput, `${name}=${String(value).replace(/\n/g, "%0A")}\n`);
}

appendOutput("status", "unsupported");
appendOutput(
  "reason",
  "Automated fixes are temporarily disabled in the GitHub app until the fix strategy is moved into the engine.",
);
