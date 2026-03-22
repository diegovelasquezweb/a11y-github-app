const URL_RE = /https?:\/\/[^\s)\]"']+/gi;

function normalizeUrl(value: string): string {
  return value.replace(/[),.;]+$/, "").trim();
}

function isLikelyPreviewUrl(value: string): boolean {
  return /vercel\.app|netlify\.app|github\.io|pages\.dev|onrender\.com/i.test(value);
}

function extractUrls(text: string): string[] {
  const matches = text.match(URL_RE);
  if (!matches) {
    return [];
  }
  return matches.map(normalizeUrl);
}

export interface ResolvePreviewUrlInput {
  pullRequestBody?: string | null;
  fallbackUrl?: string;
}

export function resolvePreviewUrl(input: ResolvePreviewUrlInput): string | null {
  const body = input.pullRequestBody ?? "";
  const urls = extractUrls(body);

  const preferred = urls.find(isLikelyPreviewUrl);
  if (preferred) {
    return preferred;
  }

  if (urls.length > 0) {
    return urls[0];
  }

  const fallback = input.fallbackUrl?.trim();
  return fallback ? fallback : null;
}
