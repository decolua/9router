import { err } from "../logger";
import { fetchRouter, pipeSSE } from "./base";
import type { IncomingMessage, ServerResponse } from "http";

/**
 * Intercept Kiro request — replace model and forward to router
 */
export async function intercept(req: IncomingMessage, res: ServerResponse, bodyBuffer: Buffer, mappedModel: string): Promise<void> {
  try {
    const body = JSON.parse(bodyBuffer.toString());
    body.model = mappedModel;
    const routerRes = await fetchRouter(body, "/v1/chat/completions", req.headers as Record<string, any>);
    await pipeSSE(routerRes, res);
  } catch (error: any) {
    err(`[Kiro] ${error.message}`);
    if (!res.headersSent) res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { message: error.message, type: "mitm_error" } }));
  }
}
