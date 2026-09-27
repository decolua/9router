import { describe, it, expect } from "vitest";
import {
  bodyErrorFromJson,
  classifyBodyErrorStatus,
  extractBodyError,
  guardStreamHead,
  inspectSseHead,
  resolveHoldMs,
  scanSse,
} from "../../open-sse/utils/upstreamBodyError.js";

const enc = new TextEncoder();
const CREDITS = "the provider for model kimi-k2.7 has exhausted its credits and cannot process requests";
const frame = (obj) => `data: ${JSON.stringify(obj)}\n\n`;
const content = (text) => frame({ choices: [{ index: 0, delta: { content: text }, finish_reason: null }] });

/** A Response whose body arrives as the given pieces, `gapMs` apart. */
function streamOf(pieces, { gapMs = 0, status = 200, headers = { "content-type": "text/event-stream" }, hang = false } = {}) {
  let i = 0;
  let cancelled = false;
  const body = new ReadableStream({
    async pull(controller) {
      // `hang`: the upstream stays open after its last piece, like a live generation.
      if (i >= pieces.length) { if (hang) await new Promise(() => {}); controller.close(); return; }
      if (gapMs) await new Promise((r) => setTimeout(r, gapMs));
      controller.enqueue(enc.encode(pieces[i++]));
    },
    cancel() { cancelled = true; },
  });
  return { response: new Response(body, { status, headers }), wasCancelled: () => cancelled };
}

const drain = async (response) => new TextDecoder().decode(await response.arrayBuffer());

describe("extractBodyError", () => {
  it("reads a string error, an error object and Claude's typed error", () => {
    expect(extractBodyError({ error: CREDITS }).message).toBe(CREDITS);
    expect(extractBodyError({ error: { message: "boom", type: "x" } }).message).toBe("boom");
    expect(extractBodyError({ type: "error", error: { type: "overloaded_error", message: "Overloaded" } }).message).toBe("Overloaded");
  });

  it("takes a numeric status out of the body", () => {
    expect(extractBodyError({ error: { message: "m", code: 429 } }).status).toBe(429);
    expect(extractBodyError({ error: { message: "m", code: "503" } }).status).toBe(503);
    expect(extractBodyError({ error: { message: "m", code: "billing" } }).status).toBeNull();
  });

  it("does not mistake a completion for an error", () => {
    expect(extractBodyError({ id: "r", object: "response", status: "completed", error: null, output: [] })).toBeNull();
    expect(extractBodyError({ choices: [{ message: { content: "x" } }], error: "stale" })).toBeNull();
    expect(extractBodyError({ candidates: [{}], error: { message: "x" } })).toBeNull();
    expect(extractBodyError({ choices: [] })).toBeNull();
    expect(extractBodyError(null)).toBeNull();
    expect(extractBodyError([{ error: "x" }])).toBeNull();
    expect(extractBodyError({ error: 42 })).toBeNull();
  });
});

describe("classifyBodyErrorStatus", () => {
  it("maps wording to the status that locks and falls back correctly", () => {
    expect(classifyBodyErrorStatus({ message: CREDITS })).toBe(402);
    expect(classifyBodyErrorStatus({ message: "Insufficient balance" })).toBe(402);
    expect(classifyBodyErrorStatus({ message: "Rate limit reached" })).toBe(429);
    expect(classifyBodyErrorStatus({ message: "The engine is currently overloaded" })).toBe(429);
    expect(classifyBodyErrorStatus({ message: "Invalid API key" })).toBe(401);
    expect(classifyBodyErrorStatus({ message: "something odd" })).toBe(502);
    expect(classifyBodyErrorStatus({ message: CREDITS, status: 503 })).toBe(503);
  });

  it("bodyErrorFromJson combines the two", () => {
    expect(bodyErrorFromJson({ error: CREDITS })).toEqual({ status: 402, message: CREDITS });
    expect(bodyErrorFromJson({ choices: [{}] })).toBeNull();
  });
});

describe("inspectSseHead", () => {
  it("is undecided until a frame is complete", () => {
    expect(inspectSseHead("")).toBeNull();
    expect(inspectSseHead('data: {"error": "x')).toBeNull();
    expect(inspectSseHead(": keep-alive\n\n")).toBeNull();
  });

  it("flags an error first frame, an event: error frame and a bare JSON error", () => {
    expect(inspectSseHead(frame({ error: CREDITS })).error.status).toBe(402);
    expect(inspectSseHead(`event: error\ndata: ${JSON.stringify({ type: "error", error: { message: "Overloaded" } })}\n\n`).error.status).toBe(429);
    expect(inspectSseHead(JSON.stringify({ error: CREDITS })).error.status).toBe(402);
    expect(inspectSseHead(`event: error\ndata: not json\n\n`).error.message).toBe("not json");
  });

  it("looks past keep-alive comments to the first real frame", () => {
    expect(inspectSseHead(`: ping\n\n: ping\n\n${frame({ error: CREDITS })}`).error.status).toBe(402);
    expect(inspectSseHead(`: ping\n\n${content("hi")}`).error).toBeNull();
  });

  it("calls the stream good as soon as it opens with content, even if an error follows", () => {
    expect(inspectSseHead(content("hello") + frame({ error: "late" })).error).toBeNull();
    expect(inspectSseHead("data: [DONE]\n\n").error).toBeNull();
    expect(inspectSseHead('data: {"cho', true).error).toBeNull();
  });
});

describe("scanSse", () => {
  it("finds an error behind earlier content frames", () => {
    const scan = scanSse(content("a") + content("b") + frame({ error: CREDITS }));
    expect(scan.frames).toBe(2);
    expect(scan.error).toEqual({ status: 402, message: CREDITS });
  });

  it("counts frames and notes the terminator", () => {
    const scan = scanSse(content("a") + "data: [DONE]\n\n");
    expect(scan).toMatchObject({ frames: 1, done: true, error: null });
  });

  it("stops at the first real frame when asked", () => {
    const scan = scanSse(content("a") + frame({ error: "late" }), false, { firstOnly: true });
    expect(scan).toMatchObject({ frames: 1, error: null });
  });

  it("marks a bare JSON body as decided", () => {
    expect(scanSse(JSON.stringify({ id: "x", choices: [{}] })).bare).toBe(true);
    expect(scanSse('{"id": "x", "cho').bare).toBe(false);
  });
});

describe("resolveHoldMs", () => {
  it("defaults to 500 ms, takes a number from the environment and clamps it", () => {
    expect(resolveHoldMs({})).toBe(500);
    expect(resolveHoldMs({ STREAM_ERROR_HOLD_MS: "0" })).toBe(0);
    expect(resolveHoldMs({ STREAM_ERROR_HOLD_MS: "250" })).toBe(250);
    expect(resolveHoldMs({ STREAM_ERROR_HOLD_MS: "-5" })).toBe(500);
    expect(resolveHoldMs({ STREAM_ERROR_HOLD_MS: "abc" })).toBe(500);
    expect(resolveHoldMs({ STREAM_ERROR_HOLD_MS: "999999" })).toBe(10_000);
  });
});

describe("guardStreamHead", () => {
  it("reports an error first frame and cancels the upstream body", async () => {
    const { response, wasCancelled } = streamOf([frame({ error: CREDITS }), "data: [DONE]\n\n"]);
    const out = await guardStreamHead(response);
    expect(out.response).toBeUndefined();
    expect(out.error).toEqual({ status: 402, message: CREDITS });
    expect(wasCancelled()).toBe(true);
  });

  it("reads an error that arrives split across chunks", async () => {
    const whole = frame({ error: CREDITS });
    const { response } = streamOf([whole.slice(0, 9), whole.slice(9, 30), whole.slice(30)]);
    expect((await guardStreamHead(response)).error.status).toBe(402);
  });

  it("replays a healthy stream byte for byte, including what was read ahead", async () => {
    const pieces = [content("a"), content("b"), content("c"), "data: [DONE]\n\n"];
    const { response } = streamOf(pieces);
    const out = await guardStreamHead(response);
    expect(out.error).toBeUndefined();
    expect(out.response.status).toBe(200);
    expect(out.response.headers.get("content-type")).toBe("text/event-stream");
    expect(await drain(out.response)).toBe(pieces.join(""));
  });

  it("fails over on an error that follows the first content within the hold window", async () => {
    const { response, wasCancelled } = streamOf([content("partial"), frame({ error: CREDITS }), "data: [DONE]\n\n"]);
    const out = await guardStreamHead(response, { holdMs: 500 });
    expect(out.response).toBeUndefined();
    expect(out.error).toEqual({ status: 402, message: CREDITS });
    expect(wasCancelled()).toBe(true);
  });

  it("does not take back an error that comes after the hold window", async () => {
    const pieces = [content("partial"), frame({ error: "late failure" }), "data: [DONE]\n\n"];
    // The error arrives 150 ms after the first frame; the window is 40 ms.
    const { response } = streamOf(pieces, { gapMs: 150 });
    const out = await guardStreamHead(response, { holdMs: 40 });
    expect(out.error).toBeUndefined();
    expect(await drain(out.response)).toBe(pieces.join(""));
  });

  it("decides on the first frame alone when the hold window is 0", async () => {
    const pieces = [content("partial"), frame({ error: "late failure" }), "data: [DONE]\n\n"];
    const out = await guardStreamHead(streamOf(pieces).response, { holdMs: 0 });
    expect(out.error).toBeUndefined();
    expect(await drain(out.response)).toBe(pieces.join(""));
  });

  it("releases a healthy stream once enough bytes are held, without waiting out the window", async () => {
    const big = content("x".repeat(600));
    const pieces = [big, big, big, big, big, big, big, "data: [DONE]\n\n"];
    const started = Date.now();
    const out = await guardStreamHead(streamOf(pieces, { gapMs: 5 }).response, { holdMs: 5000, holdBytes: 1500 });
    expect(Date.now() - started).toBeLessThan(2000);
    expect(out.error).toBeUndefined();
    expect(await drain(out.response)).toBe(pieces.join(""));
  });

  it("commits a stream whose first frame is slow, without losing it", async () => {
    const pieces = [content("late"), "data: [DONE]\n\n"];
    const { response } = streamOf(pieces, { gapMs: 80 });
    const out = await guardStreamHead(response, { timeoutMs: 20 });
    expect(out.error).toBeUndefined();
    expect(await drain(out.response)).toBe(pieces.join(""));
  });

  it("stops reading at the byte cap and still replays the whole stream", async () => {
    const pieces = Array.from({ length: 20 }, (_, i) => `: ${"x".repeat(100)} ${i}\n\n`).concat([content("end")]);
    const out = await guardStreamHead(streamOf(pieces).response, { maxBytes: 300 });
    expect(out.error).toBeUndefined();
    expect(await drain(out.response)).toBe(pieces.join(""));
  });

  it("passes a failed or bodiless response through untouched", async () => {
    const failed = new Response("nope", { status: 500 });
    expect((await guardStreamHead(failed)).response).toBe(failed);
    const empty = new Response(null, { status: 200 });
    expect((await guardStreamHead(empty)).response).toBe(empty);
  });

  it("propagates a client cancel to the upstream", async () => {
    const { response, wasCancelled } = streamOf([content("a"), content("b"), content("c")], { hang: true });
    const out = await guardStreamHead(response, { holdMs: 30 });
    await out.response.body.cancel();
    expect(wasCancelled()).toBe(true);
  });
});
