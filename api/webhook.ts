import type { IncomingMessage, ServerResponse } from "node:http";
import { processWebhook } from "../src/webhook/process.js";

async function readRawBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    if (typeof chunk === "string") {
      chunks.push(Buffer.from(chunk, "utf8"));
    } else {
      chunks.push(chunk);
    }
  }
  return Buffer.concat(chunks);
}

function header(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name.toLowerCase()];
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

function json(res: ServerResponse, status: number, body: Record<string, unknown>): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

export default async function webhook(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (req.method !== "POST") {
    json(res, 405, { ok: false, error: "Method not allowed" });
    return;
  }

  const rawBody = await readRawBody(req);
  const result = await processWebhook({
    rawBody,
    signature: header(req, "x-hub-signature-256"),
    event: header(req, "x-github-event"),
    delivery: header(req, "x-github-delivery"),
  });

  json(res, result.status, result.body);
}
