// Fetch helper for the Cloudflare worker (`WORKER_URL`).
// Global fetch rejects self-signed certificates, which breaks tunnelling when
// the worker is fronted by a Cloudflare Access proxy or another TLS origin
// whose chain includes a self-signed cert (the only error the manager used to
// surface was the generic "fetch failed"). With TUNNEL_WORKER_INSECURE=1 we
// fall back to https.request with verification disabled — opt-in only, scoped
// to the worker host. Default behaviour is unchanged.

import https from "node:https";
import { URL } from "node:url";
import { WORKER_URL, INSECURE_WORKER } from "./config.js";

const HOST = (() => {
  try { return new URL(WORKER_URL).hostname; }
  catch { return null; }
})();

const insecureAgent = INSECURE_WORKER && HOST
  ? new https.Agent({ rejectUnauthorized: false })
  : null;

function explain(err) {
  if (!err) return "";
  const cause = err.cause || err;
  return cause.code ? ` (cause: ${cause.code})` : "";
}

async function workerFetch(url, init = {}) {
  if (!INSECURE_WORKER) {
    try {
      return await fetch(url, init);
    } catch (e) {
      throw new Error(`${e.message}${explain(e)}`);
    }
  }

  // Insecure path: parse + dispatch via https.request with a permissive agent.
  // Only the WORKER_URL host is allowed to bypass verification.
  let parsed;
  try { parsed = new URL(url); }
  catch (e) { throw new Error(`invalid url: ${url}`); }

  if (!HOST || parsed.hostname !== HOST) {
    throw new Error(`TUNNEL_WORKER_INSECURE only applies to ${HOST || WORKER_URL}`);
  }

  const method = (init.method || "GET").toUpperCase();
  const headers = { ...(init.headers || {}) };
  const body = init.body == null ? undefined
    : (typeof init.body === "string" || Buffer.isBuffer(init.body) ? init.body
       : JSON.stringify(init.body));
  if (body && !headers["Content-Length"]) headers["Content-Length"] = Buffer.byteLength(body);

  const timeoutMs = init.timeoutMs ?? 10000;
  const signal = init.signal;

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: parsed.hostname,
      port: parsed.port || 443,
      path: parsed.pathname + parsed.search,
      method,
      headers,
      agent: insecureAgent,
    }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const buf = Buffer.concat(chunks);
        const response = new Response(buf, {
          status: res.statusCode || 0,
          statusText: res.statusMessage || "",
          headers: res.headers,
        });
        resolve(response);
      });
    });
    req.on("error", (e) => reject(new Error(`${e.message}${explain(e)}`)));
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`request timeout after ${timeoutMs}ms`)));
    if (signal) {
      if (signal.aborted) req.destroy(new Error("aborted"));
      else signal.addEventListener("abort", () => req.destroy(new Error("aborted")), { once: true });
    }
    if (body) req.write(body);
    req.end();
  });
}

export { workerFetch };