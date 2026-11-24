/**
 * Namespace tools (e.g. codex `collaboration`) must expand into individual
 * `{namespace}.{subtool}` functions on the request, and split back into
 * `name` + `namespace` on the response so the client router can route them.
 */
import { describe, expect, it } from "vitest";
import { openaiResponsesToOpenAIRequest } from "../../open-sse/translator/request/openai-responses.js";
import { openaiToOpenAIResponsesResponse } from "../../open-sse/translator/response/openai-responses.js";
import { initState } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const COLLAB_NAMESPACE = {
  type: "namespace",
  name: "collaboration",
  description: "collaboration tools",
  tools: [
    { type: "function", name: "spawn_agent", description: "spawn a subagent", parameters: { type: "object" } },
    { type: "function", name: "wait_agent", description: "wait for subagents", parameters: { type: "object" } },
    { type: "function", name: "list_agents", description: "list subagents", parameters: { type: "object" } },
  ],
};

describe("Responses namespace tools", () => {
  it("expands a namespace tool into individual {ns}.{subtool} functions", () => {
    const out = openaiResponsesToOpenAIRequest("m", {
      input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "spawn a helper" }] }],
      tools: [COLLAB_NAMESPACE],
    }, true, null);

    expect(out.tools).toHaveLength(3);
    expect(out.tools.map((t) => t.function.name)).toEqual([
      "collaboration__spawn_agent",
      "collaboration__wait_agent",
      "collaboration__list_agents",
    ]);
  });

  it("splits a namespaced tool call back into name + namespace on the response", () => {
    const state = initState(FORMATS.OPENAI_RESPONSES);
    const chunks = [
      { id: "cmb-1", choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "collaboration__spawn_agent", arguments: "" } }] }, finish_reason: null }] },
      { id: "cmb-1", choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
    ];
    const events = chunks.flatMap((c) => openaiToOpenAIResponsesResponse(c, state));
    const added = events.find((e) => e.event === "response.output_item.added" && e.data.item?.type === "function_call");

    expect(added.data.item.name).toBe("spawn_agent");
    expect(added.data.item.namespace).toBe("collaboration");
  });

  it("leaves flat tool names unchanged", () => {
    const out = openaiResponsesToOpenAIRequest("m", {
      input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] }],
      tools: [{ type: "function", name: "get_weather", description: "weather", parameters: { type: "object" } }],
    }, true, null);

    expect(out.tools.map((t) => t.function.name)).toEqual(["get_weather"]);
  });
});
