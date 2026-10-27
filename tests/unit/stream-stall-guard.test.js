// Regression: an upstream SSE stream that stops sending events while the socket stays open
// used to hang until the client gave up. guardStream bounds the silence.
import { describe, expect, it } from "vitest";
import { guardStream } from "../../open-sse/executors/base.js";

const enc = new TextEncoder();

function streamOf(steps) {
  let i = 0;
  return new Response(new ReadableStream({
    async pull(controller) {
      const step = steps[i++];
      if (!step) return controller.close();
      if (step === "stall") return new Promise(() => {});
      await new Promise((r) => setTimeout(r, step.delay || 0));
      controller.enqueue(enc.encode(step.text));
    },
  }), { status: 200, headers: { "content-type": "text/event-stream" } });
}

async function readAll(response) {
  const reader = response.body.getReader();
  let out = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return out;
    out += new TextDecoder().decode(value);
  }
}

describe("guardStream", () => {
  it("passes a healthy stream through unchanged", async () => {
    const guarded = await guardStream(streamOf([{ text: "a" }, { text: "b" }]), { firstChunkMs: 200, idleMs: 200 });
    expect(guarded.status).toBe(200);
    expect(guarded.headers.get("content-type")).toBe("text/event-stream");
    expect(await readAll(guarded)).toBe("ab");
  });

  it("rejects when no first chunk arrives in time", async () => {
    await expect(guardStream(streamOf(["stall"]), { firstChunkMs: 30, idleMs: 200 }))
      .rejects.toThrow(/no first chunk/);
  });

  it("errors the stream when it stalls mid-answer, after delivering what arrived", async () => {
    const guarded = await guardStream(streamOf([{ text: "a" }, "stall"]), { firstChunkMs: 200, idleMs: 30 });
    const reader = guarded.body.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toBe("a");
    await expect(reader.read()).rejects.toThrow(/no chunk/);
  });

  it("handles a stream that ends before any chunk", async () => {
    const guarded = await guardStream(streamOf([]), { firstChunkMs: 200, idleMs: 200 });
    expect(await readAll(guarded)).toBe("");
  });
});
