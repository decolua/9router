import { log, err } from "../logger";
import type { IncomingMessage, ServerResponse } from "http";

const DEFAULT_LOCAL_ROUTER = "http://localhost:20128";
const ROUTER_BASE = String(process.env.MITM_ROUTER_BASE || DEFAULT_LOCAL_ROUTER)
  .trim()
  .replace(/\/+$/, "") || DEFAULT_LOCAL_ROUTER;
const API_KEY = process.env.ROUTER_API_KEY;

// Headers that must not be forwarded to 8Router
const STRIP_HEADERS = new Set([
  "host", "content-length", "connection", "transfer-encoding",
  "content-type", "authorization"
]);

/**
 * Send body to 8Router at the given path and return the fetch Response object.
 * Optionally forwards client headers (stripped of hop-by-hop / overridden keys).
 */
export async function fetchRouter(openaiBody: any, path: string = "/v1/chat/completions", clientHeaders: Record<string, any> = {}): Promise<Response> {
  const forwarded: Record<string, string> = {};
  for (const [k, v] of Object.entries(clientHeaders)) {
    if (!STRIP_HEADERS.has(k.toLowerCase())) forwarded[k] = String(v);
  }

  // Robust URL joining: 
  // 1. Remove trailing slashes and /v1 from base
  const cleanBase = ROUTER_BASE.replace(/\/+$/, "").replace(/\/v1$/, "");
  // 2. Remove leading slashes and /v1 from path
  const cleanPath = path.replace(/^\/+/, "").replace(/^v1\//, "");
  
  // 3. Join as base + /v1/ + path
  const finalUrl = `${cleanBase}/v1/${cleanPath}`;

  const response = await fetch(finalUrl, {
    method: "POST",
    headers: {
      ...forwarded,
      "Content-Type": "application/json",
      ...(API_KEY && { "Authorization": `Bearer ${API_KEY}` })
    },
    body: JSON.stringify(openaiBody)
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    throw new Error(`[${response.status}]: ${errText}`);
  }

  return response;
}

/**
 * Pipe SSE stream from router directly to client response
 */
export async function pipeSSE(routerRes: Response, res: ServerResponse): Promise<void> {
  const ct = routerRes.headers.get("content-type") || "application/json";
  const resHeaders: Record<string, string> = { "Content-Type": ct, "Cache-Control": "no-cache", "Connection": "keep-alive" };
  if (ct.includes("text/event-stream")) resHeaders["X-Accel-Buffering"] = "no";
  res.writeHead(200, resHeaders);

  if (!routerRes.body) {
    res.end(await routerRes.text().catch(() => ""));
    return;
  }

  const reader = routerRes.body.getReader();
  const decoder = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) { res.end(); break; }
    res.write(decoder.decode(value, { stream: true }));
  }
}
