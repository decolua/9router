/**
 * A stand-in for api.anthropic.com that a real `claude` binary can talk to.
 *
 *   node scripts/fork/lib/fake-anthropic.mjs [--port 0] [--dir <capture dir>]
 *
 * Point a child at it with ANTHROPIC_BASE_URL (or 9Router's test-only
 * CLI_CLAUDE_UPSTREAM_OVERRIDE) and every Messages request the CLI makes is
 * written to disk, in order, and answered with a short canned stream. Nothing
 * reaches Anthropic and no subscription usage is spent, which is the point:
 * the cache work needs to see the exact bytes the CLI sends, turn after turn,
 * and until now the only way to see them was a real account — every failed
 * attempt of which also locked that account for thirty seconds.
 *
 * Headers are never written or printed. The CLI sends its real credential in
 * `authorization`, and a capture file is exactly the kind of thing that ends
 * up pasted somewhere.
 *
 * The canned answer is a valid Messages stream — message_start through
 * message_stop, with named `event:` lines — because a CLI that cannot parse it
 * records no assistant turn, and then there is nothing to resume and every
 * experiment built on this fails for the wrong reason.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const sse = (type, data) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;

function cannedToolStream({ model, tool, usage, n }) {
  return [
    sse("message_start", {
      message: {
        id: `msg_fake_${Date.now().toString(36)}`, type: "message", role: "assistant", model, content: [],
        stop_reason: null, stop_sequence: null,
        usage: { input_tokens: usage.input, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      },
    }),
    sse("content_block_start", { index: 0, content_block: { type: "tool_use", id: `toolu_fake_${n}`, name: tool.name, input: {} } }),
    sse("content_block_delta", { index: 0, delta: { type: "input_json_delta", partial_json: JSON.stringify(tool.input || {}) } }),
    sse("content_block_stop", { index: 0 }),
    sse("message_delta", { delta: { stop_reason: "tool_use", stop_sequence: null }, usage: { output_tokens: 5 } }),
    sse("message_stop", {}),
  ].join("");
}

function cannedStream({ model, text, usage }) {
  return [
    sse("message_start", {
      message: {
        id: `msg_fake_${Date.now().toString(36)}`,
        type: "message",
        role: "assistant",
        model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: usage.input, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      },
    }),
    sse("content_block_start", { index: 0, content_block: { type: "text", text: "" } }),
    sse("ping", {}),
    sse("content_block_delta", { index: 0, delta: { type: "text_delta", text } }),
    sse("content_block_stop", { index: 0 }),
    sse("message_delta", { delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 3 } }),
    sse("message_stop", {}),
  ].join("");
}

function cannedMessage({ model, text, usage }) {
  return {
    id: `msg_fake_${Date.now().toString(36)}`,
    type: "message",
    role: "assistant",
    model,
    content: [{ type: "text", text }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: usage.input, output_tokens: 3, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  };
}

/**
 * @param {object} [opts]
 * @param {string} [opts.dir] where request bodies are written; a temp dir by default
 * @param {number} [opts.port] 0 for any free port
 * @param {(n: number) => string} [opts.answer] the text of the n-th answer (1-based)
 * @param {number} [opts.delayMs] hold every answer this long, to widen race windows
 * @param {(n: number, body: object) => ({name: string, input?: object}|null)} [opts.toolCall]
 *   when it returns a tool, the n-th answer proposes that call instead of text
 * @returns {Promise<{url: string, dir: string, bodies: string[], paths: string[], close: () => Promise<void>}>}
 */
export async function startFakeAnthropic({ dir, port = 0, answer = (n) => `fake answer ${n}`, delayMs = 0, toolCall = null } = {}) {
  const captureDir = dir || fs.mkdtempSync(path.join(os.tmpdir(), "9r-fake-anthropic-"));
  fs.mkdirSync(captureDir, { recursive: true });
  const bodies = [];
  const paths = [];
  const other = [];

  const server = new http.Server((req, res) => {
    const [pathname] = String(req.url || "").split("?");
    if (req.method === "HEAD" || (req.method === "GET" && pathname === "/api/hello")) {
      res.writeHead(200, { "content-type": "application/json", connection: "close" }).end();
      return;
    }
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      if (req.method !== "POST" || !/\/v1\/messages$/.test(pathname)) {
        // Paths only — never headers, never bodies of requests we do not own.
        other.push(`${req.method} ${pathname}`);
        res.writeHead(404, { "content-type": "application/json", connection: "close" })
          .end('{"type":"error","error":{"type":"not_found_error","message":"fake upstream"}}');
        return;
      }
      const raw = Buffer.concat(chunks).toString("utf8");
      bodies.push(raw);
      const n = bodies.length;
      const file = path.join(captureDir, `request-${String(n).padStart(3, "0")}.json`);
      fs.writeFileSync(file, raw);
      paths.push(file);

      let body = {};
      try { body = JSON.parse(raw); } catch { /* answered anyway */ }
      const model = body.model || "claude-fake";
      const text = answer(n);
      const usage = { input: Math.max(1, Math.round(raw.length / 4)) };
      const reply = () => {
        const tool = toolCall ? toolCall(n, body) : null;
        if (tool && body.stream) {
          res.writeHead(200, { "content-type": "text/event-stream", "request-id": `req_fake_${n}`, connection: "close" });
          res.end(cannedToolStream({ model, tool, usage, n }));
          return;
        }
        if (body.stream) {
          res.writeHead(200, {
            "content-type": "text/event-stream",
            "cache-control": "no-cache",
            "request-id": `req_fake_${n}`,
            connection: "close",
          });
          res.end(cannedStream({ model, text, usage }));
        } else {
          res.writeHead(200, { "content-type": "application/json", "request-id": `req_fake_${n}`, connection: "close" });
          res.end(JSON.stringify(cannedMessage({ model, text, usage })));
        }
      };
      if (delayMs) setTimeout(reply, delayMs); else reply();
    });
  });
  server.keepAliveTimeout = 0;

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  const address = server.address();
  return {
    url: `http://127.0.0.1:${address.port}`,
    dir: captureDir,
    bodies,
    paths,
    other,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const arg = (name, fallback) => {
    const i = process.argv.indexOf(name);
    return i >= 0 ? process.argv[i + 1] : fallback;
  };
  const fake = await startFakeAnthropic({ port: Number(arg("--port", 0)), dir: arg("--dir") });
  console.log(`fake anthropic listening at ${fake.url}, capturing into ${fake.dir}`);
  const stop = async () => { await fake.close(); process.exit(0); };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}
