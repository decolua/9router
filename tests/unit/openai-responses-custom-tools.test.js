import { describe, expect, it } from "vitest";

import { FORMATS } from "../../open-sse/translator/formats.js";
import { initState } from "../../open-sse/translator/index.js";
import { openaiResponsesToOpenAIRequest } from "../../open-sse/translator/request/openai-responses.js";
import { openaiToOpenAIResponsesResponse } from "../../open-sse/translator/response/openai-responses.js";
import { getResponsesCustomToolNames } from "../../open-sse/translator/helpers/responsesCustomTools.js";
import { createResponsesApiTransformStream } from "../../open-sse/transformer/responsesTransformer.js";

function responsesState(body = {}) {
  return {
    ...initState(FORMATS.OPENAI_RESPONSES),
    customToolNames: getResponsesCustomToolNames(body)
  };
}

async function transformChatSSEToResponses(input, body) {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(input));
      controller.close();
    }
  }).pipeThrough(createResponsesApiTransformStream(null, body));

  const reader = stream.getReader();
  let output = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    output += decoder.decode(value, { stream: true });
  }
  output += decoder.decode();
  return output;
}

describe("OpenAI Responses custom tool translation", () => {
  it("emits Codex apply_patch as custom_tool_call with raw input", () => {
    const patch = "*** Begin Patch\n*** Add File: demo.txt\n+hello\n*** End Patch\n";
    const state = responsesState({
      tools: [{ type: "custom", name: "apply_patch", description: "Apply patch" }]
    });

    const events = [
      ...openaiToOpenAIResponsesResponse({
        id: "chatcmpl_patch",
        choices: [{
          index: 0,
          delta: {
            tool_calls: [{
              index: 0,
              id: "call_patch",
              type: "function",
              function: { name: "apply_patch", arguments: patch }
            }]
          }
        }]
      }, state),
      ...openaiToOpenAIResponsesResponse({
        id: "chatcmpl_patch",
        choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }]
      }, state)
    ];

    expect(events.find((event) => event.event === "response.output_item.added").data.item).toMatchObject({
      type: "custom_tool_call",
      call_id: "call_patch",
      name: "apply_patch",
      input: ""
    });
    expect(events.find((event) => event.event === "response.custom_tool_call_input.delta").data.delta).toBe(patch);
    expect(events.find((event) => event.event === "response.custom_tool_call_input.done").data.input).toBe(patch);
    expect(events.find((event) => event.event === "response.output_item.done").data.item).toMatchObject({
      type: "custom_tool_call",
      call_id: "call_patch",
      name: "apply_patch",
      input: patch
    });
    expect(events.some((event) => event.event === "response.function_call_arguments.delta")).toBe(false);
  });

  it("keeps normal tools as function_call arguments", () => {
    const state = responsesState({
      tools: [{
        type: "function",
        name: "read_file",
        parameters: { type: "object", properties: { path: { type: "string" } } }
      }]
    });

    const events = [
      ...openaiToOpenAIResponsesResponse({
        id: "chatcmpl_fn",
        choices: [{
          index: 0,
          delta: {
            tool_calls: [{
              index: 0,
              id: "call_read",
              type: "function",
              function: { name: "read_file", arguments: "{\"path\":\"demo.txt\"}" }
            }]
          }
        }]
      }, state),
      ...openaiToOpenAIResponsesResponse({
        id: "chatcmpl_fn",
        choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }]
      }, state)
    ];

    expect(events.find((event) => event.event === "response.output_item.added").data.item.type).toBe("function_call");
    expect(events.find((event) => event.event === "response.function_call_arguments.delta").data.delta).toBe("{\"path\":\"demo.txt\"}");
    expect(events.some((event) => event.event === "response.custom_tool_call_input.delta")).toBe(false);
  });

  it("preserves custom_tool_call history and custom outputs in Responses requests", () => {
    const result = openaiResponsesToOpenAIRequest("gpt-5.4", {
      input: [
        {
          type: "custom_tool_call",
          call_id: "call_patch",
          name: "apply_patch",
          input: "*** Begin Patch\n*** End Patch\n"
        },
        {
          type: "custom_tool_call_output",
          call_id: "call_patch",
          output: "Done"
        }
      ]
    }, true);

    expect(result.messages).toEqual([
      {
        role: "assistant",
        content: null,
        tool_calls: [{
          id: "call_patch",
          type: "function",
          function: {
            name: "apply_patch",
            arguments: "*** Begin Patch\n*** End Patch\n"
          }
        }]
      },
      {
        role: "tool",
        tool_call_id: "call_patch",
        content: "Done"
      }
    ]);
  });

  it("keeps the legacy Responses transform wrapper custom-tool aware", async () => {
    const patch = "*** Begin Patch\n*** Add File: demo.txt\n+hello\n*** End Patch\n";
    const body = { tools: [{ type: "custom", name: "apply_patch" }] };
    const input = [
      `data: ${JSON.stringify({
        id: "chatcmpl_patch",
        choices: [{
          index: 0,
          delta: {
            tool_calls: [{
              index: 0,
              id: "call_patch",
              type: "function",
              function: { name: "apply_patch", arguments: patch }
            }]
          }
        }]
      })}`,
      `data: ${JSON.stringify({
        id: "chatcmpl_patch",
        choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }]
      })}`,
      "data: [DONE]"
    ].join("\n\n");

    const output = await transformChatSSEToResponses(input, body);

    expect(output).toContain("response.custom_tool_call_input.delta");
    expect(output).toContain("custom_tool_call");
    expect(output).toContain("*** Begin Patch");
    expect(output).not.toContain("response.function_call_arguments.delta");
  });
});
