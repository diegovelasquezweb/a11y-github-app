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
};
