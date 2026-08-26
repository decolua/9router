import { describe, it, expect } from "vitest";
import { handleComboChat } from "../../open-sse/services/combo.js";

const encoder = new TextEncoder();
const log = { info() {}, warn() {} };
const sse = (stream) => new Response(stream, {
  headers: { "Content-Type": "text/event-stream" },
});

function run(models, handleSingleModel) {
  return handleComboChat({ body: {}, models, handleSingleModel, log, autoSwitch: false });
}

describe("combo streaming fallback", () => {
  it("cascades when a 200 SSE stream aborts before its first chunk", async () => {
    const calls = [];
    const response = await run(["provider/first", "provider/second"], async (_body, model) => {
      calls.push(model);
      if (model === "provider/first") {
        return sse(new ReadableStream({ start(controller) { controller.error(new Error("aborted")); } }));
      }
      return sse(new ReadableStream({ start(controller) {
        controller.enqueue(encoder.encode("data: recovered\n\n"));
        controller.close();
      } }));
    });

    expect(calls).toEqual(["provider/first", "provider/second"]);
    expect(await response.text()).toBe("data: recovered\n\n");
  });

  it("cascades when a 200 SSE stream closes empty", async () => {
    const calls = [];
    const response = await run(["provider/first", "provider/second"], async (_body, model) => {
      calls.push(model);
      if (model === "provider/first") {
        return sse(new ReadableStream({ start(controller) { controller.close(); } }));
      }
      return sse(new ReadableStream({ start(controller) {
        controller.enqueue(encoder.encode("data: recovered\n\n"));
        controller.close();
      } }));
    });

    expect(calls).toEqual(["provider/first", "provider/second"]);
    expect(await response.text()).toBe("data: recovered\n\n");
  });

  it("preserves every byte after a successful preflight", async () => {
    const first = "event: message_start\ndata: {\"type\":\"message_start\"}\n\n";
    const second = "event: message_stop\ndata: {\"type\":\"message_stop\"}\n\n";
    const response = await run(["provider/only"], async () => sse(new ReadableStream({ start(controller) {
      controller.enqueue(encoder.encode(first));
      controller.enqueue(encoder.encode(second));
      controller.close();
    } })));

    expect(await response.text()).toBe(first + second);
  });

  it("does not cascade after the first chunk reaches the response", async () => {
    const calls = [];
    let pulls = 0;
    const response = await run(["provider/first", "provider/second"], async (_body, model) => {
      calls.push(model);
      return sse(new ReadableStream({
        pull(controller) {
          if (pulls++ === 0) controller.enqueue(encoder.encode("data: committed\n\n"));
          else controller.error(new Error("late abort"));
        }
      }));
    });

    await expect(response.text()).rejects.toThrow("late abort");
    expect(calls).toEqual(["provider/first"]);
  });

  it("returns bad gateway when the final SSE stream closes empty", async () => {
    const response = await run(["provider/only"], async () => sse(new ReadableStream({
      start(controller) { controller.close(); }
    })));

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: { message: "stream ended before first event" } });
  });

  it("propagates client cancellation to the upstream reader", async () => {
    let cancelled = false;
    const response = await run(["provider/only"], async () => sse(new ReadableStream({
      start(controller) { controller.enqueue(encoder.encode("data: ready\n\n")); },
      cancel() { cancelled = true; }
    })));

    await response.body.cancel("client closed");
    expect(cancelled).toBe(true);
  });

  it("leaves non-SSE responses unchanged", async () => {
    const original = Response.json({ ok: true });
    const response = await run(["provider/only"], async () => original);

    expect(response).toBe(original);
  });
});
