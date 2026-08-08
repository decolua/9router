// Integration: routing metadata (failFast) must survive to the Response combo
// receives, so combo skips the cooldown wait and jumps to the next model fast.
// This is the #1/#3 fix — the skip→exhaust path builds a NEW errorResponse, so the
// meta has to be re-attached there (not just on the direct-return object).
import { describe, expect, it, vi } from "vitest";
import { handleComboChat } from "../../open-sse/services/combo.js";
import { setRoutingMeta } from "../../open-sse/services/routingMeta.js";
import { errorResponse } from "../../open-sse/utils/error.js";

const log = { info: () => {}, warn: () => {}, error: () => {} };

// A 503 whose text hits the "request not allowed" rule → cooldownMs 5000 (≤5000),
// which is exactly the branch combo would WAIT on unless fail-fast is signalled.
function transientResponse({ failFast }) {
  const resp = errorResponse(503, "request not allowed");
  if (failFast != null) setRoutingMeta(resp, { errorKind: failFast ? "connect_timeout" : null, status: 503, failFast });
  return resp;
}

describe("combo fail-fast honors routing metadata", () => {
  it("skips the cooldown wait when the failed Response is flagged failFast", async () => {
    let waited = 0;
    const realSetTimeout = globalThis.setTimeout;
    vi.spyOn(globalThis, "setTimeout").mockImplementation((fn, ms) => {
      waited += ms || 0;
      return realSetTimeout(fn, 0); // fire immediately so the test stays fast
    });

    const models = ["prov/m1", "prov/m2"];
    const handleSingleModel = vi.fn()
      .mockResolvedValueOnce(transientResponse({ failFast: true }))  // model 1 fails, fail-fast
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));   // model 2 succeeds

    const out = await handleComboChat({ body: {}, models, handleSingleModel, log, comboName: "c" });
    // Snapshot before restoring: vi.restoreAllMocks() also clears vi.fn() call
    // history, so the assertion has to read the count captured here.
    const modelCalls = handleSingleModel.mock.calls.length;
    vi.restoreAllMocks();

    expect(out.status).toBe(200);
    expect(modelCalls).toBe(2);
    expect(waited).toBe(0); // fail-fast → no cooldown delay before the next model
  });

  it("waits the cooldown when the failure is NOT flagged fail-fast", async () => {
    let waited = 0;
    const realSetTimeout = globalThis.setTimeout;
    vi.spyOn(globalThis, "setTimeout").mockImplementation((fn, ms) => {
      waited += ms || 0;
      return realSetTimeout(fn, 0);
    });

    const models = ["prov/m1", "prov/m2"];
    const handleSingleModel = vi.fn()
      .mockResolvedValueOnce(transientResponse({ failFast: false })) // model 1 fails, normal
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));

    const out = await handleComboChat({ body: {}, models, handleSingleModel, log, comboName: "c" });
    vi.restoreAllMocks();

    expect(out.status).toBe(200);
    expect(waited).toBe(5000); // transient 503 → combo waited the cooldown
  });
});
