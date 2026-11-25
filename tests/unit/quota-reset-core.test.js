import { describe, it, expect } from "vitest";
import {
  classifyWindow, detectResets, isWindowEnabled, renderTemplate, buildVars, buildRequest,
} from "@/shared/services/quotaResetCore.js";

const H = 3600000;
const T0 = Date.parse("2026-11-24T00:00:00Z");
const q = (resetAt, used = 40) => ({ used, total: 100, remaining: 100 - used, resetAt: new Date(resetAt).toISOString(), unlimited: false });

describe("classifyWindow", () => {
  it.each([
    ["session (5h)", "fiveHour"], ["session", "fiveHour"], ["spark_session", "fiveHour"],
    ["weekly (7d)", "weekly"], ["weekly sonnet (7d)", "weekly"], ["weekly", "weekly"],
    ["monthly", null], ["", null],
  ])("%s -> %s", (key, want) => expect(classifyWindow(key)).toBe(want));
});

describe("detectResets", () => {
  it("learns the first look without notifying", () => {
    const { events, next } = detectResets({}, { "session (5h)": q(T0 + 2 * H) }, T0);
    expect(events).toEqual([]);
    expect(next["session (5h)"]).toMatchObject({ window: "fiveHour", usedPercent: 40 });
  });

  it("does not fire while the window is still open", () => {
    const prev = { "session (5h)": { resetAt: T0 + 2 * H, usedPercent: 40, window: "fiveHour" } };
    expect(detectResets(prev, { "session (5h)": q(T0 + 2 * H) }, T0 + H).events).toEqual([]);
  });

  it("fires once the resetAt passed and the provider moved to a later window", () => {
    const prev = { "session (5h)": { resetAt: T0, usedPercent: 87, window: "fiveHour" } };
    const { events, next } = detectResets(prev, { "session (5h)": q(T0 + 5 * H, 0) }, T0 + 60000);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ window: "fiveHour", previousUsedPercent: 87, nextResetAt: T0 + 5 * H });
    expect(next["session (5h)"].resetAt).toBe(T0 + 5 * H);
  });

  it("does not fire while the provider still reports the old window (stale or skewed)", () => {
    const prev = { "session (5h)": { resetAt: T0, usedPercent: 87, window: "fiveHour" } };
    const { events, next } = detectResets(prev, { "session (5h)": q(T0 + 20000) }, T0 + 60000);
    expect(events).toEqual([]);
    expect(next["session (5h)"]).toBe(prev["session (5h)"]);
  });

  it("fires when resetAt becomes null (window unopened until the next message)", () => {
    const prev = { "session (5h)": { resetAt: T0, usedPercent: 50, window: "fiveHour" } };
    const quotas = { "session (5h)": { used: 0, total: 100, remaining: 100, resetAt: null, unlimited: false } };
    const { events } = detectResets(prev, quotas, T0 + 1000);
    expect(events).toHaveLength(1);
    expect(events[0].nextResetAt).toBeNull();
  });

  it("fires when the key disappears after its window ended, but not before", () => {
    const prev = { "session (5h)": { resetAt: T0, usedPercent: 50, window: "fiveHour" } };
    expect(detectResets(prev, {}, T0 + 1000).events).toHaveLength(1);
    const early = detectResets(prev, {}, T0 - 1000);
    expect(early.events).toEqual([]);
    expect(early.next["session (5h)"]).toBe(prev["session (5h)"]);
  });

  it("never fires for a sliding window that always sits ahead of now", () => {
    let state = {};
    for (let i = 0; i < 5; i++) {
      const now = T0 + i * 60000;
      const r = detectResets(state, { session: q(now + 5 * H) }, now);
      expect(r.events).toEqual([]);
      state = r.next;
    }
  });

  it("ignores unlimited and unclassified quotas, and does not mutate prev", () => {
    const prev = { "session (5h)": { resetAt: T0, usedPercent: 1, window: "fiveHour" } };
    const frozen = JSON.stringify(prev);
    const { events, next } = detectResets(prev, { credits: q(T0 - H), session: { unlimited: true } }, T0 + 1);
    expect(JSON.stringify(prev)).toBe(frozen);
    expect(Object.keys(next)).not.toContain("credits");
    expect(events.every((e) => e.quotaKey !== "credits")).toBe(true);
  });

  it("reports weekly and 5h resets independently", () => {
    const prev = {
      "session (5h)": { resetAt: T0, usedPercent: 10, window: "fiveHour" },
      "weekly (7d)": { resetAt: T0 + 24 * H, usedPercent: 30, window: "weekly" },
    };
    const { events } = detectResets(prev, { "session (5h)": q(T0 + 5 * H, 0), "weekly (7d)": q(T0 + 24 * H) }, T0 + 1000);
    expect(events.map((e) => e.window)).toEqual(["fiveHour"]);
  });
});

describe("isWindowEnabled", () => {
  const cfg = { defaults: { fiveHour: true, weekly: false }, connections: { a: { weekly: true, fiveHour: false } } };
  it("uses defaults, with per-account overrides on top", () => {
    expect(isWindowEnabled(cfg, "x", "fiveHour")).toBe(true);
    expect(isWindowEnabled(cfg, "x", "weekly")).toBe(false);
    expect(isWindowEnabled(cfg, "a", "weekly")).toBe(true);
    expect(isWindowEnabled(cfg, "a", "fiveHour")).toBe(false);
    expect(isWindowEnabled(undefined, "a", "weekly")).toBe(false);
  });
});

describe("renderTemplate / buildVars", () => {
  it("fills known placeholders and keeps unknown ones visible", () => {
    expect(renderTemplate("{a} {b} {zzz}", { a: 1, b: "x" })).toBe("1 x {zzz}");
  });
  it("builds Korean-labelled variables", () => {
    const vars = buildVars({
      provider: "claude", account: "me@x.com", now: T0, timeZone: "UTC",
      event: { quotaKey: "weekly (7d)", window: "weekly", previousResetAt: T0, previousUsedPercent: 91, nextResetAt: null },
    });
    expect(vars).toMatchObject({ provider: "claude", account: "me@x.com", window: "주간", usedPercent: 91, nextResetAt: "다음 요청 시 시작" });
  });
});

describe("buildRequest", () => {
  const msg = { title: "T", text: "body" };
  it("slack and discord wrap the message", () => {
    expect(buildRequest({ type: "slack", url: "https://h" }, msg).body.text).toContain("body");
    expect(buildRequest({ type: "discord", url: "https://h" }, msg).body.content).toContain("body");
  });
  it("telegram targets sendMessage with chat id", () => {
    const r = buildRequest({ type: "telegram", botToken: "123:abc", chatId: "-100" }, msg);
    expect(r.url).toBe("https://api.telegram.org/bot123:abc/sendMessage");
    expect(r.body.chat_id).toBe("-100");
  });
  it("generic sends exactly title/text/level for the Bot notify webhook", () => {
    expect(buildRequest({ type: "generic", url: "http://bot" }, msg).body).toEqual({ title: "T", text: "body", level: "info" });
  });
});
