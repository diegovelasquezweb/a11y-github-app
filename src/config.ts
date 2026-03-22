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
  domAuditEnabled: process.env.DOM_AUDIT_ENABLED === "true",
  domAuditFallbackUrl: process.env.DOM_AUDIT_FALLBACK_URL?.trim() || "",
  appBaseUrl: process.env.APP_BASE_URL?.trim() || "",
  domAuditCallbackToken: process.env.DOM_AUDIT_CALLBACK_TOKEN?.trim() || "",
  scanRunnerOwner: process.env.SCAN_RUNNER_OWNER?.trim() || "",
  scanRunnerRepo: process.env.SCAN_RUNNER_REPO?.trim() || "",
  scanRunnerWorkflow: process.env.SCAN_RUNNER_WORKFLOW?.trim() || "dom-audit.yml",
  scanRunnerRef: process.env.SCAN_RUNNER_REF?.trim() || "master",
  domAuditEngines: process.env.DOM_AUDIT_ENGINES?.trim() || "axe,cdp,pa11y",
  domAuditMaxRoutes: Number(process.env.DOM_AUDIT_MAX_ROUTES ?? 1),
  domAuditCrawlDepth: Number(process.env.DOM_AUDIT_CRAWL_DEPTH ?? 1),
  domAuditWaitUntil: process.env.DOM_AUDIT_WAIT_UNTIL?.trim() || "domcontentloaded",
  domAuditTimeoutMs: Number(process.env.DOM_AUDIT_TIMEOUT_MS ?? 45000),
};
