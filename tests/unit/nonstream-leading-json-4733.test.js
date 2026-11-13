import { describe, expect, it, vi } from "vitest";

// The module's heavy import chain (translator → db paths → @/lib/dataDir) is
// irrelevant to this pure helper, so stub it out.
vi.mock("@/lib/dataDir.js", () => ({ DATA_DIR: "/tmp/9r-test-data" }));
vi.mock("@/lib/db/paths.js", () => ({ DB_DIR: "/tmp/9r-test-data/db" }));
vi.mock("@/lib/usageDb.js", () => ({
  saveRequestUsage: vi.fn(async () => {}),
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
}));

const { extractLeadingJsonObject } = await import(
  "../../open-sse/handlers/chatCore/nonStreamingHandler.js"
);

// #4733 — a non-streaming client (stream omitted or false) must get a clean
// JSON object back, not the upstream's trailing SSE framing.

describe("#4733 extractLeadingJsonObject — strip trailing SSE framing", () => {
  it("returns the JSON object when the body is pure JSON", () => {
    const body = '{"id":"x","object":"chat.completion","choices":[],"lastOne":false}';
    expect(extractLeadingJsonObject(body)).toMatchObject({ id: "x", lastOne: false });
  });

  it("returns the JSON object when a `data: [DONE]` frame trails it", () => {
    const body = '{"id":"x","object":"chat.completion","choices":[],"lastOne":false}data: [DONE]\n\n';
    expect(extractLeadingJsonObject(body)).toMatchObject({ id: "x", lastOne: false });
  });

  it("returns the JSON object when a trailing `data: {...}` SSE frame trails it", () => {
    const body =
      '{"id":"x","choices":[],"lastOne":false}data: {"id":"x","choices":[]}data: [DONE]\n\n';
    expect(extractLeadingJsonObject(body)).toMatchObject({ id: "x", lastOne: false });
  });

  it("handles nested braces inside the JSON (choices array of objects)", () => {
    const body =
      '{"choices":[{"message":{"role":"assistant","content":"hi"},"finish_reason":"stop"}]}data: [DONE]';
    expect(extractLeadingJsonObject(body)).toMatchObject({
      choices: [{ message: { role: "assistant", content: "hi" } }],
    });
  });

  it("handles braces inside string values", () => {
    const body = '{"content":"a {brace} and }brace","lastOne":false}data: [DONE]';
    expect(extractLeadingJsonObject(body)).toMatchObject({ content: "a {brace} and }brace" });
  });

  it("returns null when there is no leading JSON object", () => {
    expect(extractLeadingJsonObject("data: [DONE]\n\ndata: [DONE]")).toBeNull();
    expect(extractLeadingJsonObject("")).toBeNull();
    expect(extractLeadingJsonObject("not json at all")).toBeNull();
  });

  it("returns null for an unbalanced (truncated) JSON object", () => {
    expect(extractLeadingJsonObject('{"choices":[{"a":')).toBeNull();
  });
});
