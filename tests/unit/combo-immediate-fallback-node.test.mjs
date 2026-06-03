import assert from "node:assert/strict";
import test from "node:test";

import { handleComboChat } from "../../open-sse/services/combo.js";

const log = {
  info() {},
  warn() {},
  error() {},
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("combo fallback immediately tries next model on timeout status without sleeping", async () => {
  const calls = [];

  const response = await handleComboChat({
    body: { model: "combo" },
    models: ["provider-a/model-a", "provider-b/model-b"],
    log,
    handleSingleModel: async (_body, model) => {
      calls.push({ model, at: Date.now() });
      if (model === "provider-a/model-a") {
        return jsonResponse({ error: { message: "Gateway timeout" } }, 504);
      }
      return jsonResponse({ ok: true }, 200);
    },
    comboName: "combo",
    comboStrategy: "fallback",
  });

  assert.equal(response.status, 200);
  assert.deepEqual(calls.map(call => call.model), ["provider-a/model-a", "provider-b/model-b"]);
  assert.ok(calls[1].at - calls[0].at < 1000, `fallback waited ${calls[1].at - calls[0].at}ms`);
});

test("combo fallback immediately tries next model on overloaded 503 without sleeping", async () => {
  const calls = [];

  const response = await handleComboChat({
    body: { model: "combo" },
    models: ["provider-a/model-a", "provider-b/model-b"],
    log,
    handleSingleModel: async (_body, model) => {
      calls.push({ model, at: Date.now() });
      if (model === "provider-a/model-a") {
        return jsonResponse({ error: { message: "provider overloaded" } }, 503);
      }
      return jsonResponse({ ok: true }, 200);
    },
    comboName: "combo",
    comboStrategy: "fallback",
  });

  assert.equal(response.status, 200);
  assert.deepEqual(calls.map(call => call.model), ["provider-a/model-a", "provider-b/model-b"]);
  assert.ok(calls[1].at - calls[0].at < 1000, `fallback waited ${calls[1].at - calls[0].at}ms`);
});

test("combo fallback immediately tries next model when model handler throws timeout", async () => {
  const calls = [];

  const response = await handleComboChat({
    body: { model: "combo" },
    models: ["provider-a/model-a", "provider-b/model-b"],
    log,
    handleSingleModel: async (_body, model) => {
      calls.push(model);
      if (model === "provider-a/model-a") {
        throw new Error("Request timeout");
      }
      return jsonResponse({ ok: true }, 200);
    },
    comboName: "combo",
    comboStrategy: "fallback",
  });

  assert.equal(response.status, 200);
  assert.deepEqual(calls, ["provider-a/model-a", "provider-b/model-b"]);
});
