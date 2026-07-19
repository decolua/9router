import { describe, expect, it } from "vitest";

import {
  createResponsesAccumulator,
  finalizeResponsesAccumulator,
  reduceResponsesEvent
} from "../../open-sse/translator/concerns/responsesAccumulator.js";
import { convertResponsesStreamToJson } from "../../open-sse/transformer/streamToJsonConverter.js";
import { openaiResponsesToOpenAIResponse } from "../../open-sse/translator/response/openai-responses.js";

function event(type, data = {}) {
  return { type, ...data };
}

function streamFromEvents(events, includeDone = true) {
  const encoder = new TextEncoder();
  const payload = events.map(data => [
    `event: ${data.type}`,
    `data: ${JSON.stringify(data)}`,
    ""
  ].join("\n")).join("\n") + (includeDone ? "data: [DONE]\n\n" : "");
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(payload));
      controller.close();
    }
  });
}

function p0Events(terminalType = "response.completed") {
  return [
    event("response.created", {
      response: { id: "resp_p0", object: "response", created_at: 123, model: "gpt-p0", status: "in_progress", output: [] }
    }),
    event("response.output_item.added", {
      output_index: 0,
      item: { id: "rs_1", type: "reasoning", encrypted_content: "ENC_KEEP_ME", summary: [] }
    }),
    event("response.reasoning_summary_text.delta", {
      output_index: 0, item_id: "rs_1", summary_index: 0, delta: "think"
    }),
    event("response.output_text.delta", {
      output_index: 1, item_id: "msg_1", content_index: 0, delta: "Hello "
    }),
    event("response.function_call_arguments.delta", {
      output_index: 3, item_id: "fc_b", delta: "{\"b\":"
    }),
    event("response.function_call_arguments.delta", {
      output_index: 2, item_id: "fc_a", delta: "{\"a\":"
    }),
    event("response.output_item.added", {
      output_index: 3,
      item: { id: "fc_b", type: "function_call", call_id: "call_b", name: "tool_b", arguments: "" }
    }),
    event("response.output_item.added", {
      output_index: 2,
      item: { id: "fc_a", type: "function_call", call_id: "call_a", name: "tool_a", arguments: "" }
    }),
    event("response.function_call_arguments.delta", {
      output_index: 2, call_id: "call_a", delta: "1}"
    }),
    event("response.output_text.delta", {
      output_index: 1, item_id: "msg_1", content_index: 0, delta: "world"
    }),
    event("response.function_call_arguments.delta", {
      output_index: 3, call_id: "call_b", delta: "2}"
    }),
    event(terminalType, {
      response: {
        id: "resp_p0",
        object: "response",
        created_at: 123,
        model: "gpt-p0",
        status: terminalType === "response.incomplete" ? "incomplete" : terminalType === "response.failed" ? "failed" : "completed",
        output: [],
        usage: { input_tokens: 7, output_tokens: 5, total_tokens: 12 }
      }
    })
  ];
}

function reduceAll(events) {
  const accumulator = createResponsesAccumulator();
  const results = events.map(item => reduceResponsesEvent(accumulator, item));
  return { accumulator, results };
}

function collectChat(events) {
  const state = { model: "gpt-p0", created: 123 };
  const chunks = [];
  for (const item of events) {
    const converted = openaiResponsesToOpenAIResponse(item, state);
    if (Array.isArray(converted)) chunks.push(...converted);
    else if (converted) chunks.push(converted);
  }
  const text = chunks.map(chunk => chunk.choices?.[0]?.delta?.content || "").join("");
  const reasoning = chunks.map(chunk => chunk.choices?.[0]?.delta?.reasoning_content || "").join("");
  const tools = new Map();
  for (const chunk of chunks) {
    for (const tool of chunk.choices?.[0]?.delta?.tool_calls || []) {
      const stored = tools.get(tool.index) || { id: "", name: "", arguments: "" };
      if (tool.id) stored.id = tool.id;
      if (tool.function?.name) stored.name += tool.function.name;
      if (tool.function?.arguments) stored.arguments += tool.function.arguments;
      tools.set(tool.index, stored);
    }
  }
  return { chunks, text, reasoning, tools: [...tools.values()], state };
}

describe("Responses accumulator P0 reconstruction", () => {
  it("correlates interleaved tools and arguments that arrive before metadata", () => {
    const { accumulator } = reduceAll(p0Events());

    expect(accumulator.terminalResponse.output).toEqual([
      {
        id: "rs_1",
        type: "reasoning",
        encrypted_content: "ENC_KEEP_ME",
        status: "completed",
        summary: [{ type: "summary_text", text: "think" }]
      },
      {
        type: "message",
        id: "msg_1",
        role: "assistant",
        status: "completed",
        content: [{ type: "output_text", text: "Hello world" }]
      },
      {
        id: "fc_a",
        type: "function_call",
        call_id: "call_a",
        name: "tool_a",
        arguments: "{\"a\":1}",
        status: "completed"
      },
      {
        id: "fc_b",
        type: "function_call",
        call_id: "call_b",
        name: "tool_b",
        arguments: "{\"b\":2}",
        status: "completed"
      }
    ]);
    expect(accumulator.terminalResponse.usage).toEqual({ input_tokens: 7, output_tokens: 5, total_tokens: 12 });
  });

  it("merges pre-metadata fragments discovered through separate aliases in arrival order", () => {
    const accumulator = createResponsesAccumulator();
    reduceResponsesEvent(accumulator, event("response.function_call_arguments.delta", {
      output_index: 4, delta: "{\"x\":"
    }));
    reduceResponsesEvent(accumulator, event("response.function_call_arguments.delta", {
      item_id: "fc_bridge", delta: "true}"
    }));
    reduceResponsesEvent(accumulator, event("response.output_item.added", {
      output_index: 4,
      item_id: "fc_bridge",
      item: { id: "fc_bridge", type: "function_call", call_id: "call_bridge", name: "bridge" }
    }));
    reduceResponsesEvent(accumulator, event("response.completed", {
      response: { status: "completed", output: [] }
    }));

    expect(accumulator.terminalResponse.output[0].arguments).toBe("{\"x\":true}");
  });

  it("merges text and reasoning fragments discovered through separate aliases", () => {
    const events = [
      event("response.output_text.delta", { output_index: 0, delta: "Hello " }),
      event("response.output_text.delta", { item_id: "msg_bridge", delta: "world" }),
      event("response.output_item.added", {
        output_index: 0,
        item_id: "msg_bridge",
        item: { id: "msg_bridge", type: "message", role: "assistant", content: [] }
      }),
      event("response.reasoning_summary_text.delta", { output_index: 1, delta: "first " }),
      event("response.reasoning_summary_text.delta", { item_id: "rs_bridge", delta: "second" }),
      event("response.output_item.added", {
        output_index: 1,
        item_id: "rs_bridge",
        item: { id: "rs_bridge", type: "reasoning", summary: [] }
      }),
      event("response.completed", { response: { status: "completed", output: [] } })
    ];
    const accumulator = createResponsesAccumulator();
    for (const item of events) reduceResponsesEvent(accumulator, item);

    expect(accumulator.terminalResponse.output[0].content[0].text).toBe("Hello world");
    expect(accumulator.terminalResponse.output[1].summary[0].text).toBe("first second");
    expect(collectChat(events)).toMatchObject({ text: "Hello world", reasoning: "first second" });
  });

  it("preserves diagnostics from top-level error events", () => {
    const accumulator = createResponsesAccumulator();
    reduceResponsesEvent(accumulator, event("error", {
      code: "model_not_found", message: "missing model", param: "model"
    }));

    expect(accumulator.terminalResponse.error).toEqual({
      type: "server_error", code: "model_not_found", message: "missing model", param: "model"
    });
  });

  it("accepts wrapped events whose type is outside data", () => {
    const accumulator = createResponsesAccumulator();
    reduceResponsesEvent(accumulator, {
      type: "response.output_text.delta",
      data: { output_index: 0, item_id: "msg_wrapped", delta: "wrapped" }
    });
    reduceResponsesEvent(accumulator, {
      type: "response.completed",
      data: { response: { status: "completed", output: [] } }
    });

    expect(accumulator.terminalResponse.output[0].content[0].text).toBe("wrapped");
  });

  it("uses output-item envelope aliases when nested metadata omits them", () => {
    const accumulator = createResponsesAccumulator();
    reduceResponsesEvent(accumulator, event("response.function_call_arguments.delta", {
      item_id: "fc_envelope", delta: "{\"ok\":true}"
    }));
    reduceResponsesEvent(accumulator, event("response.output_item.added", {
      output_index: 0,
      item_id: "fc_envelope",
      call_id: "call_envelope",
      item: { type: "function_call", name: "envelope" }
    }));
    reduceResponsesEvent(accumulator, event("response.completed", {
      response: { status: "completed", output: [] }
    }));

    expect(accumulator.terminalResponse.output).toHaveLength(1);
    expect(accumulator.terminalResponse.output[0]).toMatchObject({
      call_id: "call_envelope", name: "envelope", arguments: "{\"ok\":true}"
    });
  });

  it("does not merge unrelated items when terminal output is partial", () => {
    const accumulator = createResponsesAccumulator();
    reduceResponsesEvent(accumulator, event("response.output_text.delta", {
      output_index: 0, item_id: "msg_partial", delta: "answer"
    }));
    reduceResponsesEvent(accumulator, event("response.output_item.added", {
      output_index: 2,
      item: { id: "fc_partial", type: "function_call", call_id: "call_partial", name: "tool" }
    }));
    reduceResponsesEvent(accumulator, event("response.function_call_arguments.delta", {
      output_index: 2, item_id: "fc_partial", delta: "{}"
    }));
    reduceResponsesEvent(accumulator, event("response.completed", {
      response: {
        status: "completed",
        output: [{ id: "fc_partial", type: "function_call", call_id: "call_partial", name: "tool", arguments: "{}" }]
      }
    }));

    expect(accumulator.terminalResponse.output.map(item => item.type)).toEqual(["message", "function_call"]);
    expect(accumulator.terminalResponse.output[0].content[0].text).toBe("answer");
  });

  it("cross-resolves equivalent item_id and fallback call_id aliases", () => {
    const accumulator = createResponsesAccumulator();
    reduceResponsesEvent(accumulator, event("response.output_item.added", {
      output_index: 0,
      item: { id: "fc_equivalent", type: "function_call", name: "equivalent" }
    }));
    reduceResponsesEvent(accumulator, event("response.function_call_arguments.delta", {
      call_id: "fc_equivalent", delta: "{\"ok\":true}"
    }));
    reduceResponsesEvent(accumulator, event("response.completed", {
      response: { status: "completed", output: [] }
    }));

    expect(accumulator.terminalResponse.output).toHaveLength(1);
    expect(accumulator.terminalResponse.output[0].arguments).toBe("{\"ok\":true}");
  });

  it("retains usage when a terminal snapshot is empty", () => {
    const accumulator = createResponsesAccumulator();
    reduceResponsesEvent(accumulator, event("response.in_progress", {
      response: { usage: { input_tokens: 3, output_tokens: 2, total_tokens: 5 } }
    }));
    reduceResponsesEvent(accumulator, event("response.completed", {
      response: { status: "completed", output: [], usage: {} }
    }));

    expect(accumulator.terminalResponse.usage).toEqual({ input_tokens: 3, output_tokens: 2, total_tokens: 5 });
  });

  it.each([
    ["response.completed", "completed"],
    ["response.done", "completed"],
    ["response.incomplete", "incomplete"],
    ["response.failed", "failed"]
  ])("finalizes %s exactly once with status %s", (terminalType, status) => {
    const { accumulator, results } = reduceAll(p0Events(terminalType));
    const duplicate = reduceResponsesEvent(accumulator, event("response.failed", { response: { status: "failed" } }));

    expect(accumulator.terminalResponse.status).toBe(status);
    expect(results.at(-1).accepted).toBe(true);
    expect(duplicate.accepted).toBe(false);
    expect(accumulator.terminalType).toBe(terminalType);
  });

  it("preserves a failed status carried by response.done", () => {
    const accumulator = createResponsesAccumulator();
    reduceResponsesEvent(accumulator, event("response.done", {
      response: { id: "resp_done_failed", status: "failed", output: [] }
    }));

    expect(accumulator.terminalResponse).toMatchObject({
      id: "resp_done_failed",
      status: "failed",
      error: { code: "response_failed" }
    });
  });

  it("repairs a metadata-light arguments.done tool with stream/non-stream ID parity", () => {
    const events = [
      event("response.function_call_arguments.done", {
        output_index: 0,
        item_id: "fc_done_only",
        name: "done_only",
        arguments: "{\"ok\":true}"
      }),
      event("response.completed", { response: { status: "completed", output: [] } })
    ];
    const { accumulator } = reduceAll(events);
    const chat = collectChat(events);
    const tool = accumulator.terminalResponse.output[0];

    expect(tool).toMatchObject({
      type: "function_call",
      id: "fc_done_only",
      call_id: "fc_done_only",
      name: "done_only",
      arguments: "{\"ok\":true}"
    });
    expect(chat.tools).toEqual([{
      id: "fc_done_only",
      name: "done_only",
      arguments: "{\"ok\":true}"
    }]);
  });

  it("persists one fallback call ID for custom-tool stream/non-stream parity", () => {
    const events = [
      event("response.output_item.added", {
        output_index: 0,
        item: { id: "ct_1", type: "custom_tool_call", name: "custom", input: "payload" }
      }),
      event("response.completed", { response: { status: "completed", output: [] } })
    ];
    const { accumulator } = reduceAll(events);
    const chat = collectChat(events);

    expect(accumulator.terminalResponse.output[0].call_id).toBe("ct_1");
    expect(chat.tools[0].id).toBe("ct_1");
  });

  it("reuses a generated metadata-light tool ID in the streaming terminal", () => {
    const chat = collectChat([
      event("response.output_item.added", {
        output_index: 0,
        item: { type: "function_call", name: "fallback", arguments: "{}" }
      }),
      event("response.completed", { response: { status: "completed", output: [] } })
    ]);

    const terminalTool = chat.state.responsesAccumulator.terminalResponse.output[0];
    expect(chat.tools[0].id).toBe(terminalTool.call_id);
  });

  it("synthesizes a failed terminal with partial output on EOF", () => {
    const accumulator = createResponsesAccumulator({ id: "resp_eof" });
    reduceResponsesEvent(accumulator, event("response.output_text.delta", { delta: "partial" }));
    const terminal = finalizeResponsesAccumulator(accumulator, {
      error: { type: "stream_error", code: "stream_disconnected", message: "EOF" }
    });

    expect(terminal.response).toMatchObject({
      id: "resp_eof",
      status: "failed",
      error: { code: "stream_disconnected" },
      output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "partial" }] }]
    });
  });
});

describe("Responses stream and forced non-stream parity", () => {
  it("reconstructs the same text, reasoning, tools, status, and usage", async () => {
    const events = p0Events();
    const json = await convertResponsesStreamToJson(streamFromEvents(events));
    const chat = collectChat(events);

    expect(json.status).toBe("completed");
    expect(json.usage).toEqual({ input_tokens: 7, output_tokens: 5, total_tokens: 12 });
    expect(json.output.find(item => item.type === "message")?.content[0].text).toBe(chat.text);
    expect(json.output.find(item => item.type === "reasoning")?.summary[0].text).toBe(chat.reasoning);
    const jsonTools = json.output.filter(item => item.type === "function_call").map(item => ({
      id: item.call_id,
      name: item.name,
      arguments: item.arguments
    }));
    expect(jsonTools).toEqual(chat.tools);
    expect(chat.chunks.filter(chunk => chunk.choices?.[0]?.finish_reason)).toHaveLength(1);
    expect(chat.chunks.at(-1).usage).toEqual({
      prompt_tokens: 7,
      completion_tokens: 5,
      total_tokens: 12
    });
  });

  it("returns a failed Responses object with reconstructed partial output on EOF", async () => {
    const json = await convertResponsesStreamToJson(streamFromEvents([
      event("response.created", { response: { id: "resp_eof", status: "in_progress" } }),
      event("response.output_text.delta", { output_index: 0, item_id: "msg_eof", delta: "partial" })
    ], false));

    expect(json.status).toBe("failed");
    expect(json.error).toMatchObject({ type: "stream_error", code: "stream_disconnected" });
    expect(json.output[0].content[0].text).toBe("partial");
  });

  it("emits a failed terminal chunk for an empty translated stream", () => {
    const chunks = openaiResponsesToOpenAIResponse(null, { model: "gpt-p0", created: 123 });

    expect(chunks).toHaveLength(1);
    expect(chunks[0].choices[0]).toMatchObject({
      delta: { content: expect.stringContaining("stream closed") },
      finish_reason: "stop"
    });
  });

  it("does not advertise a partial failed tool call as executable", () => {
    const chat = collectChat([
      event("response.output_item.added", {
        output_index: 0,
        item: { id: "fc_partial", type: "function_call", call_id: "call_partial", name: "unsafe" }
      }),
      event("response.function_call_arguments.delta", {
        output_index: 0, item_id: "fc_partial", delta: "{\"partial\":"
      }),
      event("response.failed", {
        response: { status: "failed", error: { type: "server_error", message: "upstream failed" } }
      })
    ]);

    expect(chat.chunks.at(-1).choices[0].finish_reason).toBe("stop");
  });

  it("waits for call_id aliases to bridge before emitting arguments", () => {
    const chat = collectChat([
      event("response.function_call_arguments.delta", {
        output_index: 0, delta: "{\"x\":"
      }),
      event("response.function_call_arguments.delta", {
        call_id: "call_bridge", delta: "true}"
      }),
      event("response.output_item.added", {
        output_index: 0,
        call_id: "call_bridge",
        item: { id: "fc_bridge", type: "function_call", call_id: "call_bridge", name: "bridge" }
      }),
      event("response.completed", { response: { status: "completed", output: [] } })
    ]);

    expect(chat.tools).toEqual([{
      id: "call_bridge",
      name: "bridge",
      arguments: "{\"x\":true}"
    }]);
  });

  it("waits for an unindexed tool to receive its final output order", () => {
    const chat = collectChat([
      event("response.output_item.added", {
        item_id: "fc_late",
        item: { id: "fc_late", type: "function_call", call_id: "call_late", name: "late", arguments: "{}" }
      }),
      event("response.output_item.added", {
        output_index: 0,
        item: { id: "fc_first", type: "function_call", call_id: "call_first", name: "first", arguments: "{}" }
      }),
      event("response.output_item.done", {
        output_index: 1,
        item_id: "fc_late",
        item: { id: "fc_late", type: "function_call", call_id: "call_late", name: "late", arguments: "{}" }
      }),
      event("response.completed", { response: { status: "completed", output: [] } })
    ]);

    expect(chat.tools.map(tool => tool.id)).toEqual(["call_first", "call_late"]);
  });

  it("does not advertise a reconstructed nameless tool as executable", () => {
    const chat = collectChat([
      event("response.function_call_arguments.delta", {
        output_index: 0, delta: "{\"unsafe\":true}"
      }),
      event("response.completed", { response: { status: "completed", output: [] } })
    ]);

    expect(chat.tools).toEqual([]);
    expect(chat.chunks.at(-1).choices[0].finish_reason).toBe("stop");
  });

  it("does not force-emit tools with mixed unresolved output order", () => {
    const chat = collectChat([
      event("response.output_item.added", {
        output_index: 2,
        item: { id: "fc_indexed", type: "function_call", call_id: "call_indexed", name: "indexed", arguments: "{}" }
      }),
      event("response.output_item.added", {
        item_id: "fc_unknown",
        item: { id: "fc_unknown", type: "function_call", call_id: "call_unknown", name: "unknown", arguments: "{}" }
      }),
      event("response.completed", { response: { status: "completed", output: [] } })
    ]);

    expect(chat.tools).toEqual([]);
    expect(chat.chunks.at(-1).choices[0].finish_reason).toBe("stop");
  });

  it("does not emit a contiguous tool prefix before a later gap appears", () => {
    const chat = collectChat([
      event("response.output_item.added", {
        output_index: 0,
        item: { id: "fc_zero", type: "function_call", call_id: "call_zero", name: "zero", arguments: "{}" }
      }),
      event("response.output_item.added", {
        output_index: 2,
        item: { id: "fc_two", type: "function_call", call_id: "call_two", name: "two", arguments: "{}" }
      }),
      event("response.completed", { response: { status: "completed", output: [] } })
    ]);

    expect(chat.tools).toEqual([]);
    expect(chat.chunks.at(-1).choices[0].finish_reason).toBe("stop");
  });

  it("keeps conflicting duplicate output indexes detectable", () => {
    const chat = collectChat([
      event("response.output_item.added", {
        output_index: 0,
        item: { id: "fc_a", type: "function_call", call_id: "call_a", name: "a", arguments: "{}" }
      }),
      event("response.output_item.added", {
        output_index: 0,
        item: { id: "fc_b", type: "function_call", call_id: "call_b", name: "b", arguments: "{}" }
      }),
      event("response.completed", { response: { status: "completed", output: [] } })
    ]);

    expect(chat.state.responsesAccumulator.terminalResponse.output).toHaveLength(2);
    expect(chat.tools).toEqual([]);
    expect(chat.chunks.at(-1).choices[0].finish_reason).toBe("stop");
  });

  it("rejects a recorded index conflict even when final indexes look contiguous", () => {
    const chat = collectChat([
      event("response.output_item.added", {
        output_index: 0,
        item: { id: "fc_a", type: "function_call", call_id: "call_a", name: "a", arguments: "{}" }
      }),
      event("response.output_item.added", {
        output_index: 1,
        item: { id: "fc_b", type: "function_call", call_id: "call_b", name: "b", arguments: "{}" }
      }),
      event("response.output_item.done", {
        output_index: 0,
        item_id: "fc_b",
        item: { id: "fc_b", type: "function_call", call_id: "call_b", name: "b", arguments: "{}" }
      }),
      event("response.completed", { response: { status: "completed", output: [] } })
    ]);

    expect(chat.state.responsesAccumulator.outputOrderConflict).toBe(true);
    expect(chat.tools).toEqual([]);
    expect(chat.chunks.at(-1).choices[0].finish_reason).toBe("stop");
  });

  it("prefers a later reasoning summary over deferred raw reasoning text", () => {
    const chat = collectChat([
      event("response.reasoning_text.delta", {
        output_index: 0, item_id: "rs_summary", delta: "raw chain"
      }),
      event("response.reasoning_summary_text.delta", {
        output_index: 0, item_id: "rs_summary", delta: "safe summary"
      }),
      event("response.completed", { response: { status: "completed", output: [] } })
    ]);

    expect(chat.reasoning).toBe("safe summary");
  });
});
