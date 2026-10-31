import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../translator/registerAll.js";

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: (...args) => fetchMock(...args),
}));
vi.mock("../../open-sse/utils/requestLogger.js", () => ({
  createRequestLogger: async () => ({
    logClientRawRequest: vi.fn(), logRawRequest: vi.fn(), logTargetRequest: vi.fn(),
    logProviderResponse: vi.fn(), logConvertedResponse: vi.fn(), logError: vi.fn(),
  }),
}));
vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(), appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}), saveRequestUsage: vi.fn(async () => {}),
}));

const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");
const model = "claude-sonnet-5";
// Opaque transport sentinels, not a claim about Anthropic's safeguard schema.
const safeguards = { future_extension: [{ nested: [false, null, "évidence"] }] };
const safeguardResults = { future_extension: { opaque: ["工具", 7, null, false] } };
const tools = [
  { type: "tool_use", id: "toolu_exact-A", name: "read_file", input: { path: "a" } },
  { type: "tool_use", id: "toolu_exact-B", name: "read_file", input: { path: "b" } },
];
const message = () => ({
  id: "msg_test", type: "message", role: "assistant", model, content: structuredClone(tools),
  stop_reason: "tool_use", stop_sequence: null, usage: { input_tokens: 1, output_tokens: 2 },
});

async function run(upstream, { provider = "claude", stream = false, messages } = {}) {
  fetchMock.mockResolvedValue(upstream);
  const body = {
    model, max_tokens: 64, stream, safeguards: structuredClone(safeguards),
    messages: messages || [{ role: "user", content: "Read the test files." }],
    tools: [{ name: "read_file", description: "Read a file", input_schema: { type: "object", properties: { path: { type: "string" } } } }],
  };
  const result = await handleChatCore({
    body, modelInfo: { provider, model }, credentials: { apiKey: "test-only-key", providerSpecificData: {} },
    sourceFormatOverride: "claude", connectionId: "test-only-connection",
    rtkEnabled: false, headroomEnabled: false, cavemanEnabled: false, ponytailEnabled: false, pxpipeEnabled: false,
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    clientRawRequest: { endpoint: "/v1/messages", body, headers: {
      "user-agent": "claude-cli/test", accept: stream ? "text/event-stream" : "application/json",
      "AnThRoPiC-VeRsIoN": "2099-01-01", "AnThRoPiC-BeTa": "opaque-test-extension",
    } },
  });
  return result;
}

function sseResponse(events) {
  const raw = events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join("");
  const bytes = new TextEncoder().encode(raw);
  // Single-byte chunks split JSON, delimiters and multibyte UTF-8 code points.
  return new Response(new ReadableStream({ start(controller) {
    for (let i = 0; i < bytes.length; i++) controller.enqueue(bytes.slice(i, i + 1));
    controller.close();
  } }), { headers: { "content-type": "text/event-stream" } });
}

function parseEvents(raw) {
  // Existing passthrough appends an OpenAI [DONE] sentinel; inspect native events separately.
  return raw.split(/\r?\n\r?\n/).filter(frame => frame && frame.trim() !== "data: [DONE]").map(frame => {
    const lines = frame.split(/\r?\n/);
    return [lines.find(line => line.startsWith("event: "))?.slice(7),
      JSON.parse(lines.filter(line => line.startsWith("data: ")).map(line => line.slice(6)).join("\n"))];
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected real network call"); }));
});
afterEach(() => vi.unstubAllGlobals());

describe("native Claude Auto transport preservation", () => {
  it.each(["claude", "anthropic", "anthropic-compatible-test"])("preserves request, headers, opaque JSON and tool IDs through %s", async provider => {
    const upstream = { ...message(), safeguard_results: safeguardResults, unknown_extension: { keep: true } };
    const result = await run(Response.json(upstream), { provider });
    expect(result.success).toBe(true);
    const received = await result.response.json();
    expect(received.safeguard_results).toEqual(upstream.safeguard_results);
    expect(received.unknown_extension).toEqual(upstream.unknown_extension);
    expect(received.content).toEqual(upstream.content);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body).safeguards).toEqual(safeguards);
    const headers = new Headers(init.headers);
    expect(headers.get("anthropic-version")).toBe("2099-01-01");
    expect(headers.get("anthropic-beta").split(",").map(x => x.trim())).toContain("opaque-test-extension");
  });

  it("retains exact tool-result references on the next request", async () => {
    const messages = [
      { role: "user", content: "Read files" },
      { role: "assistant", content: structuredClone(tools) },
      { role: "user", content: tools.map(tool => ({ type: "tool_result", tool_use_id: tool.id, content: "file content" })) },
    ];
    const result = await run(Response.json(message()), { messages });
    await result.response.text();
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sent.messages[1].content.map(x => x.id)).toEqual(tools.map(x => x.id));
    expect(sent.messages[2].content.map(x => x.tool_use_id)).toEqual(tools.map(x => x.id));
  });

  it.each(["claude", "anthropic", "anthropic-compatible-test"])("preserves fragmented SSE order, unknown fields, safeguards and tool IDs through %s", async provider => {
    const events = [
      ["message_start", { type: "message_start", message: { ...message(), content: [], safeguard_results: safeguardResults } }],
      ["future_safeguard_event", { type: "future_safeguard_event", safeguard_results: safeguardResults, unknown_extension: ["é", null] }],
      ...tools.flatMap((tool, index) => [
        ["content_block_start", { type: "content_block_start", index, content_block: tool }],
        ["content_block_stop", { type: "content_block_stop", index }],
      ]),
      ["message_delta", { type: "message_delta", delta: { stop_reason: "tool_use", stop_sequence: null }, usage: { output_tokens: 2 }, safeguard_results: safeguardResults, unknown_extension: { keep: true } }],
      ["message_stop", { type: "message_stop" }],
    ];
    const result = await run(sseResponse(events), { stream: true, provider });
    expect(result.success).toBe(true);
    expect(parseEvents(await result.response.text())).toEqual(events);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).safeguards).toEqual(safeguards);
  });

  it.each([false, true])("does not fabricate missing safeguard results (stream=%s)", async stream => {
    const events = [
      ["message_start", { type: "message_start", message: message() }],
      ["message_stop", { type: "message_stop" }],
    ];
    const result = await run(stream ? sseResponse(events) : Response.json(message()), { stream });
    const raw = await result.response.text();
    expect(raw).not.toContain("safeguard_results");
    if (stream) expect(parseEvents(raw)).toEqual(events);
    else expect(JSON.parse(raw)).not.toHaveProperty("safeguard_results");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).safeguards).toEqual(safeguards);
  });

  it("keeps upstream rejection an error without retrying stripped safeguards", async () => {
    const result = await run(Response.json({ type: "error", error: { type: "invalid_request_error", message: "unsupported safeguards" } }, { status: 400 }));
    expect(result.success).toBe(false);
    expect(result.response.status).toBe(400);
    const raw = await result.response.text();
    expect(raw).toContain("unsupported safeguards");
    expect(raw).not.toContain("safeguard_results");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).safeguards).toEqual(safeguards);
  });
});
