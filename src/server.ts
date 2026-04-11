import express, { type Application } from "express";
import { handleWebhook } from "./webhook/handler.js";
import { processDomAuditCallback } from "./webhook/dom-callback.js";

interface RawBodyRequest extends express.Request {
  rawBody?: Buffer;
}

export function createServer(): Application {
  const app = express();

  app.use(
    express.json({
      verify: (req, _res, buffer) => {
        (req as RawBodyRequest).rawBody = Buffer.from(buffer);
      },
    }),
  );

  app.get("/health", (_req, res) => {
    res.status(200).json({ ok: true });
  });

  app.post("/webhook", async (req, res) => {
    await handleWebhook(req as RawBodyRequest, res);
  });

  app.post("/scan-callback", async (req, res) => {
    const result = await processDomAuditCallback({
      token: req.header("x-callback-token") ?? undefined,
      payload: (req.body ?? {}) as Record<string, unknown>,
    });
    res.status(result.status).json(result.body);
  });

  return app;
}

export default createServer();
