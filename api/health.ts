import type { IncomingMessage, ServerResponse } from "node:http";

export default async function health(
  _req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  res.statusCode = 200;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify({ ok: true }));
}
