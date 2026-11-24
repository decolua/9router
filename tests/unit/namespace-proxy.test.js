import { describe, expect, it } from "vitest";
import { createNamespaceSSETransform, prepareRequest } from "../../../outputs/9router-namespace-proxy.mjs";

const namespace = {
  type: "namespace", name: "multi_agent_v1",
  tools: [{ type: "function", name: "spawn_agent", parameters: { type: "object", properties: {} } }],
};

async function transformChunks(chunks) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  const map = new Map([["alias", { namespace: "multi_agent_v1", name: "spawn_agent" }]]);
  return new Response(stream.pipeThrough(createNamespaceSSETransform(map))).text();
}

describe("local namespace proxy", () => {
  it("routes the accepted child ID to smart-fast and rejects codex", () => {
    const prepared = prepareRequest({ model: "gpt-5.5", input: [], tools: [namespace] });
    expect(prepared.request.model).toBe("smart-fast");
    expect(prepared.namespaceToolMap.size).toBe(1);
    for (const model of ["codex", "codex/gpt-5.5", "cx/gpt-5.5"]) {
      expect(() => prepareRequest({ model })).toThrow("disabled");
    }
  });

  it("flattens replayed calls and promotes additional_tools", () => {
    const prepared = prepareRequest({ model: "work", input: [
      { type: "function_call", namespace: "multi_agent_v1", name: "spawn_agent", call_id: "call_1", arguments: "{}" },
      { type: "additional_tools", tools: [namespace] },
    ] });
    expect(prepared.request.input).toHaveLength(1);
    expect(prepared.request.input[0]).not.toHaveProperty("namespace");
    expect(prepared.request.input[0].name).toBe(prepared.request.tools[0].name);
  });

  it("normalizes a nested tool_choice without sending contradictory names", () => {
    const out = prepareRequest({ model: "work", input: [], tools: [namespace],
      tool_choice: { type: "function", namespace: namespace.name, function: { name: "spawn_agent" } },
    });
    expect(out.request.tool_choice).toEqual({ type: "function", name: out.request.tools[0].name });
  });

  it("handles lone CR event separators", async () => {
    const raw = 'event: response.output_item.done\rdata: {"type":"response.output_item.done","item":{"type":"function_call","name":"alias"}}\r\r';
    const result = await transformChunks([raw]);
    expect(result).toContain('"namespace":"multi_agent_v1"');
    expect(result).not.toContain("\r");
  });

  it("restores names when CRLF boundaries split across transport chunks", async () => {
    const event = { type: "response.output_item.done", item: { type: "function_call", name: "alias", arguments: "{}" } };
    const result = await transformChunks([
      "event: response.output_item.done\r",
      `\ndata: ${JSON.stringify(event)}\r`, "\n\r", "\n",
      "data: [DONE]\r", "\n\r", "\n",
    ]);
    const restored = JSON.parse(result.split("\n").find(line => line.startsWith("data: {")).slice(6));
    expect(restored.item).toMatchObject({ namespace: "multi_agent_v1", name: "spawn_agent" });
    expect(result).toContain("data: [DONE]\n\n");
    expect(result).not.toContain("\r");
  });

  it("handles multiline data without changing arguments or comments", async () => {
    const result = await transformChunks([
      ': heartbeat\nevent: response.output_item.done\ndata: {"type":"response.output_item.done",\n',
      'data: "item":{"type":"function_call","name":"alias","arguments":"unicode: 漢字"}}\n\n',
    ]);
    expect(result).toContain(": heartbeat\n");
    const restored = JSON.parse(result.split("\n").find(line => line.startsWith("data:")).slice(6));
    expect(restored.item).toMatchObject({ namespace: "multi_agent_v1", name: "spawn_agent", arguments: "unicode: 漢字" });
  });

  it("passes malformed data and unregistered tools through unchanged", async () => {
    const raw = 'data: not-json\n\ndata: {"type":"function_call","name":"exec_command"}\n\n';
    expect(await transformChunks([raw])).toBe(raw);
  });
});
