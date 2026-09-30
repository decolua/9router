import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {})
}));

const { stripContinuityFields } = await import("../../open-sse/handlers/chatCore.js");
const { openaiResponsesToOpenAIRequest } = await import("../../open-sse/translator/request/openai-responses.js");

// Multi-turn Codex-style Responses input: reasoning item carrying a
// store=false encrypted_content continuity blob between tool turns.
const makeResponsesBody = () => ({
  model: "x",
  instructions: "You are Codex.",
  store: false,
  include: ["reasoning.encrypted_content"],
  reasoning: { effort: "low", summary: "auto" },
  input: [
    { role: "user", content: [{ type: "input_text", text: "Run: echo hi" }] },
    {
      type: "reasoning",
      id: "rs_1",
      summary: [{ type: "summary_text", text: "thinking" }],
      encrypted_content: "B".repeat(5000)
    },
    { type: "function_call", id: "fc_1", call_id: "call_1", name: "shell", arguments: "{\"command\":\"echo hi\"}" },
    { type: "function_call_output", call_id: "call_1", output: "hi" },
    { role: "user", content: [{ type: "input_text", text: "Now run: echo bye" }] }
  ],
  tools: [{
    type: "function",
    name: "shell",
    description: "Run a shell command",
    parameters: { type: "object", properties: { command: { type: "string" } }, required: ["command"] }
  }]
});

describe("stripContinuityFields (outbound boundary)", () => {
  it("removes continuity blobs from assistant messages", () => {
    const body = {
      messages: [
        { role: "user", content: "hi" },
        { role: "assistant", content: null, reasoning_content: "thinking",
          encrypted_content: "B".repeat(500), reasoning_encrypted_content: "alias",
          tool_calls: [{ id: "call_1", type: "function", function: { name: "shell", arguments: "{}" } }] }
      ]
    };
    stripContinuityFields(body);
    const assistant = body.messages[1];
    expect(assistant).not.toHaveProperty("encrypted_content");
    expect(assistant).not.toHaveProperty("reasoning_encrypted_content");
    // legitimate fields survive
    expect(assistant.reasoning_content).toBe("thinking");
    expect(assistant.tool_calls[0].function.name).toBe("shell");
  });

  it("is a no-op for bodies without a messages array", () => {
    const body = { input: [], instructions: "x" };
    expect(stripContinuityFields(body)).toBe(body);
    expect(stripContinuityFields(null)).toBe(null);
  });

  it("end-to-end: Responses multi-turn translation stripped before dispatch", () => {
    const translated = openaiResponsesToOpenAIRequest("x", makeResponsesBody(), false, {});
    // The translator stashes the blob for internal round-trip symmetry...
    const assistantBefore = translated.messages.find((m) => m.role === "assistant");
    expect(assistantBefore.encrypted_content).toBe("B".repeat(5000));
    // ...and the outbound boundary removes it before it reaches any upstream.
    stripContinuityFields(translated);
    expect(JSON.stringify(translated)).not.toContain("encrypted_content");
    expect(JSON.stringify(translated)).not.toContain("B".repeat(100));
    const assistant = translated.messages.find((m) => m.role === "assistant");
    expect(assistant.reasoning_content).toContain("thinking");
    expect(assistant.tool_calls[0].function.name).toBe("shell");
    const roles = translated.messages.map((m) => m.role);
    expect(roles).toEqual(["system", "user", "assistant", "tool", "user"]);
  });
});
