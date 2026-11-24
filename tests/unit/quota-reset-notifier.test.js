import { describe, it, expect, vi } from "vitest";
import { runQuotaResetTick, sendToTarget, sendTestNotification } from "@/shared/services/quotaResetNotifier.js";

const H = 3600000;
const T0 = Date.parse("2026-11-24T00:00:00Z");
const quota = (resetAt, used = 40) => ({ used, total: 100, remaining: 100 - used, resetAt: new Date(resetAt).toISOString(), unlimited: false });
const freshState = () => ({ running: false, accounts: {}, recent: [] });

const target = { id: "t1", name: "Bot", type: "generic", url: "http://bot.local/hooks/notify/SECRETTOKEN", enabled: true };
const config = (over = {}) => ({
  enabled: true, defaults: { fiveHour: true, weekly: true }, connections: {},
  titleTemplate: "{provider} {window} 리셋", bodyTemplate: "{account} {usedPercent}%", targets: [target], ...over,
});
const conn = { id: "c1", provider: "claude", name: "me@x.com", isActive: true };

function makeDeps({ cfg = config(), conns = [conn], usage, clock }) {
  return {
    now: () => clock.t,
    send: vi.fn(async () => ({ ok: true })),
    getSettings: async () => ({ quotaResetNotify: cfg }),
    getProviderConnections: async () => conns,
    fetchUsage: vi.fn(async () => (typeof usage === "function" ? usage(clock.t) : usage)),
  };
}

describe("runQuotaResetTick", () => {
  it("does nothing when disabled or without targets", async () => {
    const clock = { t: T0 };
    for (const cfg of [config({ enabled: false }), config({ targets: [] })]) {
      const deps = makeDeps({ cfg, usage: { quotas: {} }, clock });
      await runQuotaResetTick(deps, freshState());
      expect(deps.fetchUsage).not.toHaveBeenCalled();
    }
  });

  it("learns first, then notifies exactly once after the window resets", async () => {
    const clock = { t: T0 };
    let resetAt = T0 + 2 * H;
    const deps = makeDeps({ usage: () => ({ quotas: { "session (5h)": quota(resetAt, 90) } }), clock });
    const state = freshState();

    await runQuotaResetTick(deps, state);              // learn
    expect(deps.send).not.toHaveBeenCalled();

    clock.t = T0 + 2 * H + 30000; resetAt = clock.t + 5 * H;
    await runQuotaResetTick(deps, state);              // window rolled
    expect(deps.send).toHaveBeenCalledTimes(1);
    const [sentTarget, message] = deps.send.mock.calls[0];
    expect(sentTarget.id).toBe("t1");
    expect(message.title).toBe("claude 5시간 리셋");
    expect(message.text).toBe("me@x.com 90%");

    clock.t += 60000;
    await runQuotaResetTick(deps, state);              // same new window: no repeat
    expect(deps.send).toHaveBeenCalledTimes(1);
    expect(state.recent[0]).toMatchObject({ provider: "claude", window: "fiveHour", sent: 1, failed: 0 });
  });

  it("respects per-window and per-account switches", async () => {
    const clock = { t: T0 };
    const cfg = config({ defaults: { fiveHour: false, weekly: true } });
    const deps = makeDeps({ cfg, usage: () => ({ quotas: { "session (5h)": quota(clock.t + (clock.t === T0 ? 1000 : 5 * H)) } }), clock });
    const state = freshState();
    await runQuotaResetTick(deps, state);
    clock.t = T0 + 2000;
    await runQuotaResetTick(deps, state);
    expect(deps.send).not.toHaveBeenCalled();          // 5h disabled by default

    const cfg2 = config({ defaults: { fiveHour: false, weekly: false }, connections: { c1: { fiveHour: true } } });
    const clock2 = { t: T0 };
    const deps2 = makeDeps({ cfg: cfg2, usage: () => ({ quotas: { "session (5h)": quota(clock2.t === T0 ? T0 + 1000 : clock2.t + 5 * H) } }), clock: clock2 });
    const state2 = freshState();
    await runQuotaResetTick(deps2, state2);
    clock2.t = T0 + 2000;
    await runQuotaResetTick(deps2, state2);
    expect(deps2.send).toHaveBeenCalledTimes(1);       // account override wins
  });

  it("does not poll an account that wants no window", async () => {
    const clock = { t: T0 };
    const cfg = config({ defaults: { fiveHour: false, weekly: false } });
    const deps = makeDeps({ cfg, usage: { quotas: {} }, clock });
    await runQuotaResetTick(deps, freshState());
    expect(deps.fetchUsage).not.toHaveBeenCalled();
  });

  it("keeps what it knew when the provider answers with an error", async () => {
    const clock = { t: T0 };
    let answer = { quotas: { "session (5h)": quota(T0 + 1000) } };
    const deps = makeDeps({ usage: () => answer, clock });
    const state = freshState();
    await runQuotaResetTick(deps, state);
    clock.t = T0 + 2000; answer = { error: "boom" };
    await runQuotaResetTick(deps, state);
    expect(deps.send).not.toHaveBeenCalled();           // an error is not a reset
    clock.t = T0 + 3000; answer = { quotas: { "session (5h)": quota(T0 + 5 * H, 0) } };
    await runQuotaResetTick(deps, state);
    expect(deps.send).toHaveBeenCalledTimes(1);         // …and the reset is still caught later
  });

  it("isolates a failing account from the rest and still sends to every target", async () => {
    const clock = { t: T0 };
    const bad = { id: "bad", provider: "codex", name: "bad" };
    const two = config({ targets: [target, { ...target, id: "t2", name: "Slack", type: "slack" }] });
    const deps = makeDeps({ cfg: two, conns: [bad, conn], clock, usage: () => ({ quotas: { "session (5h)": quota(clock.t === T0 ? T0 + 1000 : clock.t + 5 * H) } }) });
    const original = deps.fetchUsage;
    deps.fetchUsage = vi.fn(async (c) => { if (c.id === "bad") throw new Error("down"); return original(c); });
    const state = freshState();
    await runQuotaResetTick(deps, state);
    clock.t = T0 + 2000;
    await runQuotaResetTick(deps, state);
    expect(deps.send).toHaveBeenCalledTimes(2);         // one account × two targets
  });
});

describe("sendToTarget", () => {
  it("reports HTTP failures without leaking the url or token", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 404 }));
    const r = await sendToTarget(target, { title: "t", text: "x" }, fetchImpl);
    expect(r).toEqual({ ok: false, error: "HTTP 404" });
    expect(JSON.stringify(r)).not.toContain("SECRETTOKEN");
    expect(fetchImpl.mock.calls[0][1].redirect).toBe("manual");
  });

  it("turns a thrown fetch into a safe error", async () => {
    const fetchImpl = vi.fn(async () => { throw new TypeError(`fetch failed ${target.url}`); });
    const r = await sendToTarget(target, { title: "t", text: "x" }, fetchImpl);
    expect(r).toEqual({ ok: false, error: "request failed" });
  });
});

describe("sendTestNotification", () => {
  it("marks the message as a test and targets one id", async () => {
    const send = vi.fn(async () => ({ ok: true }));
    const r = await sendTestNotification(config({ targets: [target, { ...target, id: "t2" }] }), "t2", send);
    expect(r.sent).toBe(1);
    expect(send.mock.calls[0][0].id).toBe("t2");
    expect(send.mock.calls[0][1].title).toContain("[테스트]");
  });

  it("reports when there is nothing to send to", async () => {
    const r = await sendTestNotification(config({ targets: [] }), undefined, vi.fn());
    expect(r.sent).toBe(0);
  });
});
