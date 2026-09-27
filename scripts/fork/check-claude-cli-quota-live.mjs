/**
 * Claude Code CLI quota, live, against a real subscription.
 *
 *   node scripts/fork/check-claude-cli-quota-live.mjs
 *
 * The complaint this exists for: every other provider's card shows a bar, a
 * percentage and a reset countdown, and claude-cli showed none of them. It was
 * being served counters this server had tallied itself, because its connections
 * carry authType "none" and that was read as "no upstream quota".
 *
 * It has one. claude-cli holds an ordinary Claude subscription, and the same
 * OAuth usage endpoint the `claude` provider reads answers for it. So the thing
 * worth asserting is parity: /api/usage/<id> must come back with the real
 * `session (5h)` / `weekly (7d)` windows, each with a percentage and a reset
 * that parses — not with routed counters.
 *
 * Both paths are checked, because the fallback still has to work:
 *   - the host's own Claude Code login  -> real windows;
 *   - an account with a bogus token     -> routed counters, not an error page.
 *
 * It also sends one real `/v1/chat/completions` through the CLI, so "the
 * account works" is proven rather than assumed. That spends one small Claude
 * request on whatever account this machine is logged into.
 *
 * Skips instead of failing when `claude` is missing or not signed in.
 *
 * NOTE on TLS: where outbound HTTPS is intercepted (a corporate proxy with a
 * self-signed root), the upstream usage call fails and the server correctly
 * falls back to routed counters — which this check then reports as a FAIL,
 * because it cannot tell that apart from the bug. Run it as
 * `NODE_TLS_REJECT_UNAUTHORIZED=0 node scripts/fork/check-claude-cli-quota-live.mjs`
 * on such a machine. Set it in the shell that launches the check and nowhere
 * else — never in the app, the Dockerfile, or a default.
 *
 * Needs port 21999 free.
 */
import { spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = process.env.ROUTER_ROOT
  || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const PORT = 21999;
const PASSWORD = "claude-cli-quota-live-password";
const DATA_DIR = path.join(os.tmpdir(), `9r-claude-cli-quota-${Date.now()}`);

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : `\n        ${detail}`}`);
};

const call = (opts, body) => new Promise((resolve, reject) => {
  const r = http.request({ host: "127.0.0.1", port: PORT, timeout: 300000, ...opts }, (res) => {
    let data = "";
    res.on("data", (c) => { data += c; });
    res.on("end", () => {
      let json = null;
      try { json = JSON.parse(data); } catch { /* sse or html */ }
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

/** A window is only useful to the card if it can draw a bar and a countdown. */
const isRenderableWindow = (q) => Boolean(q)
  && q.unlimited === false
  && Number.isFinite(Number(q.used))
  && Number.isFinite(Number(q.remaining))
  && Number(q.remaining) >= 0 && Number(q.remaining) <= 100
  && Number.isFinite(new Date(q.resetAt).getTime());

let server;
let log = "";
try {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const env = { ...process.env };
  delete env.JWT_SECRET;
  server = spawn(process.execPath,
    [path.join(ROOT, "node_modules", "next", "dist", "bin", "next"), "dev", "--webpack", "--port", String(PORT)], {
      cwd: ROOT,
      env: {
        ...env,
        DATA_DIR,
        INITIAL_PASSWORD: PASSWORD,
        NODE_OPTIONS: `--require "${path.join(ROOT, "custom-server.js").replace(/\\/g, "/")}"`,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
  server.stdout.on("data", (d) => { log += d; });
  server.stderr.on("data", (d) => { log += d; });

  await waitFor(async () => (await call({ method: "GET", path: "/api/health" })).status < 500,
    240000, "next dev to answer");

  const login = await call({ method: "POST", path: "/api/auth/login", headers: { "content-type": "application/json" } },
    JSON.stringify({ password: PASSWORD }));
  const m = /auth_token=([^;]+)/.exec([].concat(login.headers["set-cookie"] || []).join("; "));
  if (!m) throw new Error("no session cookie from login");
  const cookie = `auth_token=${m[1]}`;
  const json = { cookie, "content-type": "application/json" };

  // Needs a real, signed-in Claude Code on this machine — a fabricated token
  // proves only the fallback, which is checked separately at the end.
  const accounts = await call({ method: "GET", path: "/api/cli-tools/claude-cli-accounts", headers: { cookie } });
  if (!accounts.json?.installed || !accounts.json?.host?.signedIn) {
    console.log("  SKIP  claude-cli quota (needs Claude Code installed and signed in on this machine)");
    process.exit(0);
  }

  // Read here so a token account can be built from a credential known to work,
  // which separates "this token is not accepted" from "this path is broken".
  const hostCredFile = path.join(
    process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude"), ".credentials.json",
  );
  let hostAccessToken = "";
  try {
    hostAccessToken = JSON.parse(fs.readFileSync(hostCredFile, "utf8"))?.claudeAiOauth?.accessToken || "";
  } catch { /* asserted where it is used */ }

  const adopted = await call({ method: "POST", path: "/api/cli-tools/claude-cli-accounts", headers: json },
    JSON.stringify({ adoptHost: true }));
  const id = adopted.json?.account?.id;
  check("the host's Claude Code account can be adopted", Boolean(id),
    `status=${adopted.status} body=${adopted.body.slice(0, 200)}`);
  if (!id) throw new Error("cannot continue without an account");

  // The assertion the user's complaint maps to: real windows, not counters.
  const usage = await call({ method: "GET", path: `/api/usage/${encodeURIComponent(id)}`, headers: { cookie } });
  const quotas = usage.json?.quotas || {};
  const keys = Object.keys(quotas);
  const shape = (k) => `${k}=${JSON.stringify(quotas[k])}`;

  check("usage returns the real subscription windows, not routed counters",
    keys.includes("session (5h)") && keys.includes("weekly (7d)"),
    `quotas=${JSON.stringify(keys)} message=${usage.json?.message || ""}`);

  check("the 5h window can draw a bar, a percentage and a reset",
    isRenderableWindow(quotas["session (5h)"]), shape("session (5h)"));

  check("the 7d window can draw a bar, a percentage and a reset",
    isRenderableWindow(quotas["weekly (7d)"]), shape("weekly (7d)"));

  check("...and the reset times are in the future, so a countdown reads forward",
    ["session (5h)", "weekly (7d)"].every((k) => new Date(quotas[k]?.resetAt).getTime() > Date.now()),
    ["session (5h)", "weekly (7d)"].map(shape).join(" "));

  check("nothing is left flagged unlimited on this account",
    Object.values(quotas).every((q) => q.unlimited !== true),
    JSON.stringify(quotas).slice(0, 200));

  check("the plan is reported, the way the claude card reports it",
    typeof usage.json?.plan === "string" && usage.json.plan.length > 0,
    `plan=${JSON.stringify(usage.json?.plan)}`);

  // Proves the adopted account is genuinely usable, not just readable.
  const keyRes = await call({ method: "POST", path: "/api/keys", headers: json },
    JSON.stringify({ name: "claude-cli-quota-live-check" }));
  const apiKey = keyRes.json?.apiKey?.key || keyRes.json?.key || keyRes.json?.apiKey;
  check("an API key can be minted for the routed request",
    typeof apiKey === "string" && apiKey.length > 0,
    `status=${keyRes.status} body=${keyRes.body.slice(0, 200)}`);

  const completion = await call({
    method: "POST",
    path: "/v1/chat/completions",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
  }, JSON.stringify({
    model: "claude-cli/claude-cli-haiku",
    messages: [{ role: "user", content: "Reply with the single word: ok" }],
    stream: false,
  }));
  check("a real request still routes through the Claude Code CLI",
    completion.status === 200 && Boolean(completion.json?.choices?.length),
    `status=${completion.status} body=${completion.body.slice(0, 300)}`);

  // force=1 is what Recheck sends; it must bypass the 5-minute usage cache
  // and still come back with real windows rather than a soft failure.
  const forced = await call({ method: "GET", path: `/api/usage/${encodeURIComponent(id)}?force=1`, headers: { cookie } });
  check("a forced recheck returns real windows too",
    isRenderableWindow(forced.json?.quotas?.["session (5h)"]),
    `body=${forced.body.slice(0, 200)}`);

  // A token account, which is the other kind and the only one that works in a
  // container. Every assertion above used the host's config directory; a token
  // account reaching the fallback was reported from a real install while these
  // checks were green, because this path was never exercised with a credential
  // that works.
  const asToken = await call({ method: "POST", path: "/api/cli-tools/claude-cli-accounts", headers: json },
    JSON.stringify({ oauthToken: hostAccessToken, name: "Token account check" }));
  const tokenId = asToken.json?.account?.id;
  if (tokenId) {
    const tokenUsage = await call({ method: "GET", path: `/api/usage/${encodeURIComponent(tokenId)}`, headers: { cookie } });
    check("a token account reports the same real windows as a config directory",
      isRenderableWindow(tokenUsage.json?.quotas?.["session (5h)"]),
      `status=${tokenUsage.status} keys=${JSON.stringify(Object.keys(tokenUsage.json?.quotas || {}))} `
        + `message=${tokenUsage.json?.message || ""}`);
  } else {
    check("a token account could be created", false, `body=${asToken.body.slice(0, 200)}`);
  }

  // The fallback still has to hold: an account whose credential upstream will
  // not accept must degrade to routed counters, not to an error on the card —
  // and must say why, so it is not mistaken for an account with no credential.
  const bogus = await call({ method: "POST", path: "/api/cli-tools/claude-cli-accounts", headers: json },
    JSON.stringify({ oauthToken: "sk-ant-oat01-not-a-real-token", name: "Fallback account" }));
  const bogusId = bogus.json?.account?.id;
  if (bogusId) {
    const fb = await call({ method: "GET", path: `/api/usage/${encodeURIComponent(bogusId)}`, headers: { cookie } });
    const fbQuotas = fb.json?.quotas || {};
    check("an account upstream rejects falls back to routed counters",
      Object.keys(fbQuotas).some((k) => k.startsWith("routed ")),
      `status=${fb.status} quotas=${JSON.stringify(Object.keys(fbQuotas))}`);
    check("...and the card says why, instead of falling back in silence",
      /could not be read|No credential could be resolved/.test(fb.json?.message || ""),
      `message=${fb.json?.message || "(none)"}`);
    check("...and those counters are flagged unlimited, inventing no reset",
      Object.values(fbQuotas).length > 0
        && Object.values(fbQuotas).every((q) => q.unlimited === true && q.resetAt === null),
      JSON.stringify(fbQuotas).slice(0, 200));
  } else {
    check("a fallback account could be created", false, `body=${bogus.body.slice(0, 200)}`);
  }
} catch (e) {
  check("harness completed", false, e.message);
} finally {
  if (server) server.kill();
  try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch { /* best effort */ }
}

const pass = results.filter((r) => r.ok).length;
if (pass !== results.length) console.log(`\n--- server log tail ---\n${log.slice(-3000)}`);
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
