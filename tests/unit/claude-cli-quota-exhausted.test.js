import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ClaudeCliExecutor } from "open-sse/executors/claude-cli.js";
import {
  markQuotaExhausted,
  quotaBlockedUntil,
  quotaExhaustion,
  resetRateLimitWindows,
} from "open-sse/executors/claudeCliRateLimits.js";
import { parseUpstreamError } from "open-sse/utils/error.js";
import { checkFallbackError } from "open-sse/services/accountFallback.js";
import { CLAUDE_CLI_QUOTA_RETRY_MS } from "open-sse/config/claudeCli.js";

/**
 * A subscription that has run out used to be asked again on every request: the
 * CLI answered "You've hit your limit" as ordinary content, the router saw a
 * 200, and a combo never moved on. The CLI does say so in a form that can be
 * read — `rate_limit_event` with status "rejected" and a `resetsAt`, and a
 * composed "You've hit your …" line — so an account that has said it is out is
 * not asked again until it says otherwise, and the request that found out is
 * answered 429 with the reset time, which the account loop already turns into
 * a lock and a fall through to the next model.
 */

describe("quotaExhaustion", () => {
  it("reads a rejected rate_limit_event, with its reset", () => {
    const resetsAt = 1790157000;
    expect(quotaExhaustion({
      type: "rate_limit_event",
      rate_limit_info: { status: "rejected", resetsAt, rateLimitType: "five_hour" },
    })).toEqual({ resetsAtMs: resetsAt * 1000 });
  });

  it("finds the reset in the window when the event names only the type", () => {
    expect(quotaExhaustion({
      type: "rate_limit_event",
      rate_limit_info: {
        status: "rejected",
        rateLimitType: "seven_day",
        unifiedWindows: { seven_day: { utilization: 1, resetsAt: 1790319600 } },
      },
    })).toEqual({ resetsAtMs: 1790319600 * 1000 });
  });

  it("reads the line the CLI composes, as a synthetic assistant message or an error result", () => {
    expect(quotaExhaustion({
      type: "assistant",
      message: { model: "<synthetic>", content: [{ type: "text", text: "You've hit your limit · resets 3pm" }] },
    })).toEqual({ resetsAtMs: null });
    for (const result of ["You've hit your limit", "You're out of usage credits", "Your org is out of usage · contact your admin"]) {
      expect(quotaExhaustion({ type: "result", is_error: true, result }), result).toEqual({ resetsAtMs: null });
    }
  });

  it("does not take a model's own answer for the CLI's line, even when the turn was cut short", () => {
    // max_tokens and the token ceiling come back is_error:true with the model's
    // own text in `result`; prose that happens to say "you've reached your goal"
    // must not block the account.
    expect(quotaExhaustion({ type: "result", is_error: true, stop_reason: "max_tokens", result: "Well done — you've reached your goal for today, and here is the plan: " + "x".repeat(400) })).toBeNull();
    expect(quotaExhaustion({ type: "result", is_error: true, result: "Great: you've hit your stride." })).toBeNull();
  });

  it("does not block while paid extra usage is covering the overflow", () => {
    for (const info of [{ isUsingOverage: true }, { overageStatus: "allowed" }, { overageStatus: "allowed_warning" }]) {
      expect(quotaExhaustion({ type: "rate_limit_event", rate_limit_info: { status: "rejected", resetsAt: 1790157000, ...info } }), JSON.stringify(info)).toBeNull();
    }
  });

  it("names the model family when the window is model-scoped", () => {
    expect(quotaExhaustion({ type: "rate_limit_event", rate_limit_info: { status: "rejected", resetsAt: 1790157000, rateLimitType: "seven_day_opus" } }))
      .toEqual({ resetsAtMs: 1790157000 * 1000, scope: "opus" });
    expect(quotaExhaustion({ type: "rate_limit_event", rate_limit_info: { status: "rejected", resetsAt: 1790157000, rateLimitType: "seven_day_sonnet" } }).scope).toBe("sonnet");
    expect(quotaExhaustion({ type: "rate_limit_event", rate_limit_info: { status: "rejected", resetsAt: 1790157000, rateLimitType: "five_hour" } }).scope).toBeUndefined();
  });

  it("says nothing about a turn that is merely close to the limit, or an ordinary answer", () => {
    expect(quotaExhaustion({ type: "rate_limit_event", rate_limit_info: { status: "allowed", resetsAt: 1 } })).toBeNull();
    expect(quotaExhaustion({ type: "rate_limit_event", rate_limit_info: { status: "allowed_warning", resetsAt: 1 } })).toBeNull();
    // A model explaining limits in its own words is not the CLI reporting one.
    expect(quotaExhaustion({
      type: "assistant",
      message: { model: "claude-haiku", content: [{ type: "text", text: "You've hit your limit is what the CLI prints." }] },
    })).toBeNull();
    expect(quotaExhaustion({ type: "result", is_error: false, result: "You've hit your limit" })).toBeNull();
    expect(quotaExhaustion({ type: "result", is_error: true, api_error_status: 529, result: "Overloaded" })).toBeNull();
    expect(quotaExhaustion(null)).toBeNull();
  });
});

describe("the block", () => {
  beforeEach(() => resetRateLimitWindows());

  it("holds until the reset, per account", () => {
    const a = { configDir: "/accounts/a" };
    const b = { configDir: "/accounts/b" };
    markQuotaExhausted(a, Date.now() + 60000);
    expect(quotaBlockedUntil(a)).toBeGreaterThan(Date.now());
    expect(quotaBlockedUntil(b)).toBe(0);
  });

  it("lapses on its own, so the account is tried again", async () => {
    const a = { configDir: "/accounts/a" };
    markQuotaExhausted(a, Date.now() + 40);
    await new Promise((r) => setTimeout(r, 80));
    expect(quotaBlockedUntil(a)).toBe(0);
  });

  it("never shortens a longer block it already holds", () => {
    const a = { configDir: "/accounts/a" };
    const far = Date.now() + 3600000;
    markQuotaExhausted(a, far);
    markQuotaExhausted(a, Date.now() + 1000);
    expect(quotaBlockedUntil(a)).toBe(far);
  });

  it("blocks only the model family a model-scoped limit names", () => {
    const a = { configDir: "/accounts/a" };
    markQuotaExhausted(a, Date.now() + 60000, "opus");
    expect(quotaBlockedUntil(a, "claude-cli-opus")).toBeGreaterThan(Date.now());
    expect(quotaBlockedUntil(a, "claude-cli-opus-1m")).toBeGreaterThan(Date.now());
    expect(quotaBlockedUntil(a, "claude-cli-sonnet")).toBe(0);
    expect(quotaBlockedUntil(a, "claude-cli-haiku")).toBe(0);
    // An account-wide block still covers every model.
    markQuotaExhausted(a, Date.now() + 60000);
    expect(quotaBlockedUntil(a, "claude-cli-haiku")).toBeGreaterThan(Date.now());
  });

  it("also covers the host's own login, which has no key of its own", () => {
    markQuotaExhausted({}, Date.now() + 60000);
    expect(quotaBlockedUntil({})).toBeGreaterThan(Date.now());
  });
});

// ─── through the executor, with a stand-in `claude` ──────────────────────────

let root;
let binDir;
const saved = {};

const standIn = () => `#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const ROOT = ${JSON.stringify(root)};
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => { input += d; });
process.stdin.on("end", () => {
  fs.appendFileSync(path.join(ROOT, "calls.jsonl"), JSON.stringify({ args: process.argv.slice(2) }) + "\\n");
  let mode = "";
  try { mode = fs.readFileSync(path.join(ROOT, "mode.txt"), "utf8").trim(); } catch {}
  const say = (o) => process.stdout.write(JSON.stringify(o) + "\\n");
  const reset = Math.floor(Date.now() / 1000) + 3600;
  if (mode === "limit-event") {
    say({ type: "rate_limit_event", rate_limit_info: { status: "rejected", resetsAt: reset, rateLimitType: "five_hour" } });
    say({ type: "assistant", message: { model: "<synthetic>", content: [{ type: "text", text: "You've hit your limit · resets 3pm" }] } });
    say({ type: "result", subtype: "success", is_error: true, num_turns: 1, result: "You've hit your limit · resets 3pm" });
    return;
  }
  if (mode === "limit-text") {
    say({ type: "result", subtype: "success", is_error: true, num_turns: 1, result: "You've hit your limit" });
    return;
  }
  say({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "fine" } } });
  say({ type: "result", subtype: "success", is_error: false, num_turns: 1, stop_reason: "end_turn", result: "fine", usage: { input_tokens: 1, output_tokens: 1 } });
});
`;

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "9r-quota-exec-"));
  binDir = path.join(root, "bin");
  fs.mkdirSync(binDir, { recursive: true });
  let bin;
  if (process.platform === "win32") {
    bin = path.join(binDir, "claude.cmd");
    fs.writeFileSync(bin, "@echo off\r\n");
    const pkg = path.join(binDir, "node_modules", "@anthropic-ai", "claude-code");
    fs.mkdirSync(pkg, { recursive: true });
    fs.writeFileSync(path.join(pkg, "cli.js"), standIn());
  } else {
    bin = path.join(binDir, "claude");
    fs.writeFileSync(bin, standIn());
    fs.chmodSync(bin, 0o755);
  }
  for (const key of ["CLI_CLAUDE_BIN", "CLI_CLAUDE_SESSION_CACHE", "CLI_CLAUDE_CACHE_RELAY"]) saved[key] = process.env[key];
  process.env.CLI_CLAUDE_BIN = bin;
  process.env.CLI_CLAUDE_SESSION_CACHE = "0";
  process.env.CLI_CLAUDE_CACHE_RELAY = "0";
});

afterAll(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  fs.rmSync(root, { recursive: true, force: true });
});

beforeEach(() => {
  resetRateLimitWindows();
  fs.rmSync(path.join(root, "calls.jsonl"), { force: true });
  fs.rmSync(path.join(root, "mode.txt"), { force: true });
});

const calls = () => (fs.existsSync(path.join(root, "calls.jsonl"))
  ? fs.readFileSync(path.join(root, "calls.jsonl"), "utf8").trim().split("\n").length : 0);
const mode = (m) => fs.writeFileSync(path.join(root, "mode.txt"), m);

const ACCOUNT = { providerSpecificData: { configDir: "/accounts/a" } };

async function ask(credentials = ACCOUNT) {
  const executor = new ClaudeCliExecutor();
  const { response } = await executor.execute({
    model: "claude-cli-haiku",
    body: { messages: [{ role: "user", content: "hi" }] },
    credentials,
    log: { info() {} },
  });
  const text = await response.text();
  return { executor, response, text, status: response.status };
}

describe("an account that is out of quota, through the executor", () => {
  it("answers 429 with the reset time, instead of the limit message as a 200", async () => {
    mode("limit-event");
    const out = await ask();
    expect(out.status).toBe(429);
    expect(out.text).toContain("quota_exhausted");
    const parsed = out.executor.parseError({ status: out.status }, out.text);
    expect(parsed.status).toBe(429);
    const expected = Date.now() + 3600000;
    expect(Math.abs(parsed.resetsAtMs - expected)).toBeLessThan(10000);
  });

  it("does not spawn again while the account is blocked", async () => {
    mode("limit-event");
    await ask();
    expect(calls()).toBe(1);
    mode("ok");
    const again = await ask();
    expect(again.status).toBe(429);
    expect(calls()).toBe(1);
  });

  it("reaches chatCore as a 429 with the reset, the way the account lock reads it", async () => {
    // chatCore calls parseUpstreamError(response, executor) on a non-OK response and
    // hands resetsAtMs to markAccountUnavailable, which locks the model until then.
    mode("limit-event");
    const { executor, response } = await ask();
    const fresh = await ask();
    expect(fresh.status).toBe(429);
    const parsed = await parseUpstreamError(fresh.response.clone ? new Response(fresh.text, { status: 429 }) : response, executor);
    expect(parsed.statusCode).toBe(429);
    expect(Math.abs(parsed.resetsAtMs - (Date.now() + 3600000))).toBeLessThan(10000);
    expect(parsed.message).toMatch(/out of quota/);
    // And a 429 without a reset still falls back (no stand-alone 200 to move past).
    expect(checkFallbackError(429, parsed.message).shouldFallback).toBe(true);
  });

  it("blocks for the retry interval when the CLI gave no reset", async () => {
    mode("limit-text");
    const out = await ask();
    expect(out.status).toBe(429);
    const until = out.executor.parseError({ status: 429 }, out.text).resetsAtMs;
    expect(Math.abs(until - (Date.now() + CLAUDE_CLI_QUOTA_RETRY_MS))).toBeLessThan(10000);
  });

  it("tries again once the block has lapsed", async () => {
    markQuotaExhausted(ACCOUNT.providerSpecificData, Date.now() + 40);
    await new Promise((r) => setTimeout(r, 80));
    mode("ok");
    const out = await ask();
    expect(out.status).toBe(200);
    expect(out.text).toContain("fine");
    expect(calls()).toBe(1);
  });

  it("leaves another account alone", async () => {
    mode("limit-event");
    await ask();
    mode("ok");
    const other = await ask({ providerSpecificData: { configDir: "/accounts/b" } });
    expect(other.status).toBe(200);
    expect(other.text).toContain("fine");
  });

  it("changes nothing for an account that is not out", async () => {
    mode("ok");
    const out = await ask();
    expect(out.status).toBe(200);
    expect(out.text).toContain("fine");
    expect(quotaBlockedUntil(ACCOUNT.providerSpecificData)).toBe(0);
  });
});
