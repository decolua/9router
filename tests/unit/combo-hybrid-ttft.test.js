import { describe, it, expect, vi } from "vitest";

import { handleComboChat } from "../../open-sse/services/combo.js";

const log = { info: () => {}, warn: () => {}, debug: () => {} };

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const enc = (s) => new TextEncoder().encode(s);

// Non-streaming Response stubs (same surface as combo-hybrid.test.js).
function okResponse(content) {
  const json = { choices: [{ message: { role: "assistant", content } }] };
  const make = () => ({ ok: true, status: 200, clone: make, json: async () => json, body: null, bodyUsed: false });
  return make();
}

function errResponse(status = 500) {
  const make = () => ({ ok: false, status, clone: make, json: async () => ({ error: { message: "boom" } }), body: null, bodyUsed: false });
  return make();
}

// A streaming Response that resolves (headers) after headerDelayMs and emits
// its first token firstTokenDelayMs after the stream starts. `stall: true`
// sends headers but never a token — a provider that hangs after a fast 200.
// Exposes a `canceled` flag to assert loser cleanup.
function streamResponse({ headerDelayMs = 0, firstTokenDelayMs = 0, tokens = [], stall = false, status = 200 } = {}) {
  const state = { canceled: false };
  const stream = new ReadableStream({
    async start(controller) {
      await delay(firstTokenDelayMs);
      if (stall) return; // never enqueues, never closes
      for (const t of tokens) {
        controller.enqueue(enc(t));
        await delay(5);
      }
      controller.close();
    },
    cancel() { state.canceled = true; },
  });
  const response = delay(headerDelayMs).then(
    () => new Response(stream, { status, headers: { "Content-Type": "text/event-stream" } })
  );
  return { response, state };
}

async function readAll(res) {
  const reader = res.body.getReader();
  let out = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out += new TextDecoder().decode(value);
  }
  return out;
}

const streamBody = { stream: true, messages: [{ role: "user", content: "hi" }] };

describe("hybrid combo strategy — streaming first-token race", () => {
  it("selects the winner by first token, not by HTTP headers", async () => {
    // p/trickler answers 200 fast but trickles tokens (headers win, tokens lose).
    // p/steady answers 200 slower but produces its first token far sooner.
    const trickler = streamResponse({ headerDelayMs: 5, firstTokenDelayMs: 300, tokens: ["trickler"] });
    const steady = streamResponse({ headerDelayMs: 20, firstTokenDelayMs: 40, tokens: ["steady"] });

    const seen = [];
    const handleSingleModel = vi.fn(async (_b, model) => {
      seen.push(model);
      return model === "p/trickler" ? trickler.response : steady.response;
    });

    const res = await handleComboChat({
      body: streamBody,
      models: ["p/trickler", "p/steady", "p/third"],
      handleSingleModel,
      log,
      comboStrategy: "hybrid",
      autoSwitch: false,
    });

    // Only the raced pair was fired; the trickler must NOT win despite faster headers.
    expect(seen.sort()).toEqual(["p/steady", "p/trickler"]);
    expect(await readAll(res)).toBe("steady");
    expect(res.status).toBe(200);

    // Loser's stream is canceled so its body doesn't leak.
    await delay(30);
    expect(trickler.state.canceled).toBe(true);
  });

  it("falls back sequentially when neither raced model produces a first token in time", async () => {
    const stalled1 = streamResponse({ headerDelayMs: 5, stall: true });
    const stalled2 = streamResponse({ headerDelayMs: 5, stall: true });
    const rescue = streamResponse({ headerDelayMs: 5, firstTokenDelayMs: 5, tokens: ["rescued"] });

    const seen = [];
    const handleSingleModel = async (_b, model) => {
      seen.push(model);
      if (model === "p/a") return stalled1.response;
      if (model === "p/b") return stalled2.response;
      return rescue.response;
    };

    const res = await handleComboChat({
      body: streamBody,
      models: ["p/a", "p/b", "p/c"],
      handleSingleModel,
      log,
      comboStrategy: "hybrid",
      autoSwitch: false,
      firstTokenTimeoutMs: 80,
    });

    // Raced pair stalled → deadline hit → sequential fallback reached p/c.
    expect(seen).toContain("p/a");
    expect(seen).toContain("p/b");
    expect(seen).toContain("p/c");
    expect(await readAll(res)).toBe("rescued");

    // The stalled raced streams were canceled, not left hanging.
    await delay(30);
    expect(stalled1.state.canceled).toBe(true);
    expect(stalled2.state.canceled).toBe(true);
  });

  it("rebuilds the winner's stream so the client receives every chunk in order", async () => {
    const parts = [
      'data: {"delta":"Hel"}\n\n',
      'data: {"delta":"lo"}\n\n',
      "data: [DONE]\n\n",
    ];
    const winner = streamResponse({ headerDelayMs: 5, firstTokenDelayMs: 10, tokens: parts });
    const loser = streamResponse({ headerDelayMs: 5, firstTokenDelayMs: 400, tokens: ["loser"] });

    const handleSingleModel = async (_b, model) => (model === "p/w" ? winner.response : loser.response);

    const res = await handleComboChat({
      body: streamBody,
      models: ["p/w", "p/l"],
      handleSingleModel,
      log,
      comboStrategy: "hybrid",
      autoSwitch: false,
    });

    // The peeked first chunk plus everything that arrived after must survive
    // the rebuild byte-identically, with original status + headers.
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/event-stream");
    expect(await readAll(res)).toBe(parts.join(""));
  });

  it("still races on headers for non-streaming requests", async () => {
    const seen = [];
    const handleSingleModel = vi.fn(async (_b, model) => {
      seen.push(model);
      if (model === "p/a" || model === "p/b") return errResponse(500);
      return okResponse(`ok-${model}`);
    });

    const res = await handleComboChat({
      body: { messages: [{ role: "user", content: "hi" }] }, // no stream flag
      models: ["p/a", "p/b", "p/c"],
      handleSingleModel,
      log,
      comboStrategy: "hybrid",
      autoSwitch: false,
    });

    expect(seen).toContain("p/c");
    const json = await res.clone().json();
    expect(json.choices[0].message.content).toBe("ok-p/c");
  });
});
