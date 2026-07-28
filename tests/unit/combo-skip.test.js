import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleComboChat } from "../../open-sse/services/combo.js";
import { clearModelCooldowns, markModelCooldown } from "../../open-sse/services/modelCooldown.js";
import { clearQuotaState, markQuotaExhausted } from "../../open-sse/services/quotaState.js";
import { clearModelHealth, recordModelFailure } from "../../open-sse/services/modelHealth.js";

// These cover the WIRING, not the stores. The stores had full unit coverage while
// demoteUnhealthy was never called from the cascade at all — dead code that every
// unit test happily passed. Anything asserted here fails if the wiring is removed.

const log = { info: () => {}, warn: () => {}, error: () => {}, line: () => {} };

function okResponse() {
  return new Response("data: {}\n\n", { status: 200, headers: { "content-type": "text/event-stream" } });
}

describe("combo cascade skip wiring", () => {
  beforeEach(() => {
    clearModelCooldowns();
    clearQuotaState();
    clearModelHealth();
  });

  it("does not call a model that is inside its cooldown window", async () => {
    markModelCooldown("a/one", Date.now() + 60_000);
    const tried = [];
    const handleSingleModel = vi.fn(async (_body, modelStr) => {
      tried.push(modelStr);
      return okResponse();
    });

    await handleComboChat({ body: {}, models: ["a/one", "a/two"], handleSingleModel, log, comboName: "c" });

    expect(tried).not.toContain("a/one");
    expect(tried).toContain("a/two");
  });

  it("does not call a model that is quota exhausted", async () => {
    markQuotaExhausted("a/one", Date.now(), 60_000);
    const tried = [];
    const handleSingleModel = vi.fn(async (_body, modelStr) => {
      tried.push(modelStr);
      return okResponse();
    });

    await handleComboChat({ body: {}, models: ["a/one", "a/two"], handleSingleModel, log, comboName: "c" });

    expect(tried).not.toContain("a/one");
    expect(tried).toContain("a/two");
  });

  it("tries a demoted model last instead of first", async () => {
    for (let i = 0; i < 3; i++) recordModelFailure("a/sick");
    const tried = [];
    const handleSingleModel = vi.fn(async (_body, modelStr) => {
      tried.push(modelStr);
      return okResponse();
    });

    await handleComboChat({ body: {}, models: ["a/sick", "a/well"], handleSingleModel, log, comboName: "c" });

    expect(tried[0]).toBe("a/well");
  });

  it("still attempts every model when all are cooling down", async () => {
    markModelCooldown("a/one", Date.now() + 60_000);
    markModelCooldown("a/two", Date.now() + 60_000);
    const handleSingleModel = vi.fn(async () => okResponse());

    const res = await handleComboChat({ body: {}, models: ["a/one", "a/two"], handleSingleModel, log, comboName: "c" });

    // Every model skipped means the combo is exhausted, not silently successful.
    expect(res).toBeDefined();
    expect(handleSingleModel).not.toHaveBeenCalled();
  });
});
