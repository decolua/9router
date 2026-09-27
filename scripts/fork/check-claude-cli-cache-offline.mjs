/**
 * The prompt-cache paths of the claude-cli provider, driven through the whole
 * 9Router server with the real `claude` binary — and a fake API.
 *
 *   node scripts/fork/check-claude-cli-cache-offline.mjs [plain|relay|session ...]
 *
 * Every mode starts the production server (custom-server.js wrapping
 * `next start`, the way the image runs it) with CLI_CLAUDE_UPSTREAM_OVERRIDE
 * pointing the child at lib/fake-anthropic.mjs. Nothing reaches Anthropic and
 * no subscription is used: the account attached is a stand-in token the fake
 * never checks.
 *
 * Then a three-turn conversation goes through /v1/chat/completions the way an
 * agent sends it — whole history every time — and the bodies the CLI sent are
 * compared turn to turn: does each one repeat the previous prefix up to the
 * previous breakpoint, which is what the cache needs to hit.
 *
 *   plain    today's path (both caches off): expected to miss, and the model
 *            sees the conversation folded — every earlier question inside the
 *            newest turn, assistant turns first
 *   seeded   CLI_CLAUDE_SESSION_CACHE=1 on a conversation this process never
 *            answered (a history that arrived from elsewhere): the history is
 *            written as a transcript and resumed, so the model sees it in order
 *   relay    CLI_CLAUDE_CACHE_RELAY=1 — the relay inside the Next server, which
 *            is exactly where it hung against the real API. Here the upstream
 *            is local, so a hang now is the relay's own, not Anthropic's.
 *            Its prefix reuse is printed, not judged (see below).
 *   session  CLI_CLAUDE_SESSION_CACHE=1 — sessions resumed across turns
 *   session-tools  the first turn proposes a tool call and the second answers
 *            it with a tool result — an agent's ordinary turn. The tool-result
 *            turn must NOT resume: the CLI has already answered its own call in
 *            the transcript with a denial, and a resumed result for that id is
 *            dropped (measured 2.1.281). It replays fresh, and the client's
 *            result — not the denial — must be what reaches the model. Offline
 *            the fake decides that the model calls the tool; --live asks haiku.
 *   session-record  (offline) the quota card's cache sentence and the Request
 *            Details record carry what the session cache did
 *   session-concurrent  (offline) two identical requests at once on one
 *            conversation: both answered, one continuation kept, nothing leaked
 *   session-abort  (offline) a client leaves in the middle of a resumed turn:
 *            slot back, session discarded, the next turn starts fresh
 *
 * --live drops the fake: the host's own signed-in Claude Code account is
 * adopted (into a throwaway DATA_DIR) and the same three turns go to the real
 * API on haiku, once per mode. Each question carries a long paragraph, so a
 * path that reprocesses history is visibly worse than one that reads it back;
 * the verdict is the cache split the client itself receives
 * (usage.prompt_tokens_details.cached_tokens).
 *
 * Needs a production build (`npx next build --webpack`) and port 21986 free.
 */
import { spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { startFakeAnthropic } from "./lib/fake-anthropic.mjs";
import { diffPrefix, formatDiff } from "./lib/diff-prompt-prefix.mjs";

const ROOT = process.env.ROUTER_ROOT
  || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const PORT = 21986;
const PASSWORD = "claude-cli-cache-offline-password";
const MODEL = "claude-cli/claude-cli-haiku";
const MODES = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const LIVE = process.argv.includes("--live");
const RUN = MODES.length ? MODES : ["plain", "relay", "session", "seeded", "session-tools", "session-record", "session-concurrent", "session-abort"];
const REQUEST_TIMEOUT_MS = 90000;

const bin = process.env.CLI_CLAUDE_BIN
  || [path.join(os.homedir(), ".local", "bin", "claude"), "/usr/local/bin/claude", "/opt/homebrew/bin/claude"].find((p) => fs.existsSync(p));

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? `\n        ${detail}` : ""}`);
};

const call = (opts, body) => new Promise((resolve, reject) => {
  const r = http.request({ host: "127.0.0.1", port: PORT, timeout: REQUEST_TIMEOUT_MS, ...opts }, (res) => {
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

async function withServer(extraEnv, fn) {
  const started = Date.now();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "9r-cache-offline-"));
  const env = { ...process.env };
  delete env.JWT_SECRET;
  // The host's own login must not be what the child uses; the stand-in token
  // attached below is.
  delete env.CLAUDE_CODE_OAUTH_TOKEN;
  const server = spawn(process.execPath,
    [path.join(ROOT, "node_modules", "next", "dist", "bin", "next"), "start", "--port", String(PORT)], {
      cwd: ROOT,
      env: {
        ...env,
        DATA_DIR: dataDir,
        INITIAL_PASSWORD: PASSWORD,
        PORT: String(PORT),
        CLI_CLAUDE_BIN: bin,
        NODE_OPTIONS: `--require "${path.join(ROOT, "custom-server.js").replace(/\\/g, "/")}"`,
        ...extraEnv,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
  let log = "";
  server.stdout.on("data", (d) => { log += d; });
  server.stderr.on("data", (d) => { log += d; });
  try {
    await waitFor(async () => (await call({ method: "GET", path: "/api/health" })).status < 500, 240000, "the built server");
    const login = await call({ method: "POST", path: "/api/auth/login", headers: { "content-type": "application/json" } },
      JSON.stringify({ password: PASSWORD }));
    const m = /auth_token=([^;]+)/.exec([].concat(login.headers["set-cookie"] || []).join("; "));
    if (!m) throw new Error("no session cookie from login");
    const json = { cookie: `auth_token=${m[1]}`, "content-type": "application/json" };
    const account = await call({ method: "POST", path: "/api/cli-tools/claude-cli-accounts", headers: json },
      JSON.stringify(LIVE
        ? { adoptHost: true }
        : { oauthToken: "sk-ant-oat01-stand-in-for-a-fake-upstream", name: "Fake upstream" }));
    // Live on a desktop whose login is in the OS keychain, there is no file for
    // adoptHost to find; the provider then runs the host's own login, which is
    // the account this is meant to use anyway.
    if (!account.json?.account?.id && !LIVE) throw new Error(`no account: ${account.body.slice(0, 200)}`);
    const keyRes = await call({ method: "POST", path: "/api/keys", headers: json }, JSON.stringify({ name: "cache-offline" }));
    const apiKey = keyRes.json?.apiKey?.key || keyRes.json?.key || keyRes.json?.apiKey;
    if (!apiKey) throw new Error(`no API key: ${keyRes.body.slice(0, 200)}`);
    const complete = (payload) => call({
      method: "POST",
      path: "/v1/chat/completions",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    }, JSON.stringify(payload));
    complete.apiKey = apiKey;
    const connectionId = account.json?.account?.id || null;
    return await fn({ complete, log: () => log, call, cookie: json.cookie, connectionId });
  } finally {
    server.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 1500));
    try { server.kill("SIGKILL"); } catch { /* gone */ }
    fs.rmSync(dataDir, { recursive: true, force: true });
    // Sessions the server wrote and, killed, never got to expire. Only this
    // provider's marked directories, and only ones this run created.
    const projects = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude"), "projects");
    for (const name of fs.existsSync(projects) ? fs.readdirSync(projects) : []) {
      if (!name.includes("9router-claude-")) continue;
      const dir = path.join(projects, name);
      try { if (fs.statSync(dir).mtimeMs >= started) fs.rmSync(dir, { recursive: true, force: true }); } catch { /* gone */ }
    }
  }
}

const SYSTEM = [
  "You answer in one short sentence.",
  ...Array.from({ length: 400 }, (_, i) => `Reference fact ${i}: marker ${i} is on shelf ${i * 13 % 997}.`),
].join("\n");
const PADDING = (n) => ` Context for this question, to be ignored: ${Array.from({ length: 120 }, (_, i) => `note ${n}.${i} is filler text`).join("; ")}.`;
const QUESTIONS = ["Which shelf holds marker 3?", "And marker 5?", "And marker 8?"]
  .map((q, i) => (LIVE ? q + PADDING(i) : q));

/** The user/assistant order the model was shown, ignoring the CLI's reminder blocks. */
function turnOrder(body) {
  return (body?.messages || []).map((m) => {
    const c = typeof m.content === "string" ? [{ type: "text", text: m.content }] : m.content;
    const texts = c.filter((b) => b.type === "text" && !/^<system-reminder>/.test(b.text)).map((b) => b.text.slice(0, 12));
    return `${m.role[0]}:${texts.join("+")}`;
  });
}

async function conversation(mode, extraEnv) {
  console.log(`\n── ${mode} ──`);
  const fake = LIVE ? null : await startFakeAnthropic();
  try {
    await withServer({ ...(fake ? { CLI_CLAUDE_UPSTREAM_OVERRIDE: fake.url } : {}), ...extraEnv }, async ({ complete, log }) => {
      const messages = [{ role: "system", content: SYSTEM }];
      const turns = [];
      for (const [t, q] of QUESTIONS.entries()) {
        if (mode === "seeded" && t > 0) {
          // Replace what this server answered with what "another" server
          // would have: the history is then one this process never saw.
          messages[messages.length - 1] = { role: "assistant", content: `answer from elsewhere ${t}` };
        }
        messages.push({ role: "user", content: q });
        const before = fake ? fake.bodies.length : 0;
        const started = Date.now();
        let res;
        try {
          res = await complete({ model: MODEL, messages, stream: false });
        } catch (e) {
          res = { status: 0, body: e.message, json: null };
        }
        const ms = Date.now() - started;
        const content = res.json?.choices?.[0]?.message?.content || "";
        const bodies = fake ? fake.bodies.slice(before) : [];
        const usage = res.json?.usage || null;
        turns.push({ body: bodies.length ? JSON.parse(bodies.at(-1)) : null, usage });
        console.log(`  · turn ${t + 1}: status=${res.status} ${ms}ms`
          + (fake ? ` upstream requests=${bodies.length}` : "")
          + ` prompt=${usage?.prompt_tokens ?? "?"} cached=${usage?.prompt_tokens_details?.cached_tokens ?? "?"}`
          + ` content=${JSON.stringify(content).slice(0, 60)}`);
        check(`${mode} turn ${t + 1} is answered${fake ? ", through the fake," : ""} in under 30s`,
          res.status === 200 && (fake ? /fake answer/.test(content) && bodies.length >= 1 : content.length > 0) && ms < 30000,
          res.status === 200 ? "" : `body=${String(res.body).slice(0, 300)}`);
        messages.push({ role: "assistant", content: content || "(nothing)" });
      }
      const reuse = [];
      if (LIVE) {
        for (let t = 1; t < turns.length; t += 1) {
          const prev = turns[t - 1].usage?.prompt_tokens || 0;
          const read = turns[t].usage?.prompt_tokens_details?.cached_tokens || 0;
          reuse.push(prev ? read / prev >= 0.8 : false);
          console.log(`        turn ${t + 1}: read ${read} of the previous turn's ${prev} prompt tokens (${prev ? Math.round((read / prev) * 100) : 0}%)`);
        }
      }
      for (let t = 1; !LIVE && t < turns.length; t += 1) {
        if (!turns[t - 1].body || !turns[t].body) { reuse.push(null); continue; }
        const d = diffPrefix(turns[t - 1].body, turns[t].body);
        console.log(formatDiff(d).split("\n").map((l) => `        ${l}`).join("\n"));
        reuse.push(d.earlierBreakpointReused);
      }
      const lines = log().split("\n").filter((l) => /CLAUDE-CLI/.test(l) && /cache relay|session=|cache_read=/.test(l));
      for (const l of lines.slice(-8)) console.log(`        log: ${l.trim().slice(0, 220)}`);
      if (fake?.other.length) console.log(`        other requests: ${[...new Set(fake.other)].join(", ")}`);
      const last = turns.at(-1)?.body;
      if (last) console.log(`        order the model saw on turn 3: ${JSON.stringify(turnOrder(last))}`);
      if (mode === "plain" && last) {
        // Documented, not judged: this is the fold the seeded path fixes.
        const order = turnOrder(last);
        console.log(`        plain: history folded (assistant first, questions inside the newest turn): ${order[0]?.startsWith("a:")}`);
      }
      if (mode === "seeded" && last) {
        const order = turnOrder(last);
        check("seeded: the model sees the history in order — user, assistant, user, assistant, user",
          order.length === 5 && order[0].startsWith("u:Which") && order[1].startsWith("a:") && order[2].startsWith("u:And marker 5") && order[3].startsWith("a:") && order[4].startsWith("u:And marker 8"),
          JSON.stringify(order));
        check("seeded: turn 3 was a resume of a transcript this process wrote", lines.some((l) => /session=seeded/.test(l)), lines.join(" | ").slice(0, 300));
      }
      if (mode === "relay") {
        // Reported, not judged. Measured 2026-09-24: the relay answers inside
        // the Next server, but it cannot make the prefix recur — the replay
        // folds history into the newest user turn, so the divergence is
        // earlier than any breakpoint it could move. Superseded by the session
        // cache; kept runnable so a future CLI that replays in order can be
        // re-measured.
        console.log(`        relay reuse per turn (informational): ${JSON.stringify(reuse)}`);
      } else if (mode === "plain") {
        check("plain: today's path misses (the bug being fixed)", reuse.every((r) => r === false), JSON.stringify(reuse));
      } else if (mode === "seeded") {
        // Every turn here carries an answer this server never gave, so no
        // prefix can recur; what seeding fixes is order, judged above.
      } else {
        check(`${mode}: each turn repeats the previous prefix through its breakpoint`, reuse.length > 0 && reuse.every((r) => r === true), JSON.stringify(reuse));
      }
    });
  } finally {
    if (fake) await fake.close();
  }
}

if (!bin) { console.log("  SKIP  no claude binary"); process.exit(0); }
if (!fs.existsSync(path.join(ROOT, ".next", "BUILD_ID"))) {
  console.log("  SKIP  no production build — run `npx next build --webpack` first");
  process.exit(0);
}

const SESSION_ENV = { CLI_CLAUDE_SESSION_CACHE: "1", CLI_CLAUDE_CACHE_RELAY: "0" };
const TOOLS = [{ type: "function", function: { name: "get_weather", description: "Weather for a city.", parameters: { type: "object", properties: { city: { type: "string" } }, required: ["city"] } } }];

async function toolConversation() {
  console.log("\n── session-tools ──");
  // Offline, the first model call proposes the tool and every later one
  // answers in text. Live, haiku is asked to call it.
  const fake = LIVE ? null : await startFakeAnthropic({
    toolCall: (n, body) => (n === 1 && Array.isArray(body.tools) && body.tools.length
      ? { name: body.tools.find((t) => /get_weather/.test(t.name))?.name || body.tools[0].name, input: { city: "Seoul" } }
      : null),
  });
  try {
    await withServer({ ...(fake ? { CLI_CLAUDE_UPSTREAM_OVERRIDE: fake.url } : {}), ...SESSION_ENV }, async ({ complete, log }) => {
      const messages = [{ role: "system", content: SYSTEM }, { role: "user", content: LIVE
        ? "Use the get_weather tool to look up the weather in Seoul, then tell me in one sentence." + PADDING(0)
        : "What is the weather in Seoul?" }];
      const first = await complete({ model: MODEL, messages, tools: TOOLS, stream: false });
      const calls = first.json?.choices?.[0]?.message?.tool_calls || [];
      console.log(`  · turn 1: status=${first.status} finish=${first.json?.choices?.[0]?.finish_reason} calls=${JSON.stringify(calls).slice(0, 160)}`);
      check("session-tools turn 1 proposes the call", first.status === 200 && calls[0]?.function?.name === "get_weather",
        String(first.body).slice(0, 300));
      const bodiesBefore = fake ? fake.bodies.length : 0;
      messages.push({ role: "assistant", content: first.json?.choices?.[0]?.message?.content ?? null, tool_calls: calls.map((c) => ({ ...c, function: { ...c.function, arguments: JSON.stringify(JSON.parse(c.function.arguments || "{}"), null, 1) } })) });
      for (const c of calls) messages.push({ role: "tool", tool_call_id: c.id, content: "sunny, 21C" });
      const second = await complete({ model: MODEL, messages, tools: TOOLS, stream: false });
      const content = second.json?.choices?.[0]?.message?.content || "";
      const u2 = second.json?.usage;
      console.log(`  · turn 2: status=${second.status} prompt=${u2?.prompt_tokens ?? "?"} cached=${u2?.prompt_tokens_details?.cached_tokens ?? "?"} content=${JSON.stringify(content).slice(0, 120)}`);
      check("session-tools turn 2 (a tool result) is answered", second.status === 200 && (fake ? /fake answer/.test(content) : content.length > 0), String(second.body).slice(0, 300));
      if (LIVE) {
        check("session-tools live: the answer uses the client's tool result, not the CLI's denial",
          /sunny|21/i.test(content) && !/permission|denied/i.test(content), content.slice(0, 200));
      }
      const lines = log().split("\n").filter((l) => /session=/.test(l));
      for (const l of lines.slice(-4)) console.log(`        log: ${l.trim().slice(0, 200)}`);
      check("session-tools turn 2 did not resume the tool-call turn (it replayed fresh)",
        !lines.some((l) => /session=resumed/.test(l)) && lines.filter((l) => /session=new/.test(l)).length >= 2, lines.join(" | ").slice(0, 300));
      const turn2 = fake ? fake.bodies.at(-1) : null;
      if (turn2) {
        const flat = JSON.stringify(JSON.parse(turn2).messages);
        check("session-tools: the client's tool result reaches the model, and the CLI's denial does not",
          /sunny, 21C/.test(flat) && !/Permission to use/.test(flat), flat.slice(0, 300));
      }
    });
  } finally {
    if (fake) await fake.close();
  }
}

/** The card and the record say what the cache did. */
async function recordConversation() {
  console.log("\n── session-record ──");
  const fake = await startFakeAnthropic();
  try {
    await withServer({
      CLI_CLAUDE_UPSTREAM_OVERRIDE: fake.url, ...SESSION_ENV,
      ENABLE_REQUEST_LOGS: "true", OBSERVABILITY_ENABLED: "true", OBSERVABILITY_INCLUDE_PAYLOADS: "true",
    }, async ({ complete, call, cookie, connectionId }) => {
      const messages = [{ role: "system", content: SYSTEM }, { role: "user", content: QUESTIONS[0] }];
      const first = await complete({ model: MODEL, messages, stream: false });
      messages.push({ role: "assistant", content: first.json?.choices?.[0]?.message?.content || "" }, { role: "user", content: QUESTIONS[1] });
      const second = await complete({ model: MODEL, messages, stream: false });
      check("session-record: both turns answered", first.status === 200 && second.status === 200);

      const usage = await call({ method: "GET", path: `/api/usage/${connectionId}`, headers: { cookie } });
      const message = String(usage.json?.message || usage.json?.data?.message || JSON.stringify(usage.json || {}));
      console.log(`  · quota card message: ${message.slice(0, 220)}`);
      check("session-record: the quota card carries the account's prompt-cache share", /Prompt cache: \d+% of [\d,]+ prompt tokens/.test(message), message.slice(0, 300));

      await new Promise((r) => setTimeout(r, 6000));
      const details = await call({ method: "GET", path: "/api/usage/request-details?pageSize=20", headers: { cookie } });
      const rows = (details.json?.details || []).map((d) => d.providerRequest).filter((p) => p && typeof p === "object");
      const resumed = rows.find((p) => p.session === "resumed" || p.conversation?.session === "resumed");
      const shapes = rows.map((p) => p.conversation).filter(Boolean);
      console.log(`  · recorded rows=${rows.length} sessions=${JSON.stringify(rows.map((p) => p.conversation?.session || p.session || null))}`);
      check("session-record: a Request Details row says which turn was resumed", Boolean(resumed),
        JSON.stringify(rows.map((p) => ({ session: p.session, shape: p.conversation?.session }))).slice(0, 300));
      check("session-record: the record carries the cache split, written before the child exited",
        shapes.some((s) => s.cache && typeof s.cache.cacheRead === "number"), JSON.stringify(shapes.map((s) => s.cache)).slice(0, 300));
    });
  } finally {
    await fake.close();
  }
}

/** Two identical requests at once: one continuation survives, nothing leaks. */
async function concurrentConversation() {
  console.log("\n── session-concurrent ──");
  const fake = await startFakeAnthropic({ delayMs: 400 });
  try {
    await withServer({ CLI_CLAUDE_UPSTREAM_OVERRIDE: fake.url, ...SESSION_ENV }, async ({ complete, log }) => {
      const messages = [{ role: "system", content: SYSTEM }, { role: "user", content: QUESTIONS[0] }];
      const first = await complete({ model: MODEL, messages, stream: false });
      messages.push({ role: "assistant", content: first.json?.choices?.[0]?.message?.content || "" }, { role: "user", content: QUESTIONS[1] });
      const [a, b] = await Promise.all([complete({ model: MODEL, messages, stream: false }), complete({ model: MODEL, messages, stream: false })]);
      check("session-concurrent: both simultaneous requests are answered", a.status === 200 && b.status === 200,
        `a=${a.status} b=${b.status}`);
      const answers = [a, b].map((r) => r.json?.choices?.[0]?.message?.content || "");
      // Turn 3 continues from whichever answer the client keeps; the other
      // session must be gone from disk, not waiting for a TTL that nothing tracks.
      messages.push({ role: "assistant", content: answers[0] }, { role: "user", content: QUESTIONS[2] });
      const third = await complete({ model: MODEL, messages, stream: false });
      check("session-concurrent: a third turn is answered", third.status === 200);
      await new Promise((r) => setTimeout(r, 1500));
      const lines = log().split("\n").filter((l) => /session=/.test(l));
      for (const l of lines.slice(-6)) console.log(`        log: ${l.trim().slice(0, 160)}`);
      const projects = path.join(os.homedir(), ".claude", "projects");
      const live = fs.readdirSync(projects).filter((d) => /9router-claude-[A-Za-z0-9]{6}-sessions-/.test(d))
        .flatMap((d) => fs.readdirSync(path.join(projects, d)).filter((f) => f.endsWith(".jsonl")));
      console.log(`  · transcripts on disk after the run: ${live.length}`);
      // Exactly one live continuation (turn 3's), or two when the concurrent
      // loser finished after turn 3 began and is still within its TTL as a
      // separate entry; never the three-plus that a leak would leave.
      check("session-concurrent: at most one transcript per surviving continuation", live.length <= 2, `files=${live.length}`);
    });
  } finally {
    await fake.close();
  }
}

/** A client that leaves mid-turn on a resumed session. */
async function abortConversation() {
  console.log("\n── session-abort ──");
  let hold = 0;
  const fake = await startFakeAnthropic({ delayMs: 0 });
  const slow = await startFakeAnthropic({ delayMs: 4000 });
  try {
    // Turn 1 fast, so the session exists; turn 2 is held long enough to abort.
    await withServer({ CLI_CLAUDE_UPSTREAM_OVERRIDE: fake.url, ...SESSION_ENV }, async ({ complete, log }) => {
      const messages = [{ role: "system", content: SYSTEM }, { role: "user", content: QUESTIONS[0] }];
      const first = await complete({ model: MODEL, messages, stream: false });
      messages.push({ role: "assistant", content: first.json?.choices?.[0]?.message?.content || "" }, { role: "user", content: QUESTIONS[1] });
      // The fake cannot be swapped under a running server, so abort by
      // giving the client a timeout shorter than the CLI's own startup.
      const aborted = await new Promise((resolve) => {
        const r = http.request({ host: "127.0.0.1", port: PORT, path: "/v1/chat/completions", method: "POST", timeout: 250,
          headers: { "content-type": "application/json", authorization: `Bearer ${apiKeyOf(complete)}` } }, (res) => resolve({ status: res.statusCode }));
        r.on("timeout", () => { r.destroy(new Error("client left")); resolve({ status: 0 }); });
        r.on("error", () => resolve({ status: 0 }));
        r.end(JSON.stringify({ model: MODEL, messages, stream: true }));
      });
      console.log(`  · turn 2 aborted by the client: status=${aborted.status}`);
      await new Promise((r) => setTimeout(r, 3000));
      const third = await complete({ model: MODEL, messages, stream: false });
      check("session-abort: the turn after an abandoned resume is still answered", third.status === 200, String(third.body).slice(0, 200));
      const lines = log().split("\n").filter((l) => /session=|slot|gate/.test(l));
      for (const l of lines.slice(-6)) console.log(`        log: ${l.trim().slice(0, 160)}`);
      check("session-abort: the abandoned turn's session was not continued (the next turn started over)",
        /session=(new|seeded|resumed)/.test(lines.at(-1) || "") && !new RegExp(`id=${(lines.find((l) => /session=resumed/.test(l)) || "").match(/id=([0-9a-f]+)/)?.[1] || "nomatch"}`).test(lines.at(-1) || ""),
        lines.slice(-3).join(" | ").slice(0, 300));
      hold = lines.length;
    });
  } finally {
    await fake.close();
    await slow.close();
  }
  return hold;
}

function apiKeyOf(complete) { return complete.apiKey; }

for (const mode of RUN) {
  if (mode === "plain") await conversation("plain", { CLI_CLAUDE_CACHE_RELAY: "0", CLI_CLAUDE_SESSION_CACHE: "0" });
  else if (mode === "relay") await conversation("relay", { CLI_CLAUDE_CACHE_RELAY: "1", CLI_CLAUDE_SESSION_CACHE: "0" });
  else if (mode === "session") await conversation("session", { CLI_CLAUDE_CACHE_RELAY: "0", CLI_CLAUDE_SESSION_CACHE: "1" });
  else if (mode === "seeded" && !LIVE) await conversation("seeded", { CLI_CLAUDE_CACHE_RELAY: "0", CLI_CLAUDE_SESSION_CACHE: "1" });
  else if (mode === "session-tools") await toolConversation();
  else if (mode === "session-record" && !LIVE) await recordConversation();
  else if (mode === "session-concurrent" && !LIVE) await concurrentConversation();
  else if (mode === "session-abort" && !LIVE) await abortConversation();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
