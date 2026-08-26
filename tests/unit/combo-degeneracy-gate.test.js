import { describe, it, expect } from "vitest";
import { handleComboChat } from "../../open-sse/services/combo.js";

const encoder = new TextEncoder();
const log = { info() {}, warn() {} };
const sse = (stream) => new Response(stream, { headers: { "Content-Type": "text/event-stream" } });

// Client-format frames, which is what the preflight sees: the stream reaching it
// has already been translated.
const frames = (...texts) => sse(new ReadableStream({
  start(controller) {
    for (const t of texts) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}\n\n`));
    }
    controller.enqueue(encoder.encode("data: [DONE]\n\n"));
    controller.close();
  },
}));

const body = (userText) => ({ messages: [{ role: "user", content: userText }] });

function run(models, handleSingleModel, requestBody = {}) {
  return handleComboChat({ body: requestBody, models, handleSingleModel, log, autoSwitch: false });
}

describe("combo hold-back window: a degenerate opening never reaches the client", () => {
  it("fails over when the reply resumes the user's sentence", async () => {
    const calls = [];
    const response = await run(["p/gemini", "p/backup"], async (_b, model) => {
      calls.push(model);
      return model === "p/gemini"
        ? frames(" you seems like halluc", "inating again")
        : frames("Here is a real answer to your question.");
    }, body("what task currently we on?"));

    expect(calls).toEqual(["p/gemini", "p/backup"]);
    expect(await response.text()).toContain("Here is a real answer");
  });

  it("fails over when the reply opens on sentence punctuation", async () => {
    const calls = [];
    const response = await run(["p/gemini", "p/backup"], async (_b, model) => {
      calls.push(model);
      return model === "p/gemini"
        ? frames(". JUST WHAT YOU HAVE DONE IN THIS CURRENT SESSION")
        : frames("A proper reply that answers the question asked.");
    }, body("REMEMBER, YOUR WORK, YOUR CHANGES"));

    expect(calls).toEqual(["p/gemini", "p/backup"]);
    expect(await response.text()).toContain("A proper reply");
  });

  it("delivers a good stream byte-for-byte, replaying everything it held", async () => {
    const calls = [];
    const response = await run(["p/first"], async (_b, model) => {
      calls.push(model);
      return frames("Here is the first part ", "and the second part ", "and the third.");
    }, body("please explain the routing logic in detail"));

    expect(calls).toEqual(["p/first"]);
    const text = await response.text();
    // Every chunk held during judging must still be present, in order.
    expect(text).toContain("Here is the first part");
    expect(text).toContain("and the second part");
    expect(text).toContain("and the third.");
    expect(text.trimEnd().endsWith("data: [DONE]")).toBe(true);
  });

  it("does not judge a stream that produces no visible text", async () => {
    // Tool-call-only openings are normal and carry no prose to judge.
    const toolOnly = sse(new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0 }] } }] })}\n\n`));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    }));

    const calls = [];
    const response = await run(["p/only"], async (_b, model) => { calls.push(model); return toolOnly; }, body("run the tests"));

    expect(calls).toEqual(["p/only"]);
    expect(await response.text()).toContain("tool_calls");
  });

  it("leaves non-SSE responses alone", async () => {
    const json = new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
    const response = await run(["p/only"], async () => json, body("hello"));
    expect(await response.text()).toContain("ok");
  });
});
