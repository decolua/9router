import { describe, it, expect } from "vitest";
import { handleComboChat } from "../../open-sse/services/combo.js";

// When every model in a combo fails, the response the client sees must describe
// ONE of those failures. It used to describe two: the status was pinned to the
// first failure and the message to the last, so a combo answered with e.g. a 403
// from model 1 carrying model 2's 429 text. That pair reads as one provider
// behaving incoherently, which is how #3729 was reported -- as fallback not
// running, when it had run and simply exhausted the list.

const log = { info() {}, warn() {}, error() {}, debug() {} };

const failure = (status, message) =>
  new Response(JSON.stringify({ error: { type: "server_error", message } }), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const success = () => new Response(JSON.stringify({ ok: true }), { status: 200 });

async function runCombo(models, responder, comboName) {
  const tried = [];
  const res = await handleComboChat({
    body: { messages: [] },
    models,
    handleSingleModel: async (_body, modelStr) => {
      tried.push(modelStr);
      return responder(modelStr);
    },
    log,
    comboName,
    comboStrategy: "priority",
  });
  let body = null;
  try {
    body = await res.clone().json();
  } catch {
    /* non-JSON body */
  }
  return { tried, status: res.status, message: body?.error?.message ?? null };
}

describe("combo failure reporting", () => {
  it("pairs the reported status with the message from the same model", async () => {
    const { status, message } = await runCombo(
      ["a", "b", "c"],
      (m) =>
        m === "a"
          ? failure(403, "console said 403")
          : m === "b"
            ? failure(429, "quota said 429")
            : failure(500, "last one said 500"),
      "pairing"
    );
    expect({ status, message }).toEqual({ status: 500, message: "last one said 500" });
  });

  it("still reports a single failure unchanged", async () => {
    const { status, message } = await runCombo(["solo"], () => failure(418, "only failure"), "solo");
    expect({ status, message }).toEqual({ status: 418, message: "only failure" });
  });

  it("keeps falling through a Console 403 to a model that works", async () => {
    // The behaviour #3729 asked for, which already worked: proving it here means
    // a future change to the fallback rules cannot quietly remove it.
    const { tried, status } = await runCombo(
      ["cl/z-ai/glm-5.3-flash", "oc/big-pickle"],
      (m) =>
        m === "cl/z-ai/glm-5.3-flash"
          ? failure(403, "Error from provider (Console): Upstream request failed: Model is unavailable.")
          : success(),
      "console-403"
    );
    expect(tried).toEqual(["cl/z-ai/glm-5.3-flash", "oc/big-pickle"]);
    expect(status).toBe(200);
  });

  it("pairs a thrown error with the 500 it is reported as", async () => {
    const { status, message } = await runCombo(
      ["a", "b"],
      (m) => {
        if (m === "a") return failure(403, "console said 403");
        throw new Error("adapter exploded");
      },
      "threw"
    );
    expect({ status, message }).toEqual({ status: 500, message: "adapter exploded" });
  });
});
