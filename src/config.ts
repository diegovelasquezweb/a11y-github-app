const required = [
  "GITHUB_APP_ID",
  "GITHUB_APP_PRIVATE_KEY",
  "GITHUB_WEBHOOK_SECRET",
] as const;

function readRequired(name: (typeof required)[number]): string {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function normalizePrivateKey(value: string): string {
  return value.replace(/\\n/g, "\n");
}

export const CONFIG = {
  appId: readRequired("GITHUB_APP_ID"),
  privateKey: normalizePrivateKey(readRequired("GITHUB_APP_PRIVATE_KEY")),
  webhookSecret: readRequired("GITHUB_WEBHOOK_SECRET"),
  port: Number(process.env.PORT ?? 8787),
  maxInlineComments: Number(process.env.MAX_INLINE_COMMENTS ?? 30),
  sourcePatternsEnabled: process.env.SOURCE_PATTERNS_ENABLED !== "false",
  domAuditEnabled: process.env.DOM_AUDIT_ENABLED === "true",
  appBaseUrl: process.env.APP_BASE_URL?.trim() || "",
  domAuditCallbackToken: process.env.DOM_AUDIT_CALLBACK_TOKEN?.trim() || "",
  scanRunnerOwner: process.env.SCAN_RUNNER_OWNER?.trim() || "",
  scanRunnerRepo: process.env.SCAN_RUNNER_REPO?.trim() || "",
  scanRunnerWorkflow: process.env.SCAN_RUNNER_WORKFLOW?.trim() || "dom-audit.yml",
  scanFixWorkflow: process.env.SCAN_FIX_WORKFLOW?.trim() || "a11y-fix.yml",
  scanSourceWorkflow: process.env.SCAN_SOURCE_WORKFLOW?.trim() || "source-audit.yml",
  scanRunnerRef: process.env.SCAN_RUNNER_REF?.trim() || "master",
};
