import type { Request, Response } from "express";
import { processWebhook } from "./process.js";

interface WebhookRequest extends Request {
  rawBody?: Buffer;
}

export async function handleWebhook(req: WebhookRequest, res: Response): Promise<void> {
  if (!req.rawBody) {
    res.status(400).json({ ok: false, error: "Missing raw request body" });
    return;
  }

  const result = await processWebhook({
    rawBody: req.rawBody,
    signature: req.header("x-hub-signature-256") ?? undefined,
    event: req.header("x-github-event") ?? undefined,
    delivery: req.header("x-github-delivery") ?? undefined,
  });

  res.status(result.status).json(result.body);
}
