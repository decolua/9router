import { describe, it, expect } from "vitest";
import {
  parseSseBlock,
  iterateSseEvents,
  collectSseToCompleted,
  buildXaiHeaders,
  resolveXaiBearer,
} from "../../src/lib/providers/xai/executor.js";

function makeStream(chunks) {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
}

describe("xai/executor parseSseBlock", () => {
  it("parses a single named event with data", () => {
    const block = "event: response.created\ndata: {\"a\":1}\n\nevent: response.completed\ndata: {\"b\":2}";
    const events = parseSseBlock(block);
    expect(events).toEqual([
      { event: "response.created", data: '{"a":1}' },
      { event: "response.completed", data: '{"b":2}' },
    ]);
  });
  it("ignores comments and unknown fields", () => {
    const block = ":comment\nevent: ping\nid: 7\ndata: hello";
    const events = parseSseBlock(block);
    expect(events).toEqual([{ event: "ping", data: "hello" }]);
  });
  it("concatenates multi-line data with newlines", () => {
    const block = "event: x\ndata: line1\ndata: line2";
    expect(parseSseBlock(block)).toEqual([{ event: "x", data: "line1\nline2" }]);
  });
});

describe("xai/executor iterateSseEvents", () => {
  it("yields events across chunk boundaries", async () => {
    const stream = makeStream([
      "event: a\ndata: 1\n\nevent: b\nda",
      "ta: 2\n\n",
      "event: c\ndata: 3\n\n",
    ]);
    const out = [];
    for await (const ev of iterateSseEvents(stream)) out.push(ev);
    expect(out).toEqual([
      { event: "a", data: "1" },
      { event: "b", data: "2" },
      { event: "c", data: "3" },
    ]);
  });
  it("flushes trailing event without blank line", async () => {
    const stream = makeStream(["event: tail\ndata: bye"]);
    const out = [];
    for await (const ev of iterateSseEvents(stream)) out.push(ev);
    expect(out).toEqual([{ event: "tail", data: "bye" }]);
  });
});
