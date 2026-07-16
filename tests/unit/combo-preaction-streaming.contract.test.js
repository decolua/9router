import { afterEach, describe, expect, it } from "vitest";

import { handleComboChat } from "../../open-sse/services/combo.js";

const log = { info() {}, warn() {} };
const encoder = new TextEncoder();

function sseResponse(chunks) {
  return new Response(new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  }), { headers: { "Content-Type": "text/event-stream" } });
}

function actionEvent(text = "ready") {
  return `event: response.output_text.delta\ndata: ${JSON.stringify({
    type: "response.output_text.delta",
    delta: text,
  })}\n\n`;
}

async function runCombo(handleSingleModel) {
  return handleComboChat({
    body: {
      model: "coding-pro",
      input: [{ role: "user", content: "Use the tool when useful" }],
      tools: [{ type: "function", name: "lookup", parameters: { type: "object" } }],
    },
    models: ["provider/model-a", "provider/model-b"],
    comboName: "coding-pro",
    comboStrategy: "fallback",
    handleSingleModel,
    log,
  });
}

afterEach(() => {
  delete process.env.COMBO_RESPONSE_FIRST_ACTION_TIMEOUT_MS;
  delete process.env.COMBO_RESPONSE_PREFLIGHT_MAX_BYTES;
});

describe("proposed Combo pre-action streaming contract", () => {
  it.fails("falls back when a successful SSE response terminates before an action", async () => {
    const tried = [];
    const response = await runCombo(async (_body, model) => {
      tried.push(model);
      return model === "provider/model-a"
        ? sseResponse(["event: response.completed\ndata: {\"type\":\"response.completed\",\"response\":{\"output\":[]}}\n\n"])
        : sseResponse([actionEvent("fallback")]);
    });

    expect(tried).toEqual(["provider/model-a", "provider/model-b"]);
    expect(await response.text()).toContain("fallback");
  });

  it.fails("does not resolve before the first action and replays the exact prefix once", async () => {
    let timer;
    const prefix = ": keep-alive\n\n";
    const action = actionEvent("ready");
    const responsePromise = runCombo(async () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(prefix));
        timer = setTimeout(() => {
          controller.enqueue(encoder.encode(action));
          controller.close();
        }, 30);
      },
      cancel() {
        clearTimeout(timer);
      },
    }), { headers: { "Content-Type": "text/event-stream" } }));

    const early = await Promise.race([
      responsePromise.then(() => "resolved"),
      new Promise((resolve) => setTimeout(() => resolve("pending"), 5)),
    ]);
    expect(early).toBe("pending");

    const response = await responsePromise;
    expect(await response.text()).toBe(prefix + action);
  });

  it.fails("bounds bytes buffered before the first action and falls back", async () => {
    process.env.COMBO_RESPONSE_PREFLIGHT_MAX_BYTES = "8";
    const tried = [];
    const response = await runCombo(async (_body, model) => {
      tried.push(model);
      return model === "provider/model-a"
        ? sseResponse([": 123456789\n\n", actionEvent("too-late")])
        : sseResponse([actionEvent("fallback")]);
    });

    try {
      expect(tried).toEqual(["provider/model-a", "provider/model-b"]);
      expect(await response.text()).toContain("fallback");
    } finally {
      await response.body?.cancel().catch(() => {});
    }
  });

  it.fails("times out and cancels a stream stalled before its first action", async () => {
    process.env.COMBO_RESPONSE_FIRST_ACTION_TIMEOUT_MS = "10";
    const tried = [];
    let cancellations = 0;
    const response = await runCombo(async (_body, model) => {
      tried.push(model);
      if (model === "provider/model-b") return sseResponse([actionEvent("fallback")]);
      return new Response(new ReadableStream({
        start() {},
        cancel() {
          cancellations += 1;
        },
      }), { headers: { "Content-Type": "text/event-stream" } });
    });

    try {
      expect(tried).toEqual(["provider/model-a", "provider/model-b"]);
      expect(cancellations).toBe(1);
      expect(await response.text()).toContain("fallback");
    } finally {
      await response.body?.cancel().catch(() => {});
    }
  });

  it("never falls back after an actionable event has been released", async () => {
    const tried = [];
    const response = await runCombo(async (_body, model) => {
      tried.push(model);
      return new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(actionEvent("committed")));
          controller.error(new Error("late upstream failure"));
        },
      }), { headers: { "Content-Type": "text/event-stream" } });
    });

    await expect(response.text()).rejects.toThrow("late upstream failure");
    expect(tried).toEqual(["provider/model-a"]);
  });

  it("preserves non-LLM response types byte-for-byte", async () => {
    const bytes = new Uint8Array([0, 1, 2, 255]);
    const response = await runCombo(async () => new Response(bytes, {
      headers: { "Content-Type": "application/octet-stream" },
    }));

    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
  });
});
