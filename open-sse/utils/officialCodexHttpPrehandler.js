/**
 * Node HTTP pre-handler: unified Codex official passthrough.
 *
 * Intercepts gateway API paths before Next. For Codex clients whose model
 * (if present) matches modelPatterns, reverse-proxies to
 * https://chatgpt.com/backend-api/codex/<rest> (+ query string).
 *
 * Non-Codex, or Codex with a non-matching model, reinjects the buffered body
 * (if any) and returns false so Next continues.
 */

import { Readable } from "node:stream";
import { decodeBody, primaryContentEncoding } from "./bodyEncoding.js";
import {
  shouldOfficialPassthrough,
  handleOfficialPassthrough,
  normalizeRequestPath,
} from "./officialPassthrough.js";
import { isCodexClient, normalizeHeaders } from "./clientDetector.js";

/**
 * Paths eligible for official Codex passthrough at the HTTP layer.
 * Includes /v1/* and Next rewrite aliases (/responses, /codex/*).
 * @param {string} urlPathWithQuery
 * @returns {boolean}
 */
export function isOfficialPassthroughRequestPath(urlPathWithQuery) {
  const pathOnly = String(urlPathWithQuery || "").split("?")[0] || "";
  const p = normalizeRequestPath(pathOnly);
  if (p === "/v1" || p.startsWith("/v1/")) return true;
  if (p === "/responses" || p.startsWith("/responses/")) return true;
  if (p === "/codex" || p.startsWith("/codex/")) return true;
  return false;
}

/**
 * @param {import("node:http").IncomingMessage} req
 * @returns {Promise<Buffer>}
 */
export function readIncomingBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

/**
 * Re-inject buffered bytes so Next can still read the request body after we
 * consumed it for the model gate.
 * @param {import("node:http").IncomingMessage} req
 * @param {Buffer} buf
 */
export function reinjectIncomingBody(req, buf) {
  const body = Buffer.isBuffer(buf) ? buf : Buffer.from(buf || []);
  req.headers["content-length"] = String(body.length);
  delete req.headers["transfer-encoding"];

  const stream = Readable.from(body.length ? [body] : []);

  if (typeof stream[Symbol.asyncIterator] === "function") {
    req[Symbol.asyncIterator] = stream[Symbol.asyncIterator].bind(stream);
  }

  const origOn = req.on.bind(req);
  const origOnce = req.once.bind(req);
  let scheduled = false;
  const scheduleEmit = () => {
    if (scheduled) return;
    scheduled = true;
    process.nextTick(() => {
      try {
        if (body.length) req.emit("data", body);
        req.emit("end");
      } catch {
        // ignore
      }
    });
  };

  req.on = (event, listener) => {
    const ret = origOn(event, listener);
    if (event === "data" || event === "end" || event === "readable") scheduleEmit();
    return ret;
  };
  req.once = (event, listener) => {
    const ret = origOnce(event, listener);
    if (event === "data" || event === "end" || event === "readable") scheduleEmit();
    return ret;
  };

  process.nextTick(() => {
    if (scheduled) return;
    try {
      if (typeof req.push === "function") {
        if (body.length) req.push(body);
        req.push(null);
        scheduled = true;
      }
    } catch {
      // ignore
    }
  });
}

/**
 * Parse model (and light JSON body) from wire bytes for the gate.
 * Non-JSON (multipart edits, empty GET) → body {} so "no model" → passthrough.
 *
 * @param {Buffer} rawBody
 * @param {Record<string, string>} headers lowercased
 * @returns {{ body: object, contentEncoding: string|null }}
 */
export function peekBodyForGate(rawBody, headers) {
  const primary = primaryContentEncoding(headers["content-encoding"]);

  if (!rawBody || rawBody.length === 0) {
    return { body: {}, contentEncoding: primary };
  }

  const ct = (headers["content-type"] || "").toLowerCase();
  // Multipart image edits: do not force JSON parse; no model → passthrough
  if (ct.includes("multipart/")) {
    return { body: {}, contentEncoding: primary };
  }

  let decoded = rawBody;
  try {
    if (primary) decoded = decodeBody(rawBody, primary);
  } catch {
    return { body: {}, contentEncoding: primary };
  }

  try {
    const text = decoded.toString("utf8").trim();
    if (!text.startsWith("{") && !text.startsWith("[")) {
      return { body: {}, contentEncoding: primary };
    }
    const parsed = JSON.parse(text);
    return {
      body: parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {},
      contentEncoding: primary,
    };
  } catch {
    return { body: {}, contentEncoding: primary };
  }
}

/**
 * Write a Fetch Response onto a Node ServerResponse.
 * @param {import("node:http").ServerResponse} res
 * @param {Response} response
 */
export async function writeFetchResponseToNode(res, response) {
  const headers = {};
  response.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (lower === "transfer-encoding") return;
    headers[key] = value;
  });
  res.writeHead(response.status || 200, headers);

  if (!response.body) {
    res.end();
    return;
  }

  const reader = response.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value && value.length) {
        const ok = res.write(Buffer.from(value));
        if (!ok) {
          await new Promise((resolve) => res.once("drain", resolve));
        }
      }
    }
  } finally {
    res.end();
  }
}

/**
 * Try to handle this Node request as official Codex passthrough.
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 * @param {{ log?: { info?: Function, warn?: Function, error?: Function } }} [opts]
 * @returns {Promise<boolean>} true if response was fully handled
 */
export async function tryHandleNodeRequest(req, res, opts = {}) {
  const log = opts.log || null;
  const method = (req.method || "GET").toUpperCase();
  const rawUrl = req.url || "/";
  const qIdx = rawUrl.indexOf("?");
  const pathOnly = qIdx >= 0 ? rawUrl.slice(0, qIdx) : rawUrl;
  const search = qIdx >= 0 ? rawUrl.slice(qIdx) : "";

  if (!isOfficialPassthroughRequestPath(pathOnly)) return false;

  const headers = normalizeHeaders(req.headers);

  // Fast path: non-Codex never consumes body
  if (!isCodexClient(headers, {})) return false;

  if (method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    });
    res.end();
    return true;
  }

  const hasBody = method !== "GET" && method !== "HEAD";
  let rawBody = Buffer.alloc(0);
  if (hasBody) {
    rawBody = await readIncomingBody(req);
  }

  const { body, contentEncoding } = peekBodyForGate(rawBody, headers);
  const pathname = normalizeRequestPath(pathOnly);

  if (!shouldOfficialPassthrough({ headers, body })) {
    // Third-party model via Codex base_url — let 9router route handle it
    if (hasBody) reinjectIncomingBody(req, rawBody);
    return false;
  }

  const host = headers.host || "localhost";
  const proto = headers["x-forwarded-proto"] || "http";
  const fetchUrl = `${proto}://${host}${pathOnly}${search}`;
  /** @type {RequestInit} */
  const init = {
    method,
    headers: headersAsFetch(headers),
  };
  if (hasBody && rawBody.length) {
    init.body = rawBody;
    // Node fetch may require duplex when body is a stream; Buffer is fine as-is
    init.duplex = "half";
  }

  const request = new Request(fetchUrl, init);
  const response = await handleOfficialPassthrough(request, body, {
    log: log || consoleLogAdapter(),
    pathname,
    search,
    rawBody: hasBody ? rawBody : null,
    contentEncoding,
  });

  await writeFetchResponseToNode(res, response);
  return true;
}

function headersAsFetch(headers) {
  const h = new Headers();
  for (const [k, v] of Object.entries(headers)) {
    if (v == null || v === "") continue;
    if (k === "host") continue;
    try {
      h.set(k, String(v));
    } catch {
      // ignore invalid header names
    }
  }
  return h;
}

function consoleLogAdapter() {
  return {
    info: (tag, message) => console.log(`[${new Date().toLocaleTimeString("en-US", { hour12: false })}] ℹ️  [${tag}] ${message}`),
    warn: (tag, message) => console.warn(`[${new Date().toLocaleTimeString("en-US", { hour12: false })}] ⚠️  [${tag}] ${message}`),
    error: (tag, message) => console.log(`[${new Date().toLocaleTimeString("en-US", { hour12: false })}] ❌ [${tag}] ${message}`),
  };
}
