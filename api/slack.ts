import type { IncomingMessage, ServerResponse } from "node:http";
import { verifyAndRoute, executeDeferredWork } from "../src/slack/handler.js";

async function readRawBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    if (typeof chunk === "string") {
      chunks.push(Buffer.from(chunk, "utf8"));
    } else {
      chunks.push(chunk);
    }
  }
  return Buffer.concat(chunks).toString("utf8");
}

function header(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

export default async function slack(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ ok: false, error: "Method not allowed" }));
    return;
  }

  const rawBody = await readRawBody(req);
  const result = await verifyAndRoute({
    rawBody,
    timestamp: header(req, "x-slack-request-timestamp"),
    signature: header(req, "x-slack-signature"),
  });

  // Send 200 immediately — Slack requires response within 3 seconds
  res.statusCode = result.status;
  if (typeof result.body === "string") {
    res.setHeader("content-type", result.contentType ?? "text/plain; charset=utf-8");
    res.end(result.body);
  } else {
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify(result.body));
  }

  // Execute async work AFTER response is sent (views.open, workflow dispatch, etc.)
  // Vercel keeps the function alive until this async handler resolves
  if (result.work) {
    await executeDeferredWork(result.work);
  }
}
