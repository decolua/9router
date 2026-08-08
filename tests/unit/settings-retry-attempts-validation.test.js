/**
 * PATCH /api/settings validation for skip-rule `retryAttempts`.
 *
 * The field only makes sense on a retry rule (extra calls to the SAME account), so
 * the API refuses it on a skip rule rather than storing a shape nothing reads.
 * Range and integer-ness are enforced here as well as in the modal, because the
 * modal is not the only writer.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(async () => ({})),
  updateSettings: vi.fn(async (v) => v),
}));

vi.mock("@/lib/localDb", () => ({
  getSettings: mocks.getSettings,
  updateSettings: mocks.updateSettings,
}));
vi.mock("@/lib/network/outboundProxy", () => ({ applyOutboundProxyEnv: vi.fn() }));

const { PATCH } = await import("../../src/app/api/settings/route.js");

function patch(body) {
  return PATCH(new Request("http://localhost/api/settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
}

const rule = (over) => ({ provider: "kr-ac", match: { status: 502 }, action: "retry", ...over });

beforeEach(() => vi.clearAllMocks());

describe("retryAttempts validation", () => {
  it("accepts any positive integer on a retry rule (no upper bound)", async () => {
    for (const n of [1, 5, 10, 11, 50, 1000]) {
      const res = await patch({ providerSkipRules: [rule({ retryAttempts: n })] });
      expect(res.status).toBe(200);
    }
  });

  it("accepts a retry rule that omits the field", async () => {
    const res = await patch({ providerSkipRules: [rule()] });
    expect(res.status).toBe(200);
  });

  it("rejects it on a skip rule", async () => {
    const res = await patch({
      providerSkipRules: [{ provider: "kr-ac", match: { status: 502 }, action: "skip", retryAttempts: 2 }],
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/retryAttempts/);
  });

  it.each([0, -1, 2.5, "3", true, [], {}])("rejects %p", async (bad) => {
    const res = await patch({ providerSkipRules: [rule({ retryAttempts: bad })] });
    expect(res.status).toBe(400);
  });

  it.each([null, undefined, NaN])("treats %p as absent, not as a bad value", async (blank) => {
    // JSON.stringify turns undefined and NaN into absent/null on the wire, so the
    // server can never observe them as values; asserting a 400 here would be
    // testing the serializer, not the validator.
    const res = await patch({ providerSkipRules: [rule({ retryAttempts: blank })] });
    expect(res.status).toBe(200);
  });

  it("keeps existing skip-rule validation intact", async () => {
    const bad = await patch({ providerSkipRules: [{ provider: "kr-ac", match: {}, action: "retry" }] });
    expect(bad.status).toBe(400);
    const sweepOnRetry = await patch({ providerSkipRules: [rule({ sweep: true })] });
    expect(sweepOnRetry.status).toBe(400);
  });
});
