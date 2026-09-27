/**
 * A loopback relay the routed child talks to instead of the API directly.
 *
 * It exists for one reason: to move the prompt-cache breakpoint.
 *
 * Measured on claude 2.1.281 — three identical requests in a row read the whole
 * cached prefix (`cache_read_input_tokens: 40516`), but change one word of the
 * final question and the next request reads nothing and rewrites all 40k. The
 * CLI attaches per-request context to the turn it is answering — today's date,
 * the account reminder, whatever a later version adds — and puts the single
 * message-level `cache_control` on or after that turn. The next request replays
 * the turn WITHOUT those additions, so the cached prefix never recurs and every
 * round of an agent loop reprocesses the entire history from scratch. At the
 * 93k-token conversations this provider is actually used for, that is the
 * difference between a few seconds and the 12-16s that makes clients give up.
 *
 * The CLI decides where to put the breakpoint and there is no flag for it, so
 * the marker is moved in flight: back to the last block that the NEXT request
 * will replay unchanged — everything through the last assistant message, plus
 * the leading blocks of the newest user turn that match what 9Router actually
 * sent. The first block the CLI added or altered ends that span, so a reworded
 * or newly added annotation cannot reopen the problem.
 *
 * A port of the Hermes plugin's `admission.py` (MIT,
 * NousResearch/hermes-plugin-claude-subscription-directsdk), whose comment
 * describes the same failure. Kept as close to it as the language allows, with
 * one deviation that a measurement forced.
 *
 * The plugin admits exactly one POST and refuses the rest. A simple routed
 * request does make exactly one — `HEAD /api/hello`, a reachability probe, then
 * one `POST /v1/messages?beta=true` — but the live suite against a real
 * subscription showed that is not universal: some requests make a second model
 * call, and refusing it does not merely fail that request. 9Router reads the
 * refusal as an upstream 4xx, marks the account unavailable and locks it for
 * thirty seconds, so one denial cascades into every request behind it. Measured
 * 20/28 with the gate, 28/28 without. So POSTs are counted, not capped.
 *
 * Everything else stays as the plugin has it, including refusing any path but
 * `/v1/messages`, which costs nothing and bounds what a child can do with the
 * URL it was handed.
 *
 * Nothing here persists or logs a credential: headers are forwarded as the CLI
 * sent them and the relay keeps no copy.
 */
import http from "node:http";
import https from "node:https";
import crypto from "node:crypto";

/** Blocks whose content the server will not cache, so a marker cannot sit on one. */
const UNCACHEABLE = new Set(["thinking", "redacted_thinking"]);

const withoutCacheControl = (block) => {
  if (!block || typeof block !== "object") return block;
  const copy = { ...block };
  delete copy.cache_control;
  return copy;
};

const sameBlock = (a, b) => JSON.stringify(withoutCacheControl(a)) === JSON.stringify(withoutCacheControl(b));

/**
 * Move the message-level cache breakpoint back onto content the next request
 * will replay unchanged.
 *
 * Conservative by construction: it never moves the marker later, never changes
 * any content, and returns the payload untouched on anything unexpected — a
 * body that does not parse, a shape it does not recognise, or more than one
 * message-level marker.
 *
 * @param {Buffer} payload the request body as the CLI wrote it
 * @param {Array<object>|null} queried content blocks of the last turn 9Router sent
 * @returns {Buffer} the same payload, or one with the marker moved
 */
export function pinMessageBreakpoint(payload, queried) {
  if (!queried || !Array.isArray(queried) || !queried.length) return payload;
  try {
    const body = JSON.parse(payload.toString("utf8"));
    const messages = body?.messages;
    if (!Array.isArray(messages)) return payload;

    const blocks = [];
    messages.forEach((message, i) => {
      if (Array.isArray(message?.content)) {
        message.content.forEach((block, j) => blocks.push({ i, j, block }));
      }
    });
    const marked = blocks.filter((b) => b.block && typeof b.block === "object" && "cache_control" in b.block);
    // Exactly one message-level marker is the shape this understands. Anything
    // else is a policy the CLI changed, and guessing at it would be worse than
    // leaving the request alone.
    if (marked.length !== 1) return payload;

    let lastAssistant = -1;
    messages.forEach((message, i) => { if (message?.role === "assistant") lastAssistant = i; });

    // Everything through the last assistant message recurs verbatim next time.
    const stable = blocks.filter((b) => b.i <= lastAssistant);

    // Plus however much of the newest user turn is ours rather than the CLI's.
    const newest = messages[lastAssistant + 1];
    if (newest?.role === "user" && Array.isArray(newest.content)) {
      for (let j = 0; j < newest.content.length && j < queried.length; j += 1) {
        if (!sameBlock(newest.content[j], queried[j])) break;
        stable.push({ i: lastAssistant + 1, j, block: newest.content[j] });
      }
    }

    let target = null;
    for (let k = stable.length - 1; k >= 0; k -= 1) {
      const candidate = stable[k];
      if (candidate.block && typeof candidate.block === "object" && !UNCACHEABLE.has(candidate.block.type)) {
        target = candidate;
        break;
      }
    }
    const current = marked[0];
    // Never later than where the CLI put it: that would shorten the cached
    // prefix rather than lengthen it.
    if (!target || target.i > current.i || (target.i === current.i && target.j >= current.j)) return payload;

    target.block.cache_control = current.block.cache_control;
    delete current.block.cache_control;
    return Buffer.from(JSON.stringify(body), "utf8");
  } catch {
    return payload;
  }
}

// Sent by the CLI and meaningless to re-send, or rewritten by this hop.
const HOP_BY_HOP = new Set([
  "host", "connection", "content-length", "transfer-encoding",
  "proxy-authorization", "proxy-connection", "accept-encoding",
]);
// 9Router's own. custom-server.js replaces http.createServer for the whole
// process to stamp the real peer address onto every inbound request — and it
// cannot tell this relay's sockets from the dashboard's, so the child's request
// arrives carrying them. They are internal and must never leave the host.
const INTERNAL_HEADER_PREFIX = "x-9r-";
const RESPONSE_STRIP = new Set(["connection", "transfer-encoding", "server", "date"]);

/**
 * Start a relay for one request and return where to point the child.
 *
 * Bound to loopback on an ephemeral port behind an unguessable path, for the
 * length of one request. POSTs are counted rather than capped — see above for
 * the measurement that settled it.
 *
 * @returns {Promise<{url: string, close: () => void, stats: () => object}>}
 */
export async function startAdmission({ upstream = "https://api.anthropic.com", timeoutMs = 600000, queried = null } = {}) {
  const target = new URL(upstream);
  const host = target.hostname;
  const loopback = host === "127.0.0.1" || host === "::1" || host === "localhost";
  if ((target.protocol !== "https:" && !(target.protocol === "http:" && loopback))
    || !host || target.username || target.password || target.search || target.hash) {
    throw new Error("Claude CLI upstream must be HTTPS, or a loopback HTTP fixture");
  }
  const prefix = `/admit/${crypto.randomBytes(24).toString("base64url")}`;
  let admitted = 0;
  let forwarded = 0;
  let pinned = 0;
  let refused = 0;
  let failure = null;
  let status = null;
  let requestId = null;

  // `new http.Server`, not `http.createServer`: custom-server.js replaces the
  // latter process-wide and wraps every server made through it — rewriting
  // headers, overriding emit, and adding upgrade handling meant for the
  // dashboard's listener. Applied to this relay that broke every routed request
  // it carried, and it is not a wrapper this socket has any use for.
  const server = new http.Server((req, res) => {
    const [pathname, query = ""] = String(req.url || "").split("?");
    // POST /v1/messages behind the secret prefix, and nothing else. The only
    // other request a routed child makes is `HEAD /api/hello`, a reachability
    // probe it proceeds without.
    if (req.method !== "POST" || pathname !== `${prefix}/v1/messages` || req.headers.origin) {
      refused += 1;
      req.resume();
      res.writeHead(404).end();
      return;
    }
    admitted += 1;

    const chunks = [];
    req.on("error", (err) => { failure = err.name; try { res.destroy(); } catch { /* gone */ } });
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      let payload = Buffer.concat(chunks);
      const rewritten = pinMessageBreakpoint(payload, queried);
      if (rewritten !== payload) pinned += 1;
      payload = rewritten;

      // Request identity and payload remain the child's; only the hop changes.
      const headers = {};
      for (const [key, value] of Object.entries(req.headers)) {
        const name = key.toLowerCase();
        if (HOP_BY_HOP.has(name) || name.startsWith(INTERNAL_HEADER_PREFIX)) continue;
        headers[key] = value;
      }
      headers["accept-encoding"] = "identity";
      headers["content-length"] = String(payload.length);

      const transport = target.protocol === "https:" ? https : http;
      const upstreamReq = transport.request({
        hostname: host,
        port: target.port || (target.protocol === "https:" ? 443 : 80),
        path: `${target.pathname.replace(/\/$/, "")}/v1/messages${query ? `?${query}` : ""}`,
        method: "POST",
        headers,
        timeout: timeoutMs,
      }, (upstreamRes) => {
        forwarded += 1;
        status = upstreamRes.statusCode;
        requestId = upstreamRes.headers["request-id"] || upstreamRes.headers["x-request-id"] || null;
        const out = {};
        for (const [key, value] of Object.entries(upstreamRes.headers)) {
          if (!RESPONSE_STRIP.has(key.toLowerCase())) out[key] = value;
        }
        out.connection = "close";
        res.writeHead(upstreamRes.statusCode || 502, out);
        upstreamRes.pipe(res);
      });
      upstreamReq.on("timeout", () => upstreamReq.destroy(new Error("TimeoutError")));
      // As the plugin does: record what went wrong and close. The child reports
      // a failed request; the relay never answers in the upstream's place. What
      // it went wrong with is readable from stats(), which is where the caller
      // logs it.
      upstreamReq.on("error", (err) => {
        failure = err.message || err.name;
        try { res.destroy(); } catch { /* gone */ }
      });
      upstreamReq.end(payload);
    });
  });

  server.on("clientError", (_err, socket) => { try { socket.destroy(); } catch { /* gone */ } });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  server.unref();

  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}${prefix}`,
    close: () => { try { server.close(); } catch { /* already closed */ } },
    stats: () => ({ forwarded, pinned, refused, admitted, failure, status, requestId }),
  };
}
