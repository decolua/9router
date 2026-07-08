// Antigravity empty-stream guard — oh-my-pi parity: everything (thinking
// included) streams live; empty attempts are retried in-stream by splicing the
// retried upstream into the same client stream; exhaustion emits an in-stream
// {error} event (#2188, #2229, #2250, #2259).
import { describe, it, expect, vi } from "vitest";
import { createEmptyRetryStream } from "../../open-sse/handlers/chatCore/emptyStreamGuard.js";
import { translateResponse, initState } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const wrap = (response) => ({ response });
const thought = (text) => wrap({ candidates: [{ content: { role: "model", parts: [{ text, thought: true }] } }] });
const text = (t) => wrap({ candidates: [{ content: { role: "model", parts: [{ text: t }] } }] });
const finish = (finishReason) => wrap({ candidates: [{ finishReason }] });
const bareStop = () => wrap({ candidates: [{ content: { role: "model", parts: [] }, finishReason: "STOP" }] });

const sseText = (events) => events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");

function sseBody(events, { chunkSize } = {}) {
  const bytes = encoder.encode(sseText(events));
  return new ReadableStream({
    start(controller) {
      if (!chunkSize) {
        if (bytes.length) controller.enqueue(bytes);
      } else {
        for (let i = 0; i < bytes.length; i += chunkSize) {
          controller.enqueue(bytes.slice(i, i + chunkSize));
        }
      }
      controller.close();
    },
  });
}

async function drain(stream) {
  const reader = stream.getReader();
  let out = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  return out;
}

const dataEvents = (out) => out.split("\n")
  .map((l) => l.trim())
  .filter((l) => l.startsWith("data:"))
  .map((l) => JSON.parse(l.slice(5).trim()));

const finishEvents = (out) => dataEvents(out).filter((e) => (e.response || e).candidates?.[0]?.finishReason);

// Scripted attempts: attempt 0 is the initial body; each reexecute() serves the
// next list. Throws when the script runs out (exercises the reexecute-failure path).
async function runWrapper(attemptLists, { signal, onExhausted, reexecute, chunkSize } = {}) {
  let calls = 0;
  const stream = createEmptyRetryStream({
    body: sseBody(attemptLists[0], { chunkSize }),
    reexecute: reexecute || (async () => {
      calls++;
      const next = attemptLists[calls];
      if (!next) throw new Error("no scripted attempt left");
      return sseBody(next, { chunkSize });
    }),
    signal,
    onExhausted,
    log: null,
    baseDelayMs: 1,
  });
  const out = await drain(stream);
  return { out, retries: calls };
}

describe("createEmptyRetryStream", () => {
  it("streams thought-only chunks live and byte-faithfully before any answer", async () => {
    const events = [thought("let me think"), thought("still thinking"), text("Answer"), finish("STOP")];
    const { out, retries } = await runWrapper([events]);
    expect(out).toBe(sseText(events));
    expect(retries).toBe(0);
  });

  it("suppresses a bare-STOP empty attempt and splices the retry", async () => {
    const attempt2 = [text("Hello there"), finish("STOP")];
    const { out, retries } = await runWrapper([[bareStop()], attempt2]);
    expect(out).toBe(sseText(attempt2)); // attempt 1 fully withheld
    expect(retries).toBe(1);
    expect(finishEvents(out)).toHaveLength(1);
  });

  it("splices correctly when events are split across tiny reads", async () => {
    const attempt2 = [text("Split across reads"), finish("STOP")];
    const { out, retries } = await runWrapper([[bareStop()], attempt2], { chunkSize: 7 });
    expect(out).toBe(sseText(attempt2));
    expect(retries).toBe(1);
  });

  // The accepted oh-my-pi wart: a discarded thought-only attempt has already
  // streamed its thinking, so the client sees both attempts' thinking in one message.
  it("thought-only STOP attempt retries; both attempts' thinking reach the client", async () => {
    const { out, retries } = await runWrapper([
      [thought("first try"), bareStop()],
      [thought("second try"), text("answer"), finish("STOP")],
    ]);
    expect(out).toContain("first try");
    expect(out).toContain("second try");
    expect(retries).toBe(1);
    expect(finishEvents(out)).toHaveLength(1); // attempt 1's STOP withheld
  });

  it("exhaustion emits a synthetic error event and reports the reason", async () => {
    const onExhausted = vi.fn();
    const { out, retries } = await runWrapper(
      [[bareStop()], [bareStop()], [bareStop()]],
      { onExhausted },
    );
    expect(retries).toBe(2);
    expect(onExhausted).toHaveBeenCalledTimes(1);
    expect(onExhausted.mock.calls[0][0]).toContain("after 3 attempts");
    const events = dataEvents(out);
    expect(events).toHaveLength(1);
    expect(events[0].error.status).toBe("EMPTY_RESPONSE");
    expect(events[0].error.message).toContain("STOP");
  });

  it("exhaustion re-emits a held real upstream error instead of the synthetic one", async () => {
    const quota = wrap({ error: { code: 429, status: "RESOURCE_EXHAUSTED", message: "Quota exceeded" } });
    const { out, retries } = await runWrapper([[quota], [quota], [quota]]);
    expect(retries).toBe(2);
    const events = dataEvents(out);
    expect(events).toHaveLength(1); // held errors of earlier attempts never forwarded
    expect(events[0].response.error.status).toBe("RESOURCE_EXHAUSTED");
    expect(events[0].response.error.message).toBe("Quota exceeded");
  });

  it("MALFORMED_FUNCTION_CALL before content is withheld and retried", async () => {
    const attempt2 = [text("recovered"), finish("STOP")];
    const { out, retries } = await runWrapper([
      [thought("about to call the tool"), finish("MALFORMED_FUNCTION_CALL")],
      attempt2,
    ]);
    expect(retries).toBe(1);
    expect(out).not.toContain("MALFORMED_FUNCTION_CALL");
    expect(finishEvents(out)).toHaveLength(1);
  });

  it("MALFORMED_FUNCTION_CALL after content forwards (translator surfaces the error)", async () => {
    const events = [text("Partial answer"), finish("MALFORMED_FUNCTION_CALL")];
    const { out, retries } = await runWrapper([events]);
    expect(out).toBe(sseText(events));
    expect(retries).toBe(0);
  });

  // Content blocks are deterministic — never retried; the translator closes
  // them as content_filter (#2188).
  it("promptFeedback.blockReason forwards untouched with no retry", async () => {
    const events = [wrap({ promptFeedback: { blockReason: "SAFETY" } })];
    const { out, retries } = await runWrapper([events]);
    expect(out).toBe(sseText(events));
    expect(retries).toBe(0);
  });

  it("SAFETY finish with no content forwards untouched with no retry", async () => {
    const events = [thought("hmm"), finish("SAFETY")];
    const { out, retries } = await runWrapper([events]);
    expect(out).toBe(sseText(events));
    expect(retries).toBe(0);
  });

  it("MAX_TOKENS with no visible content forwards with no retry", async () => {
    const events = [thought("thinking ate the budget"), finish("MAX_TOKENS")];
    const { out, retries } = await runWrapper([events]);
    expect(out).toBe(sseText(events));
    expect(retries).toBe(0);
  });

  it("a stream truncated after content closes without retry", async () => {
    const events = [text("half an answer")];
    const { out, retries } = await runWrapper([events]);
    expect(out).toBe(sseText(events));
    expect(retries).toBe(0);
  });

  it("cancelling the wrapper cancels the upstream reader", async () => {
    let cancelled = false;
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(sseText([text("hi")])));
        // stream stays open
      },
      cancel() { cancelled = true; },
    });
    const stream = createEmptyRetryStream({ body, reexecute: async () => sseBody([]), baseDelayMs: 1 });
    const reader = stream.getReader();
    await reader.read();
    await reader.cancel();
    expect(cancelled).toBe(true);
  });

  it("client abort surfaces as an AbortError, not a retry", async () => {
    const ac = new AbortController();
    let ctrl;
    const body = new ReadableStream({ start(c) { ctrl = c; } }); // never emits
    ac.signal.addEventListener("abort", () => {
      ctrl.error(Object.assign(new Error("This operation was aborted"), { name: "AbortError" }));
    });
    const reexecute = vi.fn();
    const stream = createEmptyRetryStream({ body, reexecute, signal: ac.signal, baseDelayMs: 1 });
    const drained = drain(stream);
    setTimeout(() => ac.abort(), 10);
    await expect(drained).rejects.toMatchObject({ name: "AbortError" });
    expect(reexecute).not.toHaveBeenCalled();
  });

  // The error event triggers the client's automatic retry — the bench must have
  // landed before it, or the retry can re-pick the account that just failed.
  it("awaits onExhausted (account bench) before emitting the error event", async () => {
    const order = [];
    const stream = createEmptyRetryStream({
      body: sseBody([bareStop()]),
      reexecute: async () => { throw new Error("no more attempts"); },
      onExhausted: async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        order.push("benched");
      },
      baseDelayMs: 1,
    });
    const reader = stream.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (decoder.decode(value, { stream: true }).includes("error")) order.push("error-event");
    }
    expect(order).toEqual(["benched", "error-event"]);
  });

  it("passes the held upstream error to onExhausted so quota reset times can be parsed", async () => {
    const onExhausted = vi.fn();
    const quota = wrap({ error: { code: 429, status: "RESOURCE_EXHAUSTED", message: "Quota exceeded. Your quota will reset after 1h2m3s" } });
    await runWrapper([[quota], [quota], [quota]], { onExhausted });
    expect(onExhausted).toHaveBeenCalledTimes(1);
    expect(onExhausted.mock.calls[0][1].upstreamError.message).toContain("reset after 1h2m3s");
  });

  it("reexecute failure emits an error event carrying the upstream message", async () => {
    const onExhausted = vi.fn();
    const { out } = await runWrapper([[bareStop()]], {
      onExhausted,
      reexecute: async () => { throw new Error("[429] Quota exceeded for account"); },
    });
    const events = dataEvents(out);
    expect(events).toHaveLength(1);
    expect(events[0].error.message).toContain("[429] Quota exceeded for account");
    expect(onExhausted).toHaveBeenCalledTimes(1);
  });

  // End-to-end sanity: a spliced retry must still translate into ONE well-formed
  // Claude message (single message_start, single message_stop).
  it("spliced output translates to a single well-formed Claude message", async () => {
    const { out } = await runWrapper([
      [thought("first try"), bareStop()],
      [thought("second try"), text("final answer"), finish("STOP")],
    ]);
    const state = initState(FORMATS.CLAUDE);
    const claudeEvents = [];
    for (const parsed of dataEvents(out)) {
      const translated = translateResponse(FORMATS.ANTIGRAVITY, FORMATS.CLAUDE, parsed, state);
      if (translated?.length) claudeEvents.push(...translated.filter(Boolean));
    }
    const flushed = translateResponse(FORMATS.ANTIGRAVITY, FORMATS.CLAUDE, null, state);
    if (flushed?.length) claudeEvents.push(...flushed.filter(Boolean));

    expect(claudeEvents.filter((e) => e.type === "message_start")).toHaveLength(1);
    expect(claudeEvents.filter((e) => e.type === "message_stop")).toHaveLength(1);
    expect(claudeEvents.some((e) => e.delta?.type === "thinking_delta")).toBe(true);
    expect(claudeEvents.some((e) => e.delta?.type === "text_delta" && e.delta.text === "final answer")).toBe(true);
    const delta = claudeEvents.find((e) => e.type === "message_delta");
    expect(delta.delta.stop_reason).toBe("end_turn");
  });
});
