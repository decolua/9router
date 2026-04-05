const { log, err } = require("../logger");

const DEFAULT_LOCAL_ROUTER = "http://localhost:20128";
const ROUTER_BASE = String(process.env.MITM_ROUTER_BASE || DEFAULT_LOCAL_ROUTER)
  .trim()
  .replace(/\/+$/, "") || DEFAULT_LOCAL_ROUTER;
const API_KEY = process.env.ROUTER_API_KEY;

/**
 * Send body to 9Router at the given path and return the fetch Response object
 */
async function fetchRouter(openaiBody, path = "/v1/chat/completions") {
  const response = await fetch(`${ROUTER_BASE}${path}`, {
    method: "POST",
    headers: {
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
async function pipeSSE(routerRes, res) {
  const ct = routerRes.headers.get("content-type") || "application/json";
  const resHeaders = { "Content-Type": ct, "Cache-Control": "no-cache", "Connection": "keep-alive" };
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

module.exports = { fetchRouter, pipeSSE };
