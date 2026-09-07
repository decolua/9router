import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  MAX_DEVIN_FRAME_PAYLOAD,
  normalizeDevinSessionToken,
  frameDevinConnect,
  parseDevinConnectFrames,
  decodeDevinChatDelta,
  decodeDevinChatDeltas,
  buildDevinChatRequest,
  decodeDevinTrailer,
  buildUserJwtRequest,
} from "open-sse/executors/devin.js";

function stringField(field, value) {
  const bytes = Buffer.from(value);
  return Buffer.concat([Buffer.from([field << 3 | 2, bytes.length]), bytes]);
}

function messageField(field, payload) {
  return Buffer.concat([Buffer.from([field << 3 | 2, payload.length]), payload]);
}

describe("Devin protocol", () => {
  it("normalizes the session token once", () => {
    expect(normalizeDevinSessionToken("abc")).toBe("devin-session-token$abc");
    expect(normalizeDevinSessionToken("devin-session-token$abc")).toBe("devin-session-token$abc");
  });

  it("includes the IDE version required by GetUserJwt", () => {
    const payload = buildUserJwtRequest("token");
    expect(payload.toString("utf8")).toContain("3.2.23");
  });

  it("round-trips a compressed Connect frame", () => {
    const payload = Buffer.from("hello");
    const frame = frameDevinConnect(payload);
    const parsed = parseDevinConnectFrames(frame);
    expect(parsed.rest.length).toBe(0);
    expect(parsed.frames).toHaveLength(1);
    expect(parsed.frames[0].compressed).toBe(true);
    expect(parsed.frames[0].payload).toEqual(payload);
    expect(gzipSync).toBeDefined();
  });

  it("keeps incomplete frames for the next network read", () => {
    const frame = frameDevinConnect(Buffer.from("hello"));
    const first = parseDevinConnectFrames(frame.subarray(0, 6));
    expect(first.frames).toEqual([]);
    expect(first.rest).toEqual(frame.subarray(0, 6));
  });

  it("rejects oversized Connect frames", () => {
    const header = Buffer.alloc(5);
    header.writeUInt32BE(MAX_DEVIN_FRAME_PAYLOAD + 1, 1);
    expect(() => parseDevinConnectFrames(header)).toThrow(/exceeds/i);
  });

  it("decodes text and thinking deltas", () => {
    expect(decodeDevinChatDelta(stringField(3, "hello"))).toEqual({ type: "text", value: "hello" });
    expect(decodeDevinChatDelta(stringField(9, "reason"))).toEqual({ type: "thinking", value: "reason" });
  });

  it("preserves multiple deltas carried in one protobuf payload", () => {
    expect(decodeDevinChatDeltas(Buffer.concat([stringField(3, "hello"), stringField(9, "reason")]))).toEqual([
      { type: "text", value: "hello" },
      { type: "thinking", value: "reason" },
    ]);
  });

  it("encodes OpenAI assistant tool_calls into the Devin prompt", () => {
    const payload = buildDevinChatRequest({
      model: "swe-1-7",
      apiKey: "token",
      userJwt: "jwt",
      body: { messages: [{ role: "assistant", tool_calls: [{ id: "call-1", function: { name: "run", arguments: JSON.stringify({ x: 1 }) } }] }] },
    });
    expect(payload.toString("utf8")).toContain("call-1");
    expect(payload.toString("utf8")).toContain("run");
  });

  it("decodes tool, usage, stop, and message deltas", () => {
    const tool = Buffer.concat([stringField(1, "call-1"), stringField(2, "run"), stringField(3, "{\"x\":1}")]);
    const usage = Buffer.from([0x10, 0x0a, 0x18, 0x14, 0x20, 0x02, 0x28, 0x01]);
    expect(decodeDevinChatDelta(messageField(6, tool))).toEqual({
      type: "tool", id: "call-1", name: "run", argumentsJson: "{\"x\":1}",
    });
    expect(decodeDevinChatDelta(messageField(7, usage))).toEqual({
      type: "usage", input: 10, output: 20, cacheWrite: 2, cacheRead: 1,
    });
    expect(decodeDevinChatDelta(Buffer.from([0x28, 0x01]))).toEqual({ type: "stop", reason: 1 });
    expect(decodeDevinChatDelta(stringField(1, "message-1"))).toEqual({ type: "message", id: "message-1" });
  });

  it("reads JSON trailer errors", () => {
    expect(decodeDevinTrailer(Buffer.from(JSON.stringify({ error: { message: "quota" } })))).toBe("quota");
    expect(decodeDevinTrailer(Buffer.from("not-json"))).toBeUndefined();
  });
});
