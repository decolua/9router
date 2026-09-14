import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ getSettings: vi.fn(), getCombos: vi.fn(), getModelAliases: vi.fn(), validateApiKey: vi.fn() }));
vi.mock("@/lib/localDb", () => db);
const { routeChatGPTResponse } = await import("../../src/lib/chatgpt/endpoint.js");
const { sealCompactionSummary, openCompactionSummary } = await import("../../src/lib/chatgpt/compact.js");
const key = "qa-router-key", model = "9router/Coding", summary = "Changed app.js; tests passed. Next: review the diff.";
const completion = () => Response.json({ status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: summary }] }], usage: { input_tokens: 1000, output_tokens: 25 } });
const request = (body, apiKey = key, signal) => new Request("http://router/api/chatgpt/v1/responses", { method: "POST", headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" }, body: JSON.stringify({ model, ...body }), signal });
const events = text => text.split("\n").filter(line => line.startsWith("data: ")).map(line => JSON.parse(line.slice(6)));

beforeEach(() => {
  vi.clearAllMocks();
  db.getSettings.mockResolvedValue({ chatgptIntegration: { models: [{ id: "Coding" }] } });
  db.validateApiKey.mockResolvedValue(true);
});

describe("Codex remote compaction v2", () => {
  it("recognizes the Responses trigger and emits exactly one completed compaction item", async () => {
    const handler = vi.fn(async req => {
      const body = await req.json();
      expect(body).toMatchObject({ model: "Coding", stream: false, max_output_tokens: 8192 });
      expect(body.tools).toBeUndefined();
      expect(body.instructions).toContain("Summarize");
      expect(JSON.parse(body.input[0].content[0].text).history).toEqual([{ role: "user", content: "Fix app.js" }]);
      return completion();
    });
    const response = await routeChatGPTResponse(request({ input: [{ role: "user", content: "Fix app.js" }, { type: "compaction_trigger" }], tools: [{ type: "function", name: "exec_command" }], stream: true }), handler);
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    const output = events(await response.text());
    const items = output.filter(event => event.type === "response.output_item.done");
    expect(items).toHaveLength(1);
    expect(items[0].item.type).toBe("compaction");
    expect(openCompactionSummary(items[0].item.encrypted_content, key)).toBe(summary);
    expect(output.at(-1)).toMatchObject({ type: "response.completed", response: { object: "response", model, status: "completed", output: [items[0].item] } });
    expect(output.at(-1).response.usage).toEqual({ input_tokens: 1000, output_tokens: 25, total_tokens: 1025 });
  });
  it.each([false, true])("restores state for continuation and repeated compaction (compact=%s)", async again => {
    const item = { type: "compaction", encrypted_content: sealCompactionSummary(summary, key) };
    const handler = vi.fn(async req => {
      const body = await req.json();
      const history = again ? JSON.parse(body.input[0].content[0].text).history : body.input;
      expect(history[0]).toMatchObject({ type: "message", role: "assistant", content: expect.stringContaining(summary) });
      expect(JSON.stringify(body)).not.toContain(item.encrypted_content);
      expect(JSON.stringify(body)).not.toContain("compaction_trigger");
      return completion();
    });
    const response = await routeChatGPTResponse(request({ input: [item, { role: "user", content: "Continue" }, ...(again ? [{ type: "compaction_trigger" }] : [])], stream: false }), handler);
    expect(response.status).toBe(200);
    const output = await response.json();
    expect(output.output[0].type).toBe(again ? "compaction" : "message");
  });
  it.each([
    [{ type: "compaction_trigger" }, { role: "user", content: "out of order" }],
    [{ type: "compaction_trigger" }, { type: "compaction_trigger" }],
    [{ type: "compaction", encrypted_content: "foreign-openai-state" }],
    [{ type: "context_compaction" }],
  ].map(input => ({ input })))("rejects unusable state or trigger placement before inference: $input", async ({ input }) => {
    const handler = vi.fn();
    expect((await routeChatGPTResponse(request({ input }), handler)).status).toBe(400);
    expect(handler).not.toHaveBeenCalled();
  });
  it("rejects corrupted state and state belonging to another API key", async () => {
    const state = sealCompactionSummary(summary, key);
    const tampered = state.slice(0, -5) + (state.at(-5) === "A" ? "B" : "A") + state.slice(-4);
    for (const [value, apiKey] of [[tampered, key], [state, "different-authorized-router-key"]]) {
      const handler = vi.fn();
      expect((await routeChatGPTResponse(request({ input: [{ type: "compaction", encrypted_content: value }] }, apiKey), handler)).status).toBe(400);
      expect(handler).not.toHaveBeenCalled();
    }
  });
  it.each(["failed", "incomplete", "in_progress", undefined])("does not install a summary with status %s", async status => {
    const body = await completion().json(); body.status = status;
    const response = await routeChatGPTResponse(request({ input: [{ type: "compaction_trigger" }], stream: true }), async () => Response.json(body));
    expect(response.status).toBe(502);
    expect(response.headers.get("content-type")).not.toContain("event-stream");
  });
  it("preserves upstream errors and cancellation", async () => {
    const controller = new AbortController();
    let forwarded;
    const failure = new Response("provider unavailable", { status: 503 });
    const result = await routeChatGPTResponse(request({ input: [{ type: "compaction_trigger" }], stream: true }, key, controller.signal), async req => { forwarded = req; return failure; });
    controller.abort();
    expect(forwarded.signal.aborted).toBe(true);
    expect(result).toBe(failure);
  });
});
