/**
 * Does `claude -p --resume` keep the prompt cache alive across turns?
 *
 *   node scripts/fork/check-claude-cli-resume-cache.mjs --offline   # no account usage
 *   node scripts/fork/check-claude-cli-resume-cache.mjs --live      # three short haiku turns per arm
 *
 * The gate for the session cache (docs/fable/2026-09-24-claude-cli-prompt-cache-plan.md,
 * Phase 2.0). Runs the real `claude` binary directly, not through 9Router,
 * with the same argv the executor builds.
 *
 * --offline points the child at a local stand-in for the API
 * (lib/fake-anthropic.mjs) and compares the bodies the CLI sends. It answers
 * the question the whole approach rests on — does a resumed turn repeat the
 * previous turn byte for byte, including what the CLI appended to it — without
 * spending anything. Nothing reaches Anthropic; the host login's credential
 * goes to loopback only and is never written down.
 *
 * --live runs the same arms against the real API and reads the cache split the
 * CLI reports. It spends a few haiku requests on the host's default login and
 * nothing else; routed 9Router connections are not touched.
 *
 * Arms:
 *   control   today's path: every turn replays the whole conversation, no session
 *   resume    turn 1 creates a session with --session-id, later turns --resume it with one new frame
 *   replayed  as resume, but turn 1 already carries history (the case after a 9Router restart)
 *
 * Every session file this creates is deleted before it exits.
 */
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildClaudeCliArgs, resolveClaudeBin } from "../../open-sse/executors/claude-cli.js";
import { framesToStdin } from "../../open-sse/executors/claudeCliReplay.js";
import { startFakeAnthropic } from "./lib/fake-anthropic.mjs";
import { diffPrefix, formatDiff } from "./lib/diff-prompt-prefix.mjs";

const LIVE = process.argv.includes("--live");
const MODEL = process.env.CHECK_MODEL || "claude-cli-haiku";
const bin = process.env.CLI_CLAUDE_BIN || resolveClaudeBin();
if (!bin) { console.log("  SKIP  no claude binary"); process.exit(0); }

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? `\n        ${detail}` : ""}`);
};

// Large enough that the cached prefix dwarfs everything else in the turn, and
// far over the 1024/2048-token minimum a cache entry needs.
const SYSTEM = [
  "You answer in one short sentence. Never use tools.",
  ...Array.from({ length: 900 }, (_, i) => `Reference fact ${i}: the ${i % 7 === 0 ? "blue" : "green"} marker is filed under shelf ${i * 13 % 997}.`),
].join("\n");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "9router-claude-gate-"));
const systemFile = path.join(root, "system.md");
fs.writeFileSync(systemFile, SYSTEM);

const baseEnv = () => {
  const env = {};
  for (const key of ["PATH", "HOME", "USER", "LOGNAME", "SHELL", "TMPDIR", "LANG", "TZ",
    "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "no_proxy", "CLAUDE_CONFIG_DIR"]) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  Object.assign(env, {
    CLAUDE_CODE_MAX_RETRIES: "0",
    DISABLE_AUTO_COMPACT: "1",
    DISABLE_COMPACT: "1",
    ENABLE_TOOL_SEARCH: "false",
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
    CLAUDE_CODE_TOTAL_TOKENS_REMINDER: "off",
  });
  return env;
};

const user = (text, history = false) => ({
  type: "user", message: { role: "user", content: [{ type: "text", text }] }, ...(history ? { shouldQuery: false } : {}),
});
const assistant = (text) => ({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text }] } });

function argsFor({ sessionId, resumeId, persist }) {
  const args = buildClaudeCliArgs({ model: MODEL, maxTurns: 1, streamJsonInput: true });
  const out = persist ? args.filter((a) => a !== "--no-session-persistence") : args;
  if (resumeId) out.push("--resume", resumeId);
  else if (sessionId) out.push("--session-id", sessionId);
  out.push("--system-prompt-file", systemFile);
  return out;
}

function runTurn({ args, frames, cwd, env }) {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { err = (err + d).slice(-2000); });
    const timer = setTimeout(() => child.kill("SIGKILL"), 120000);
    child.on("close", (code) => {
      clearTimeout(timer);
      const events = out.split("\n").filter((l) => l.trim().startsWith("{")).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
      const results = events.filter((e) => e.type === "result" && !(e.num_turns === 0 && e.is_error !== true));
      const result = results.at(-1) || null;
      const text = events.filter((e) => e.type === "assistant")
        .flatMap((e) => e.message?.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
      resolve({ code, result, usage: result?.usage || null, text: text || result?.result || "", stderr: err, sessionId: result?.session_id || events.find((e) => e.session_id)?.session_id });
    });
    child.stdin.on("error", () => {});
    child.stdin.end(framesToStdin(frames));
  });
}

const created = new Set();
function removeSessionFiles() {
  const configDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
  const projects = path.join(configDir, "projects");
  if (!fs.existsSync(projects)) return 0;
  let removed = 0;
  for (const dir of fs.readdirSync(projects)) {
    if (!dir.includes("9router-claude-gate-")) continue;
    fs.rmSync(path.join(projects, dir), { recursive: true, force: true });
    removed += 1;
  }
  return removed;
}

const summary = (u) => (u ? `input=${u.input_tokens || 0} create=${u.cache_creation_input_tokens || 0} read=${u.cache_read_input_tokens || 0}` : "no usage");
const promptOf = (u) => (u ? (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0) : 0);

let fake = null;
try {
  const env = baseEnv();
  if (!LIVE) {
    fake = await startFakeAnthropic({ dir: path.join(root, "captured") });
    env.ANTHROPIC_BASE_URL = fake.url;
  }
  console.log(`claude ${bin} · model ${MODEL} · ${LIVE ? "LIVE" : "offline (fake upstream)"}`);

  const QUESTIONS = ["Which shelf holds marker 3?", "And marker 5?", "And marker 8?"];

  // Each arm returns, per turn, the body the fake captured (offline) and the usage (both).
  async function arm(name, turnFrames) {
    const cwd = fs.mkdtempSync(path.join(root, `${name}-`));
    const turns = [];
    for (let t = 0; t < turnFrames.length; t += 1) {
      const before = fake ? fake.bodies.length : 0;
      const spec = turnFrames[t](turns);
      const r = await runTurn({ args: argsFor(spec), frames: spec.frames, cwd, env });
      const bodies = fake ? fake.bodies.slice(before) : [];
      turns.push({ ...r, body: bodies.length ? JSON.parse(bodies.at(-1)) : null, requests: bodies.length });
      console.log(`  · ${name} turn ${t + 1}: exit=${r.code} requests=${fake ? bodies.length : "?"} ${summary(r.usage)}${r.code ? ` stderr=${r.stderr.trim().slice(-200)}` : ""}`);
    }
    return turns;
  }

  // control — the conversation as a client sends it, replayed whole every time.
  const control = await arm("control", [
    () => ({ persist: false, frames: [user(QUESTIONS[0])] }),
    (prev) => ({ persist: false, frames: [user(QUESTIONS[0], true), assistant(prev[0].text), user(QUESTIONS[1])] }),
    (prev) => ({ persist: false, frames: [user(QUESTIONS[0], true), assistant(prev[0].text), user(QUESTIONS[1], true), assistant(prev[1].text), user(QUESTIONS[2])] }),
  ]);

  const sid = crypto.randomUUID();
  created.add(sid);
  const resume = await arm("resume", [
    () => ({ persist: true, sessionId: sid, frames: [user(QUESTIONS[0])] }),
    () => ({ persist: true, resumeId: sid, frames: [user(QUESTIONS[1])] }),
    () => ({ persist: true, resumeId: sid, frames: [user(QUESTIONS[2])] }),
  ]);

  const rid = crypto.randomUUID();
  created.add(rid);
  const replayed = await arm("replayed", [
    () => ({ persist: true, sessionId: rid, frames: [user("Remember: answer briefly.", true), assistant("Understood."), user(QUESTIONS[0])] }),
    () => ({ persist: true, resumeId: rid, frames: [user(QUESTIONS[1])] }),
  ]);

  // 7d — an account pinned to its own config directory (the container shape).
  // Offline only: a fresh directory has no login, and the fake never checks one.
  if (!LIVE) {
    const acctDir = fs.mkdtempSync(path.join(root, "acct-config-"));
    const acctEnv = { ...env, CLAUDE_CONFIG_DIR: acctDir, CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat01-fake-for-loopback" };
    const did = crypto.randomUUID();
    const dcwd = fs.mkdtempSync(path.join(root, "configdir-"));
    const d1 = await runTurn({ args: argsFor({ persist: true, sessionId: did }), frames: [user(QUESTIONS[0])], cwd: dcwd, env: acctEnv });
    const projects = path.join(acctDir, "projects");
    const written = fs.existsSync(projects) && fs.readdirSync(projects).some((d) => fs.existsSync(path.join(projects, d, `${did}.jsonl`)));
    const d2 = await runTurn({ args: argsFor({ persist: true, resumeId: did }), frames: [user(QUESTIONS[1])], cwd: dcwd, env: acctEnv });
    console.log(`  · config-dir account: turn1 exit=${d1.code} turn2 exit=${d2.code} session file under <configDir>/projects: ${written}`);
    check("a CLAUDE_CONFIG_DIR account writes its session under <configDir>/projects and resumes it", d1.code === 0 && d2.code === 0 && written);
  }

  // A resume that has nothing to resume: how the CLI says so decides how the
  // executor recognises it and falls back.
  const missing = await runTurn({
    args: argsFor({ persist: true, resumeId: crypto.randomUUID() }),
    frames: [user(QUESTIONS[0])],
    cwd: fs.mkdtempSync(path.join(root, "missing-")),
    env,
  });
  console.log(`  · missing session: exit=${missing.code} result=${missing.result?.subtype || "none"} is_error=${missing.result?.is_error} errors=${JSON.stringify(missing.result?.errors || null)} stderr=${missing.stderr.trim().slice(-300)}`);
  check("resuming a session that does not exist fails fast, without a model call",
    missing.code !== 0 || missing.result?.is_error === true,
    `exit=${missing.code}`);

  check("every control turn completed", control.every((t) => t.code === 0 && t.result));
  check("every resumed turn completed", resume.every((t) => t.code === 0 && t.result) && replayed.every((t) => t.code === 0 && t.result));
  check("the resumed turns kept the session id", resume.every((t) => !t.sessionId || t.sessionId === sid),
    resume.map((t) => t.sessionId).join(", "));

  if (!LIVE) {
    const verdict = (label, turns) => {
      for (let t = 1; t < turns.length; t += 1) {
        if (!turns[t - 1].body || !turns[t].body) { check(`${label} turn ${t + 1}: bodies captured`, false); continue; }
        const d = diffPrefix(turns[t - 1].body, turns[t].body);
        console.log(formatDiff(d).split("\n").map((l) => `        ${l}`).join("\n"));
        check(`${label} turn ${t + 1}: previous breakpoint lies inside the repeated prefix`, d.earlierBreakpointReused);
      }
    };
    console.log("\n  control (expected to miss — this is today's bug):");
    const controlMiss = control.slice(1).map((t, i) => (control[i].body && t.body ? diffPrefix(control[i].body, t.body).earlierBreakpointReused : null));
    control.slice(1).forEach((t, i) => {
      if (control[i].body && t.body) console.log(formatDiff(diffPrefix(control[i].body, t.body)).split("\n").map((l) => `        ${l}`).join("\n"));
    });
    console.log(`        control reuse per turn: ${JSON.stringify(controlMiss)}`);
    console.log("\n  resume:");
    verdict("resume", resume);
    console.log("\n  replayed first turn, then resume:");
    verdict("replayed", replayed);
    console.log(`\n  captured bodies: ${fake.dir}`);
    if (fake.other.length) console.log(`  other requests the CLI made: ${[...new Set(fake.other)].join(", ")}`);
  } else {
    const hitRatio = (turns, t) => {
      const prevPrompt = promptOf(turns[t - 1].usage);
      return prevPrompt ? (turns[t].usage?.cache_read_input_tokens || 0) / prevPrompt : 0;
    };
    for (let t = 1; t < resume.length; t += 1) {
      const ratio = hitRatio(resume, t);
      check(`resume turn ${t + 1} reads back ≥80% of the previous turn's prompt from cache`, ratio >= 0.8, `ratio=${ratio.toFixed(2)}`);
    }
    const replayedRatio = hitRatio(replayed, 1);
    check("replayed-first session: turn 2 reads back ≥80% from cache", replayedRatio >= 0.8, `ratio=${replayedRatio.toFixed(2)}`);
    for (let t = 1; t < control.length; t += 1) {
      console.log(`  · control turn ${t + 1} ratio=${hitRatio(control, t).toFixed(2)} (today's path, for comparison)`);
    }
  }
} finally {
  if (fake) await fake.close();
  const removed = removeSessionFiles();
  if (!process.argv.includes("--keep")) fs.rmSync(root, { recursive: true, force: true });
  console.log(`  cleaned up ${removed} session project dir(s)${process.argv.includes("--keep") ? `; kept ${root}` : ""}`);
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
