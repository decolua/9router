// Issue #3024 — Fusion combo must strip `stream_options` from panel requests
// when running non-streaming, or DeepSeek rejects with
// "stream_options should be set along with stream = true".

import { describe, it, expect, vi } from "vitest";
import { handleFusionChat } from "../../open-sse/services/combo.js";

// Minimal logger stub (combo.js calls log.info/warn).
const log = { info: () => {}, warn: () => {}, error: () => {} };

function makeBody(extra = {}) {
  return {
    model: "combo/gemseek",
    stream: true,
    stream_options: { include_usage: true },
    messages: [{ role: "user", content: "hi" }],
    ...extra,
  };
}

describe("Fusion strips stream_options (#3024)", () => {
  it("removes stream_options before fanning out to panel models", async () => {
    const body = makeBody();
    let capturedPanelBody = null;
    const handleSingleModel = vi.fn(async (panelBody, model, entry, isPanel) => {
      if (isPanel) capturedPanelBody = panelBody;
      // Simulate a successful non-stream JSON answer for the panel.
      if (isPanel) {
        return new Response(JSON.stringify({ choices: [{ message: { content: `ans-${model}` } }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      // Judge leg: return a final answer.
      return new Response(JSON.stringify({ choices: [{ message: { content: "final" } }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const res = await handleFusionChat({
      body,
      models: [
        { model: "ds/deepseek-v4-flash", connectionId: "deepseek-account" },
        { model: "gemini/gemini-3.5-flash-lite", connectionId: "gemini-account" },
      ],
      handleSingleModel,
      log,
      comboName: "GemSeek",
      judgeModel: "gemini/gemini-3.5-flash-lite",
    });

    expect(res).toBeInstanceOf(Response);
    expect(capturedPanelBody).not.toBeNull();
    // Critical assertion: stream_options must NOT leak into panel requests.
    expect(capturedPanelBody.stream_options).toBeUndefined();
    expect(capturedPanelBody.stream).toBe(false);
    // Ensure the original client body still had it (proves we stripped deliberately).
    expect(body.stream_options).toEqual({ include_usage: true });
    expect(handleSingleModel).toHaveBeenCalledWith(
      capturedPanelBody,
      "ds/deepseek-v4-flash",
      { model: "ds/deepseek-v4-flash", connectionId: "deepseek-account" },
      true
    );
  });

  it("does not throw for a 2-model fusion with stream_options present", async () => {
    const handleSingleModel = vi.fn(async (panelBody, model, isPanel) => {
      if (isPanel) {
        return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ choices: [{ message: { content: "final" } }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const res = await handleFusionChat({
      body: makeBody({ stream_options: { include_usage: true } }),
      models: ["ds/deepseek-v4-pro", "ds/deepseek-v4-flash"],
      handleSingleModel,
      log,
      comboName: "GemSeek",
      judgeModel: "ds/deepseek-v4-pro",
    });

    expect(res.status).toBe(200);
  });
});
