/**
 * Responses that arrive with nothing in them.
 *
 *   node scripts/fork/check-claude-cli-empty-response.mjs
 *
 * The report: an agent retried the same step forever, and the recorded turns
 * showed output tokens with no content — "[Empty streaming response]". Two ways
 * this executor produced exactly that:
 *
 *   - it read only the partial stream events and ignored the complete
 *     `assistant` message the CLI emits alongside them, so when the deltas do
 *     not arrive the answer is never taken from anywhere;
 *   - the final fallback (emit the result's text when nothing streamed) was
 *     keyed on whether a message had been *opened*, which thinking also does —
 *     so a turn that produced only thinking suppressed the fallback that would
 *     have answered.
 *
 * Neither can be provoked from the real binary on demand, so this drives the
 * whole HTTP path with a stand-in `claude` that emits exactly those shapes. It
 * spends no subscription requests, and it fails on the behaviour that was
 * reported rather than on a proxy for it.
 *
 * Needs port 21985 free.
 */
import { spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = process.env.ROUTER_ROOT
  || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const PORT = 21985;
const PASSWORD = "claude-cli-empty-response-password";
const DATA_DIR = path.join(os.tmpdir(), `9r-empty-${Date.now()}`);
const BIN_DIR = path.join(os.tmpdir(), `9r-fakecli-${Date.now()}`);
const MODEL = "claude-cli/claude-cli-haiku";

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : `\n        ${detail}`}`);
};

const call = (opts, body) => new Promise((resolve, reject) => {
  const r = http.request({ host: "127.0.0.1", port: PORT, timeout: 120000, ...opts }, (res) => {
    let data = "";
    res.on("data", (c) => { data += c; });
    res.on("end", () => {
      let json = null;
      try { json = JSON.parse(data); } catch { /* sse */ }
      resolve({ status: res.statusCode, headers: res.headers, body: data, json });
    });
  });
  r.on("error", reject);
  r.on("timeout", () => r.destroy(new Error("request timeout")));
  if (body) r.write(body);
  r.end();
});

const waitFor = async (fn, ms, label) => {
  const deadline = Date.now() + ms;
  let last = "";
  while (Date.now() < deadline) {
    try { if (await fn()) return true; } catch (e) { last = e.message; }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`timed out waiting for ${label} (${last})`);
};

/**
 * A stand-in for the Claude Code binary.
 *
 * Reads the request off stdin the way the real one does, then writes the
 * stream-json shape named in a file beside it. The shape is passed that way and
 * not through the environment because the executor hands its child an allowlist
 * — which is the point of the allowlist, and means a stand-in cannot be
 * configured through it either. On Windows the executor routes a `.cmd` through
 * the npm package layout beside it, so the file has to live where
 * resolveShimTarget looks; elsewhere the script is spawned directly.
 */
const FAKE_CLI = `#!/usr/bin/env node
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  const path = require("path");
  const mode = (() => {
    try {
      return require("fs").readFileSync(path.join(path.dirname(process.argv[1]), "mode.txt"), "utf8").trim();
    } catch { return "deltas-missing"; }
  })();
  const say = (o) => process.stdout.write(JSON.stringify(o) + "\\n");
  const usage = { input_tokens: 10, output_tokens: 619, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };

  if (mode === "deltas-missing") {
    // Output tokens, and not one partial event: the answer exists only in the
    // complete message.
    say({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "HELLO-COMPLETE" }] } });
    say({ type: "result", subtype: "success", is_error: false, num_turns: 1, usage, result: "HELLO-COMPLETE" });
  } else if (mode === "thinking-only") {
    // A message is opened by thinking and never answered in the stream.
    say({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "weighing it up" } } });
    say({ type: "result", subtype: "success", is_error: false, num_turns: 1, usage, result: "HELLO-RESULT" });
  } else if (mode === "relay-env") {
    // What the routed child was actually pointed at. The relay that moves the
    // prompt-cache breakpoint lives in the spawn path, and nothing else here
    // exercises it: this stand-in prints canned JSON and never opens a socket,
    // so every other case passes with the relay untouched.
    const seen = process.env.ANTHROPIC_BASE_URL || "unset";
    say({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "BASE_URL=" + seen }] } });
    say({ type: "result", subtype: "success", is_error: false, num_turns: 1, usage, result: "BASE_URL=" + seen });
  } else if (mode === "error-result") {
    // The CLI failed. The reason rides in the errors array, not in the result
    // field: an error result has no result field at all. (No backticks here —
    // this program is built inside a template literal.)
    say({ type: "result", subtype: "error_during_execution", is_error: true, num_turns: 1, usage,
      errors: ["the upstream refused the request"] });
  } else if (mode === "empty-turn") {
    // Success, one turn, and nothing in it: measured on a turn that only
    // thought. Delivered as-is this is an assistant message with no content.
    say({ type: "result", subtype: "success", is_error: false, num_turns: 1, usage, result: "" });
  } else if (mode === "tool-only") {
    say({ type: "assistant", message: { role: "assistant", content: [
      { type: "tool_use", id: "toolu_fake_1", name: "mcp__ninerouter__get_weather", input: { city: "Seoul" } },
    ] } });
    say({ type: "result", subtype: "error_max_turns", is_error: true, stop_reason: "tool_use", num_turns: 2, usage });
  }
  process.exit(0);
});
`;

let modeFile = "";

function installFakeCli() {
  const pkgDir = path.join(BIN_DIR, "node_modules", "@anthropic-ai", "claude-code");
  fs.mkdirSync(pkgDir, { recursive: true });
  const target = path.join(pkgDir, "cli.js");
  fs.writeFileSync(target, FAKE_CLI);
  modeFile = path.join(pkgDir, "mode.txt");
  fs.writeFileSync(modeFile, "deltas-missing");
  if (process.platform === "win32") {
    // The executor never spawns a .cmd itself — it finds the package beside it
    // and runs that with this server's own node.
    const shim = path.join(BIN_DIR, "claude.cmd");
    fs.writeFileSync(shim, "@echo off\r\n");
    return shim;
  }
  fs.chmodSync(target, 0o755);
  return target;
}

let server;
let log = "";
try {
  if (!fs.existsSync(path.join(ROOT, ".next", "BUILD_ID"))) {
    console.log("  SKIP  empty-response check (no production build — run `npx next build` first)");
    process.exit(0);
  }
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const bin = installFakeCli();

  const env = { ...process.env };
  delete env.JWT_SECRET;
  server = spawn(process.execPath,
    [path.join(ROOT, "node_modules", "next", "dist", "bin", "next"), "start", "--port", String(PORT)], {
      cwd: ROOT,
      env: {
        ...env,
        DATA_DIR,
        INITIAL_PASSWORD: PASSWORD,
        PORT: String(PORT),
        CLI_CLAUDE_BIN: bin,
        // Both names, deliberately. ENABLE_REQUEST_LOGS is the older one for
        // the same switch and takes precedence when set — and a repo .env sets
        // it to false, which is exactly the trap this catches: setting only the
        // newer name here left recording off and the record empty.
        ENABLE_REQUEST_LOGS: "true",
        OBSERVABILITY_ENABLED: "true",
        // Without this the bodies come back as {redacted:true} and every
        // assertion about what was *recorded* reads zero rows and passes
        // vacuously — which is how a check about the record can be green while
        // the record is wrong.
        OBSERVABILITY_INCLUDE_PAYLOADS: "true",
        // On for this harness, off at runtime. The relay is opt-in because it
        // does not yet hold up against a real subscription, but the wiring that
        // points the child at it still has to be asserted — otherwise the one
        // check that proves it exists would quietly stop proving anything.
        CLI_CLAUDE_CACHE_RELAY: "1",
        NODE_OPTIONS: `--require "${path.join(ROOT, "custom-server.js").replace(/\\/g, "/")}"`,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
  server.stdout.on("data", (d) => { log += d; });
  server.stderr.on("data", (d) => { log += d; });

  await waitFor(async () => (await call({ method: "GET", path: "/api/health" })).status < 500,
    240000, "the built server to answer");

  const login = await call({ method: "POST", path: "/api/auth/login", headers: { "content-type": "application/json" } },
    JSON.stringify({ password: PASSWORD }));
  const m = /auth_token=([^;]+)/.exec([].concat(login.headers["set-cookie"] || []).join("; "));
  if (!m) throw new Error("no session cookie from login");
  const cookie = `auth_token=${m[1]}`;
  const json = { cookie, "content-type": "application/json" };

  // A token account so the route has something active to run; the stand-in
  // never looks at the credential.
  const account = await call({ method: "POST", path: "/api/cli-tools/claude-cli-accounts", headers: json },
    JSON.stringify({ oauthToken: "sk-ant-oat01-stand-in", name: "Stand-in account" }));
  check("an account can be attached for the stand-in binary",
    Boolean(account.json?.account?.id), `status=${account.status} body=${account.body.slice(0, 200)}`);

  const keyRes = await call({ method: "POST", path: "/api/keys", headers: json },
    JSON.stringify({ name: "empty-response-check" }));
  const apiKey = keyRes.json?.apiKey?.key || keyRes.json?.key || keyRes.json?.apiKey;
  if (!apiKey) throw new Error(`no API key: ${keyRes.body.slice(0, 200)}`);

  const complete = (payload) => call({
    method: "POST",
    path: "/v1/chat/completions",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
  }, JSON.stringify(payload));

  const ASK = [{ role: "user", content: "anything" }];
  const TOOLS = [{
    type: "function",
    function: {
      name: "get_weather",
      description: "Get the weather.",
      parameters: { type: "object", properties: { city: { type: "string" } } },
    },
  }];

  // The stand-in reads its shape from a file, so a case is one write away and
  // the server never has to be restarted between them.
  const withMode = async (mode, payload) => {
    fs.writeFileSync(modeFile, mode);
    return complete(payload);
  };

  // 1. The reported shape: output tokens, no partial events.
  const complete1 = await withMode("deltas-missing", { model: MODEL, messages: ASK, stream: false });
  const content1 = complete1.json?.choices?.[0]?.message?.content || "";
  check("an answer that arrives only as a complete message still reaches the client",
    complete1.status === 200 && content1.includes("HELLO-COMPLETE"),
    `status=${complete1.status} content=${JSON.stringify(content1).slice(0, 200)}`);

  // 2. Thinking opens a message and answers nothing in the stream.
  const complete2 = await withMode("thinking-only", { model: MODEL, messages: ASK, stream: false });
  const content2 = complete2.json?.choices?.[0]?.message?.content || "";
  check("a turn that produced only thinking still answers from the result",
    complete2.status === 200 && content2.includes("HELLO-RESULT"),
    `status=${complete2.status} content=${JSON.stringify(content2).slice(0, 200)}`);

  // 3. A tool call that arrives only as a complete message.
  const complete3 = await withMode("tool-only", { model: MODEL, messages: ASK, tools: TOOLS, stream: false });
  const call3 = complete3.json?.choices?.[0]?.message?.tool_calls?.[0];
  check("a tool call that arrives only as a complete message is returned",
    complete3.status === 200 && call3?.function?.name === "get_weather",
    `status=${complete3.status} body=${complete3.body.slice(0, 250)}`);
  check("...with its arguments whole, and no error frame",
    call3?.function?.arguments === '{"city":"Seoul"}' && !/claude_cli_error/.test(complete3.body),
    `arguments=${call3?.function?.arguments}`);

  // 4. A tool call over the streaming path, which is the combination an agent
  //    actually uses: it streams, and what it needs back is the call.
  const streamedTool = await withMode("tool-only", { model: MODEL, messages: ASK, tools: TOOLS, stream: true });
  const toolEvents = streamedTool.body.split(String.fromCharCode(10))
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .filter((payload) => payload && payload !== "[DONE]")
    .map((payload) => { try { return JSON.parse(payload); } catch { return null; } })
    .filter(Boolean);
  const streamedCall = toolEvents.find((e) => e.choices?.[0]?.delta?.tool_calls?.[0]?.function?.name);
  check("a tool call that arrives only as a complete message streams too",
    streamedTool.status === 200
      && streamedCall?.choices[0].delta.tool_calls[0].function.name === "get_weather",
    streamedTool.body.slice(0, 300));
  check("...finishing as tool_calls, with no error event",
    toolEvents.some((e) => e.choices?.[0]?.finish_reason === "tool_calls")
      && !/claude_cli_error/.test(streamedTool.body)
      && streamedTool.body.includes("[DONE]"),
    streamedTool.body.slice(-300));

  // 5. Streaming sees the plain answer too.
  const streamed = await withMode("deltas-missing", { model: MODEL, messages: ASK, stream: true });
  check("the same answer reaches a streaming client",
    streamed.status === 200 && streamed.body.includes("HELLO-COMPLETE") && streamed.body.includes("[DONE]"),
    streamed.body.slice(0, 300));
  // 5b. What the dashboard records for a turn whose whole answer was a tool
  //     call. The accumulator collected only text, so such a turn was filed as
  //     "[Empty streaming response]" — the same words the genuine empty-response
  //     path uses, which is what made a working agent look broken.
  await withMode("tool-only", { model: MODEL, messages: ASK, tools: TOOLS, stream: true });
  await new Promise((r) => setTimeout(r, 6000));
  const toolRecord = await call({
    method: "GET", path: "/api/usage/request-details?pageSize=20", headers: { cookie },
  });
  const toolRows = (toolRecord.json?.details || [])
    .map((d) => d.response?.content)
    .filter((c) => typeof c === "string");
  const recorded = toolRows.find((c) => c.includes("get_weather")) || toolRows[0] || "";
  check("a tool-call-only turn is recorded as the call it made",
    /get_weather/.test(recorded) && !/Empty streaming response/.test(recorded),
    `recorded=${JSON.stringify(recorded).slice(0, 200)} rows=${toolRows.length}`);
  check("...and no row still says the response was empty",
    !toolRows.some((c) => c.includes("Empty streaming response")),
    JSON.stringify(toolRows.filter((c) => c.includes("Empty streaming response"))).slice(0, 220));

  // 5c. The child must actually be pointed at the cache relay. Everything else
  //     in this file passes whether or not it is wired up at all.
  const relayEnv = await withMode("relay-env", { model: MODEL, messages: ASK, stream: false });
  const relaySeen = relayEnv.json?.choices?.[0]?.message?.content || "";
  check("the routed child is pointed at the loopback cache relay when it is on",
    /BASE_URL=http:\/\/127\.0\.0\.1:[0-9]+\/admit\/[A-Za-z0-9_-]+/.test(relaySeen),
    `child saw ${JSON.stringify(relaySeen).slice(0, 160)}`);

  // 6. A failure has to be visible to a Claude-format client, which is what an
  //    agent usually is. The error frame carries no `choices`, and the Claude
  //    translator drops any chunk without `choices[0]` — so for that client the
  //    stream used to end with nothing said, which is an empty turn it retries
  //    against forever.
  const messages = (payload) => call({
    method: "POST",
    path: "/v1/messages",
    headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
  }, JSON.stringify(payload));

  fs.writeFileSync(modeFile, "error-result");
  const claudeErr = await messages({
    model: MODEL, max_tokens: 64, stream: true,
    messages: [{ role: "user", content: "anything" }],
  });
  check("a failure reaches a Claude-format client as something it can read",
    claudeErr.body.includes("the upstream refused the request"),
    `status=${claudeErr.status} body=${claudeErr.body.slice(0, 400)}`);
  check("...and the turn is closed, not left hanging",
    /message_stop/.test(claudeErr.body),
    claudeErr.body.slice(-300));

  const openaiErr = await withMode("error-result", { model: MODEL, messages: ASK, stream: true });
  check("...while an OpenAI-format client still gets the error frame it expects",
    /claude_cli_error/.test(openaiErr.body)
      && openaiErr.body.includes("the upstream refused the request"),
    openaiErr.body.slice(0, 300));

  // 7. A turn that ended having produced nothing is reported, not handed on as
  //    a successful empty message.
  const emptyTurn = await withMode("empty-turn", { model: MODEL, messages: ASK, stream: true });
  check("a turn that produced nothing at all says so",
    /empty_response/.test(emptyTurn.body) && /without producing/.test(emptyTurn.body),
    emptyTurn.body.slice(0, 300));

  // 6. The record a stuck client is diagnosed from has to describe what was
  //    actually replayed, not just how many characters went down the pipe.
  await new Promise((r) => setTimeout(r, 6000));
  const details = await call({ method: "GET", path: "/api/usage/request-details?pageSize=20", headers: { cookie } });
  const withShape = (details.json?.details || [])
    .map((d) => d.providerRequest)
    .find((p) => p && typeof p === "object" && p.conversation);
  check("the record describes the conversation that was replayed",
    Boolean(withShape?.conversation),
    `recording=${details.json?.recording} rows=${(details.json?.details || []).length} `
      + `sample=${JSON.stringify((details.json?.details || [])[0]?.providerRequest || null).slice(0, 220)}`);
  if (withShape?.conversation) {
    const shape = withShape.conversation;
    check("...with the turn count, the tool calls, and what went unanswered",
      typeof shape.turns === "number"
        && typeof shape.toolCalls === "number"
        && Array.isArray(shape.orphanResults)
        && Array.isArray(shape.unansweredCalls)
        && Array.isArray(shape.lastTurns),
      JSON.stringify(shape).slice(0, 300));
  }
} catch (e) {
  check("harness completed", false, e.message);
} finally {
  if (server) server.kill();
  try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch { /* best effort */ }
  try { fs.rmSync(BIN_DIR, { recursive: true, force: true }); } catch { /* best effort */ }
}

const pass = results.filter((r) => r.ok).length;
if (pass !== results.length) console.log(`\n--- server log tail ---\n${log.slice(-3000)}`);
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
