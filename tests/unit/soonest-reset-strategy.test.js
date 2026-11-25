// "soonest-reset" strategy: the account whose quota window resets first is drained first,
// so its quota comes back first. Exhausted accounts go last.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/network/connectionProxy", () => ({ resolveConnectionProxyConfig: async () => ({}) }));
const getUsageForProvider = vi.fn();
vi.mock("open-sse/services/usage.js", () => ({ getUsageForProvider: (...a) => getUsageForProvider(...a) }));

const { orderBySoonestReset, bindingWindow, isExhausted, getQuotaSnapshot } = await import(
  "../../src/sse/services/quotaResetOrder.js"
);

const NOW = Date.parse("2026-01-01T00:00:00Z");
const H = 3_600_000;
const at = (hours) => new Date(NOW + hours * H).toISOString();
const win = (free, resetH) => ({ remainingPercentage: free, resetAt: at(resetH), unlimited: false });
const weekly = (free, resetH, extra = {}) => ({ "weekly (7d)": win(free, resetH), ...extra });
const conn = (id, priority) => ({ id, priority });
const order = (conns, quotas) => orderBySoonestReset(conns, new Map(Object.entries(quotas)), NOW).map((c) => c.id);

describe("orderBySoonestReset", () => {
  it("puts the soonest weekly reset first, regardless of priority", () => {
    const conns = [conn("a", 1), conn("b", 2), conn("c", 3)];
    expect(order(conns, { a: weekly(100, 160), b: weekly(97, 11), c: weekly(65, 38) })).toEqual(["b", "c", "a"]);
  });

  it("sends an exhausted account last even when it resets soonest", () => {
    const conns = [conn("a", 1), conn("b", 2)];
    expect(order(conns, { a: weekly(0, 1), b: weekly(50, 100) })).toEqual(["b", "a"]);
  });

  it("treats a 0% short window (5h session) as exhausted too", () => {
    const conns = [conn("a", 1), conn("b", 2)];
    const a = weekly(80, 5, { "session (5h)": win(0, 2) });
    expect(order(conns, { a, b: weekly(50, 100) })).toEqual(["b", "a"]);
  });

  it("breaks a same-hour reset tie by more free quota", () => {
    const conns = [conn("a", 1), conn("b", 2)];
    expect(order(conns, { a: weekly(10, 24), b: weekly(90, 24.2) })).toEqual(["b", "a"]);
  });

  it("orders a past or unknown reset after every known future reset", () => {
    const conns = [conn("past", 1), conn("none", 2), conn("future", 3)];
    expect(order(conns, { past: weekly(100, -5), future: weekly(20, 100) })).toEqual(["future", "past", "none"]);
  });

  it("keeps priority order when no quota is known yet (same as fill-first)", () => {
    const conns = [conn("b", 2), conn("a", 1), conn("c", 3)];
    expect(order(conns, {})).toEqual(["a", "b", "c"]);
  });

  it("still orders by reset when every account is exhausted", () => {
    const conns = [conn("a", 1), conn("b", 2)];
    expect(order(conns, { a: weekly(0, 50), b: weekly(0, 5) })).toEqual(["b", "a"]);
  });
});

describe("bindingWindow / isExhausted", () => {
  it("binds on the longest window, not the 5h session", () => {
    const q = weekly(70, 100, { "session (5h)": win(40, 3) });
    expect(bindingWindow(q, NOW).resetAt).toBe(at(100));
  });

  it("ignores unlimited and already-reset windows", () => {
    expect(isExhausted({ x: { ...win(0, -1) } }, NOW)).toBe(false);
    expect(isExhausted({ x: { ...win(0, 5), unlimited: true } }, NOW)).toBe(false);
    expect(isExhausted({ x: win(0, 5) }, NOW)).toBe(true);
  });
});

describe("getQuotaSnapshot", () => {
  beforeEach(() => getUsageForProvider.mockReset());

  it("never blocks selection and fills the snapshot in the background", async () => {
    getUsageForProvider.mockResolvedValue({ quotas: weekly(50, 10) });
    const c = conn("snap-1", 1);
    expect(getQuotaSnapshot([c]).has("snap-1")).toBe(false);
    await vi.waitFor(() => expect(getQuotaSnapshot([c]).get("snap-1")).toEqual(weekly(50, 10)));
    expect(getUsageForProvider).toHaveBeenCalledTimes(1);
  });

  it("keeps the last good snapshot when usage soft-fails", async () => {
    getUsageForProvider.mockResolvedValue({ message: "rate limited", quotas: {} });
    const c = conn("snap-2", 1);
    getQuotaSnapshot([c]);
    await vi.waitFor(() => expect(getUsageForProvider).toHaveBeenCalledTimes(1));
    expect(getQuotaSnapshot([c]).has("snap-2")).toBe(false);
  });
});
