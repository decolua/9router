/**
 * CB2 — combo stats collection: ONE usageHistory line per FAILED member attempt,
 * carrying the combo identity, plus meta.combo on the winning line.
 *
 * Binding decision: docs/orchestration/DECISIONS.md D13 (no schema migration —
 * `status`/`meta` already exist in usageHistory; the collector writes the
 * failure line and the daily aggregate must keep ignoring it).
 *
 * Seam under test: the REAL combo loop (open-sse/services/combo.js
 * `handleComboChat`) against the REAL storage layer (temp DATA_DIR + initDb) —
 * the anti-regression gate can only be proven end to end. Only the upstream
 * dispatch is stubbed; that stub is where a real member call would have written
 * its own usage line through chatCore's writers.
 *
 * The fail-open cases (writer throws / rejects) live in
 * cb2-usage-write-failopen.test.js: wrapping `@/lib/usageDb.js` here would fork
 * the db module graph (two `_pendingUsagePersists` sets) and `drainPendingUsage`
 * would await the wrong one.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let db;
let requestDetail;

function resetDbState() {
  const adapter = global._dbAdapter?.instance;
  if (adapter && typeof adapter.close === "function") {
    try { adapter.close(); } catch {}
  }
  if (global._statsEmitter && typeof global._statsEmitter.removeAllListeners === "function") {
    try { global._statsEmitter.removeAllListeners(); } catch {}
  }
  if (global._statsEmitTimers) {
    if (global._statsEmitTimers.update) clearTimeout(global._statsEmitTimers.update);
    if (global._statsEmitTimers.pending) clearTimeout(global._statsEmitTimers.pending);
  }
  for (const key of ["_dbAdapter", "_pendingRequests", "_lastErrorProvider", "_recentRing",
    "_statsEmitter", "_statsEmitTimers", "_pendingUsagePersists"]) {
    delete global[key];
  }
  vi.resetModules();
}

const log = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

const upstreamError = (status, message) => new Response(
  JSON.stringify({ error: { message } }),
  { status, headers: { "Content-Type": "application/json" } },
);

const upstreamOk = (body) => new Response(
  JSON.stringify(body),
  { status: 200, headers: { "Content-Type": "application/json" } },
);

/**
 * Mirror of what chat.js does around a real member call: it owns the
 * `attemptUsage` scratch the loop fills per attempt, and flips `reachedUpstream`
 * only past the breaker/capacity gates. `{ dispatch: false }` reproduces the
 * skip case on purpose.
 */
function comboAttempt({ dispatch = true, connectionId = "conn-1", apiKey = "client-key", endpoint = "/v1/chat/completions" } = {}) {
  const attemptUsage = { apiKey, endpoint };
  const handleSingleModel = (fn) => async (body, modelStr) => {
    if (dispatch) {
      attemptUsage.reachedUpstream = true;
      attemptUsage.connectionId = connectionId;
    }
    return fn(body, modelStr);
  };
  return { attemptUsage, handleSingleModel };
}

/** What chatCore's writers do for a member that produced tokens. */
async function writeWinner(modelStr, tokens, { comboName } = {}) {
  const { randomUUID } = await import("node:crypto");
  const usageEventId = randomUUID();
  const slash = modelStr.indexOf("/");
  const provider = modelStr.slice(0, slash);
  const model = modelStr.slice(slash + 1);
  // chatCore registers the combo identity on the event id it is about to write.
  requestDetail.attachUsageEventMeta(usageEventId, { combo: comboName, member: modelStr });
  requestDetail.saveUsageStats({
    provider, model, tokens, usageEventId,
    connectionId: "conn-1", apiKey: "client-key", endpoint: "/v1/chat/completions",
    silent: true,
  });
  return usageEventId;
}

async function settleWrites() {
  await db.drainPendingUsage({ timeoutMs: 3000 });
}

beforeEach(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-cb2-combo-"));
  process.env.DATA_DIR = tempDir;
  resetDbState();
  db = await import("@/lib/db/index.js");
  await db.initDb();
  requestDetail = await import("open-sse/handlers/chatCore/requestDetail.js");
});

afterEach(() => {
  resetDbState();
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("CB2 combo attempt failure events", () => {
  it("A fails 429 then B wins → TWO rows: A error:<status>+meta.combo, B winner+meta.combo", async () => {
    const { handleComboChat } = await import("open-sse/services/combo.js");
    const { attemptUsage, handleSingleModel } = comboAttempt();

    const response = await handleComboChat({
      body: { messages: [{ role: "user", content: "hi" }] },
      models: ["grok/grok-3", "glm/glm-4"],
      comboName: "code-stack",
      comboStrategy: "fallback",
      attemptUsage,
      log,
      handleSingleModel: handleSingleModel(async (_body, modelStr) => {
        if (modelStr === "grok/grok-3") return upstreamError(429, "rate limited by grok");
        await writeWinner(modelStr, { prompt_tokens: 11, completion_tokens: 5 }, { comboName: "code-stack" });
        return upstreamOk({ choices: [{ message: { content: "ok" } }] });
      }),
    });

    await settleWrites();
    expect(response.status, "the winning member still answers").toBe(200);

    const all = await db.getUsageHistory({ includeFailures: true });
    expect(all.length, "one line per attempted member").toBe(2);

    const failure = all.find((r) => r.model === "grok-3");
    expect(failure, "the failed member left a trace").toBeTruthy();
    expect(failure.provider).toBe("grok");
    expect(failure.status).toBe("error:429");
    expect(failure.meta.combo).toBe("code-stack");
    expect(failure.meta.member).toBe("grok/grok-3");
    expect(failure.meta.attempt).toBe(1);
    expect(failure.meta.endpoint).toBe("/v1/chat/completions");
    expect(failure.connectionId).toBe("conn-1");
    expect(failure.apiKeyMasked, "the client key the winner would have had travels too").toBeTruthy();
    expect(failure.usageEventId, "failure row has its OWN event id").toBeTruthy();
    expect(failure.tokens.prompt_tokens ?? 0).toBe(0);
    expect(failure.cost).toBe(0);

    const winner = all.find((r) => r.model === "glm-4");
    expect(winner).toBeTruthy();
    expect(winner.status).toBe("ok");
    expect(winner.meta.combo).toBe("code-stack");
    expect(winner.tokens.prompt_tokens).toBe(11);
    expect(winner.usageEventId).not.toBe(failure.usageEventId);

    // the default listing keeps its "one row = one call" contract
    const plain = await db.getUsageHistory();
    expect(plain.map((r) => r.model)).toEqual(["glm-4"]);
  });

  it("GATE: the failure row must not move the Usage page totals", async () => {
    const { handleComboChat } = await import("open-sse/services/combo.js");

    // Baseline: the same request with a healthy first member (no failure line).
    const solo = comboAttempt();
    const healthy = await handleComboChat({
      body: { messages: [{ role: "user", content: "hi" }] },
      models: ["glm/glm-4"],
      comboName: "solo",
      attemptUsage: solo.attemptUsage,
      log,
      handleSingleModel: solo.handleSingleModel(async (_b, m) => {
        await writeWinner(m, { prompt_tokens: 11, completion_tokens: 5 }, { comboName: "solo" });
        return upstreamOk({ choices: [{ message: { content: "ok" } }] });
      }),
    });
    await settleWrites();
    expect(healthy.status).toBe(200);

    const before = {
      today: await db.getUsageStats("today"),
      h24: await db.getUsageStats("24h"),
      all: await db.getUsageStats("all"),
      chart: await db.getChartData("today"),
      rows: (await db.getUsageHistory()).length,
      ring: (await db.getActiveRequests()).recentRequests.length,
    };

    // Same winner, now behind a failing member: +1 failure row and nothing else.
    const stack = comboAttempt();
    const after = await handleComboChat({
      body: { messages: [{ role: "user", content: "hi" }] },
      models: ["grok/grok-3", "glm/glm-4"],
      comboName: "code-stack",
      attemptUsage: stack.attemptUsage,
      log,
      handleSingleModel: stack.handleSingleModel(async (_b, m) => {
        if (m === "grok/grok-3") return upstreamError(503, "upstream down");
        await writeWinner(m, { prompt_tokens: 11, completion_tokens: 5 }, { comboName: "code-stack" });
        return upstreamOk({ choices: [{ message: { content: "ok" } }] });
      }),
    });
    await settleWrites();
    expect(after.status).toBe(200);

    const now = {
      today: await db.getUsageStats("today"),
      h24: await db.getUsageStats("24h"),
      all: await db.getUsageStats("all"),
      chart: await db.getChartData("today"),
      rows: (await db.getUsageHistory()).length,
      ring: (await db.getActiveRequests()).recentRequests.length,
    };

    // Second combo request = one more successful call. Everything derived from
    // SUCCESS grows by exactly that winner — never by the error. before.today
    // held exactly ONE winner, so its totals are the per-winner unit.
    expect(now.rows, "default history view keeps counting successes only").toBe(before.rows + 1);
    expect(now.ring, "the live recent ring is not crowded by failures").toBe(before.ring + 1);
    for (const period of ["today", "h24", "all"]) {
      expect(now[period].totalRequests, `${period} totalRequests`).toBe(before[period].totalRequests + 1);
      expect(now[period].totalPromptTokens, `${period} promptTokens`).toBe(before[period].totalPromptTokens + 11);
      expect(now[period].totalCompletionTokens, `${period} completionTokens`).toBe(before[period].totalCompletionTokens + 5);
      expect(now[period].totalCost, `${period} cost (failure adds zero)`)
        .toBeCloseTo(before[period].totalCost + before.today.totalCost, 10);
    }
    expect(now.today.byProvider.glm?.requests).toBe(before.today.byProvider.glm?.requests + 1);
    expect(now.today.byProvider.grok, "the failed member is not traffic").toBeUndefined();
    expect(now.today.byModel["glm-4 (glm)"].requests).toBe(2);
    expect(now.chart.reduce((s, b) => s + b.tokens, 0))
      .toBe(before.chart.reduce((s, b) => s + b.tokens, 0) + 16);
    expect(now.chart.reduce((s, b) => s + b.cost, 0))
      .toBeCloseTo(before.chart.reduce((s, b) => s + b.cost, 0) + before.today.totalCost, 10);

    // usageDaily (what 7d/30d/60d/all read) tells the same story.
    const dayKey = new Date().toISOString().slice(0, 10);
    const adapter = await (await import("@/lib/db/driver.js")).getAdapter();
    const day = JSON.parse(adapter.get("SELECT data FROM usageDaily WHERE dateKey = ?", [dayKey]).data);
    expect(day.requests, "two winners, not three attempted members").toBe(2);
    expect(day.promptTokens).toBe(22);
    expect(day.byProvider.grok, "no provider bucket for a failed member").toBeUndefined();
    const lifetime = adapter.get("SELECT value FROM _meta WHERE key = 'totalRequestsLifetime'");
    expect(Number(lifetime.value), "lifetime counter ignores failure rows too").toBe(2);
  });

  it("the same member failing on two distinct attempts writes two rows with distinct ids", async () => {
    const { handleComboChat } = await import("open-sse/services/combo.js");
    const { attemptUsage, handleSingleModel } = comboAttempt();

    await handleComboChat({
      body: { messages: [{ role: "user", content: "hi" }] },
      models: ["grok/grok-3", "grok/grok-3", "glm/glm-4"],
      comboName: "repeat-stack",
      attemptUsage,
      log,
      handleSingleModel: handleSingleModel(async (_b, m) => {
        if (m.startsWith("grok/")) return upstreamError(500, "boom");
        await writeWinner(m, { prompt_tokens: 2, completion_tokens: 1 }, { comboName: "repeat-stack" });
        return upstreamOk({ choices: [{ message: { content: "ok" } }] });
      }),
    });
    await settleWrites();

    const all = await db.getUsageHistory({ includeFailures: true });
    const failures = all.filter((r) => String(r.status || "").startsWith("error"));
    expect(failures.length, "no dedup collapse: one line per attempt").toBe(2);
    expect(new Set(failures.map((f) => f.usageEventId)).size).toBe(2);
    expect(failures.map((f) => f.meta.attempt)).toEqual([1, 2]);
    expect(failures.every((f) => f.meta.combo === "repeat-stack")).toBe(true);
    expect((await db.getUsageStats("all")).totalRequests, "still only the winner").toBe(1);
  });

  it("a member that throws still records a line, classified error:timeout / error:threw", async () => {
    const { handleComboChat } = await import("open-sse/services/combo.js");
    const { attemptUsage, handleSingleModel } = comboAttempt();

    const response = await handleComboChat({
      body: { messages: [{ role: "user", content: "hi" }] },
      models: ["grok/grok-3", "glm/glm-4", "openai/gpt-4o"],
      comboName: "throw-stack",
      attemptUsage,
      log,
      handleSingleModel: handleSingleModel(async (_b, m) => {
        if (m === "grok/grok-3") throw new Error("socket hang up");
        if (m === "glm/glm-4") throw new Error("translateRequest exploded");
        await writeWinner(m, { prompt_tokens: 3, completion_tokens: 1 }, { comboName: "throw-stack" });
        return upstreamOk({ choices: [{ message: { content: "ok" } }] });
      }),
    });
    await settleWrites();
    expect(response.status).toBe(200);

    const all = await db.getUsageHistory({ includeFailures: true });
    const failures = all.filter((r) => String(r.status || "").startsWith("error"));
    expect(failures.length, "both throws are member failures").toBe(2);
    const byMember = Object.fromEntries(failures.map((f) => [f.meta.member, f.status]));
    expect(byMember["grok/grok-3"], "a hang-up reads as a timeout, not a random throw").toBe("error:timeout");
    expect(byMember["glm/glm-4"]).toBe("error:threw");
    expect(all.find((r) => r.model === "gpt-4o").status).toBe("ok");
  });

  it("a member SKIPPED before the provider was reached writes no failure line", async () => {
    // chat.js decides this: the breaker/capacity gates `continue` before
    // handleChatCore, so `reachedUpstream` is never flipped. Reporting those as
    // combo failures would blame a member for a call it never got.
    const { handleComboChat } = await import("open-sse/services/combo.js");
    const { attemptUsage, handleSingleModel } = comboAttempt({ dispatch: false });

    const response = await handleComboChat({
      body: { messages: [{ role: "user", content: "hi" }] },
      models: ["grok/grok-3", "glm/glm-4"],
      comboName: "breaker-stack",
      attemptUsage,
      log,
      handleSingleModel: handleSingleModel(async (_b, m) => {
        if (m === "grok/grok-3") return upstreamError(503, "Account at capacity (the provider was never called)");
        attemptUsage.reachedUpstream = true; // this member really is dispatched
        await writeWinner(m, { prompt_tokens: 3, completion_tokens: 1 }, { comboName: "breaker-stack" });
        return upstreamOk({ choices: [{ message: { content: "ok" } }] });
      }),
    });
    await settleWrites();
    expect(response.status).toBe(200);

    const all = await db.getUsageHistory({ includeFailures: true });
    expect(all.length, "only the winner is persisted").toBe(1);
    expect(all[0].model).toBe("glm-4");
  });

  it("a loop with NO attemptUsage scratch (adapter path, other modalities) changes nothing", async () => {
    // The capability adapter and the tts/image/search/fetch callers never pass
    // the scratch object: their behaviour must be identical to pre-CB2.
    const { handleComboChat } = await import("open-sse/services/combo.js");

    const response = await handleComboChat({
      body: { messages: [{ role: "user", content: "hi" }] },
      models: ["grok/grok-3", "glm/glm-4"],
      comboName: "vision-adapter-model",
      log,
      handleSingleModel: async (_b, m) => (m === "grok/grok-3" ? upstreamError(500, "boom") : upstreamOk({ choices: [{ message: { content: "ok" } }] })),
    });
    await settleWrites();

    expect(response.status).toBe(200);
    expect((await db.getUsageHistory({ includeFailures: true })).length).toBe(0);
  });

  it("a successful first member records NO failure line (happy path costs zero extra rows)", async () => {
    const { handleComboChat } = await import("open-sse/services/combo.js");
    const { attemptUsage, handleSingleModel } = comboAttempt();

    await handleComboChat({
      body: { messages: [{ role: "user", content: "hi" }] },
      models: ["glm/glm-4"],
      comboName: "clean",
      attemptUsage,
      log,
      handleSingleModel: handleSingleModel(async (_b, m) => {
        await writeWinner(m, { prompt_tokens: 4, completion_tokens: 2 }, { comboName: "clean" });
        return upstreamOk({ choices: [{ message: { content: "ok" } }] });
      }),
    });
    await settleWrites();

    const all = await db.getUsageHistory({ includeFailures: true });
    expect(all.length, "happy path costs exactly the row it always cost").toBe(1);
    expect(String(all[0].status || "ok")).not.toMatch(/^error/i);
  });
});
