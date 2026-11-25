import { beforeEach, describe, expect, it } from "vitest";
import { detectClientDetails } from "../../open-sse/utils/clientDetector.js";
import { getClientSessionId } from "../../open-sse/utils/sessionManager.js";
import {
  endLiveRoute,
  getLiveRoutesSnapshot,
  resetLiveRoutes,
  startLiveRoute,
  noteLiveAttempt,
} from "../../src/lib/observability/liveRoutes.js";
import {
  aggregateRouteLinks,
  assignTimelineLanes,
  barGeometry,
  limitNodes,
  summarizeLiveRoutes,
  timelineRecords,
} from "../../src/shared/utils/liveRoutes.js";

describe("live route metadata", () => {
  beforeEach(() => resetLiveRoutes());

  it("detects CLI, SDK and shell clients with versions", () => {
    expect(detectClientDetails({ "user-agent": "codex_cli_rs/0.169.0" })).toEqual({ name: "Codex", version: "0.169.0" });
    expect(detectClientDetails({ "user-agent": "Claude Code/2.1.3" })).toEqual({ name: "Claude Code", version: "2.1.3" });
    expect(detectClientDetails({ "user-agent": "curl/8.5.0" })).toEqual({ name: "curl", version: "8.5.0" });
    expect(detectClientDetails({ "user-agent": "python-requests/2.32.3" })).toEqual({ name: "python-requests", version: "2.32.3" });
    expect(detectClientDetails({ "user-agent": "OpenAI/Python 1.99.0" })).toEqual({ name: "OpenAI SDK", version: "1.99.0" });
    expect(detectClientDetails({ "user-agent": "openai-node/4.2.0" })).toEqual({ name: "OpenAI SDK", version: "4.2.0" });
    expect(detectClientDetails({ "user-agent": "mystery-client" })).toEqual({ name: "mystery-client", version: null });
  });

  it("uses header precedence and rejects oversized session ids", () => {
    expect(getClientSessionId({ "x-session-id": "first", "session-id": "second" }, {})).toBe("first");
    expect(getClientSessionId({ "session_id": "third", "x-amp-thread-id": "fourth" }, {})).toBe("third");
    expect(getClientSessionId({ "x-claude-code-session-id": "claude" }, {})).toBe("claude:claude");
    expect(getClientSessionId({ "x-session-id": "x".repeat(257) }, {})).toBeNull();
  });
});

describe("live route lifecycle", () => {
  beforeEach(() => resetLiveRoutes());

  it("records start, fallback attempts, end status and redacts request data", () => {
    const trace = {
      requestId: "req-1",
      startedAt: Date.now() - 100,
      client: { name: "curl", version: "8.5.0" },
      ip: "127.0.0.1",
      apiKey: "sk-live-secret",
      body: "Ignore previous instructions",
    };
    startLiveRoute(trace);
    noteLiveAttempt(trace, "codex", "gpt-6", "account-1");
    noteLiveAttempt(trace, "codex", "gpt-6-mini", "account-2");
    endLiveRoute(trace, {
      status: "ok",
      provider: "codex",
      model: "gpt-6-mini",
      tokens: { prompt_tokens: 4, completion_tokens: 8 },
      meta: { attempts: 2, fallbacks: 1 },
    });
    const json = JSON.stringify(getLiveRoutesSnapshot());
    const record = JSON.parse(json)[0];
    expect(record.status).toBe("ok");
    expect(record.attempts).toBe(2);
    expect(record.fallbacks).toBe(1);
    expect(json).not.toContain("sk-live-secret");
    expect(json).not.toContain("Ignore previous instructions");
  });

  it("maps errors and aborted requests and closes stale running requests", () => {
    const now = Date.now();
    startLiveRoute({ requestId: "error", startedAt: now - 100 });
    endLiveRoute("error", { status: "failed" });
    startLiveRoute({ requestId: "aborted", startedAt: now - 100 });
    endLiveRoute("aborted", { status: "cancelled" });
    startLiveRoute({ requestId: "stale", startedAt: now - (15 * 60 * 1000 + 1000) });
    const snapshot = getLiveRoutesSnapshot(now);
    expect(snapshot.find(record => record.id === "error").status).toBe("error");
    expect(snapshot.find(record => record.id === "aborted").status).toBe("aborted");
    expect(snapshot.find(record => record.id === "stale").status).toBe("aborted");
  });

  it("keeps at most 5000 records", () => {
    for (let index = 0; index < 5005; index += 1) startLiveRoute({ requestId: `req-${index}` });
    expect(getLiveRoutesSnapshot()).toHaveLength(5000);
  });
});

describe("live route aggregation", () => {
  it("filters windows and aggregates each graph edge once", () => {
    const now = Date.now();
    const base = { provider: "codex", connectionId: "a", model: "gpt-6", client: { name: "Codex", version: "0.169.0" }, ip: "127.0.0.1", sessionId: "s" };
    const rows = [
      { ...base, id: "1", startedAt: now - 1000, endedAt: now - 500, status: "ok", latencyMs: 500, outputTokens: 100 },
      { ...base, id: "2", startedAt: now - 2000, endedAt: now - 1000, status: "error", latencyMs: 1000, outputTokens: 0 },
      { ...base, id: "3", startedAt: now - 60_000, status: "running" },
    ];
    const summary = summarizeLiveRoutes(rows, { window: "30s", now });
    // The request that began 60 s ago is still running, so it overlaps the window.
    expect(summary.requestsInWindow).toBe(3);
    expect(summary.inProgress).toBe(1);
    expect(summary.successRate).toBe(50);
    expect(summary.outputTokPerSec).toBeCloseTo(100 / 30, 4);
    expect(summary.avgLatency).toBe(750);
    expect(summary.accountModel).toHaveLength(1);
    expect(summary.modelClient).toHaveLength(1);
    expect(summary.clientSession).toHaveLength(1);
    expect(summary.links[0].requests).toBe(3);
  });

  it("drops finished requests that ended before the window", () => {
    const now = Date.now();
    const base = { provider: "codex", connectionId: "a", model: "gpt-6", client: { name: "Codex" }, sessionId: "s" };
    const summary = summarizeLiveRoutes([
      { ...base, id: "old", startedAt: now - 90_000, endedAt: now - 40_000, status: "ok" },
      { ...base, id: "spans", startedAt: now - 45_000, endedAt: now - 10_000, status: "ok" },
    ], { window: "30s", now });
    expect(summary.records.map(record => record.id)).toEqual(["spans"]);
    expect(summary.inProgress).toBe(0);
  });

  it("limits nodes into one more row and assigns overlapping bars greedily", () => {
    const nodes = Array.from({ length: 12 }, (_, index) => ({ id: `${index}`, requests: 1, inProgress: 0 }));
    expect(limitNodes(nodes, 10, "account").at(-1)).toMatchObject({ id: "account:more", moreCount: 2 });
    expect(aggregateRouteLinks([
      { id: "1", connectionId: "a", model: "m", client: { name: "c" }, sessionId: "s", status: "running" },
      { id: "2", connectionId: "a", model: "m", client: { name: "c" }, sessionId: "s", status: "ok" },
    ]).accountModel[0]).toMatchObject({ requests: 2, inProgress: 1 });
    const lanes = assignTimelineLanes([
      { id: "a", startedAt: 0, endedAt: 10 },
      { id: "b", startedAt: 5, endedAt: 20 },
      { id: "c", startedAt: 10, endedAt: 12 },
    ]);
    expect(lanes.map(item => item.lane)).toEqual([0, 1, 0]);
  });
});

describe("live route timeline geometry", () => {
  const now = 100_000;
  const windowMs = 30_000;
  const start = now - windowMs;

  it("keeps requests that began before the window and drops ones that ended before it", () => {
    const records = [
      { id: "long", status: "running", startedAt: start - 20_000 },
      { id: "spans", status: "ok", startedAt: start - 5_000, endedAt: start + 2_000 },
      { id: "gone", status: "ok", startedAt: start - 9_000, endedAt: start - 1 },
      { id: "fresh", status: "ok", startedAt: now - 1_000, endedAt: now - 500 },
    ];
    expect(timelineRecords(records, start, now).map(record => record.id)).toEqual(["long", "spans", "fresh"]);
  });

  it("does not clamp bars to the left edge, so they slide out", () => {
    const early = barGeometry({ status: "ok", startedAt: start - 6_000, endedAt: start + 3_000 }, start, now, windowMs);
    expect(early.left).toBeCloseTo(-20);
    expect(early.width).toBeCloseTo(30);
    const running = barGeometry({ status: "running", startedAt: now - 3_000 }, start, now, windowMs);
    expect(running.left + running.width).toBeCloseTo(100);
  });

  it("gives overlapping running requests separate lanes", () => {
    const lanes = assignTimelineLanes([
      { id: "a", status: "running", startedAt: now - 10_000 },
      { id: "b", status: "running", startedAt: now - 5_000 },
      { id: "c", status: "ok", startedAt: now - 20_000, endedAt: now - 15_000 },
    ], now);
    const lane = Object.fromEntries(lanes.map(({ record, lane: value }) => [record.id, value]));
    expect(lane.a).not.toBe(lane.b);
    expect(lane.c).toBe(0);
  });
});
