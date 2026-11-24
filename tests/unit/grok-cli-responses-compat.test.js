import { describe, expect, it } from "vitest";
import {
  GrokCliCompatibilityError,
  normalizeGrokCliEffort,
  translateGrokCliResponsesRequest,
} from "../../open-sse/executors/grok-cli-compat.js";

function translate(body, options = {}) {
  return translateGrokCliResponsesRequest(body, {
    model: "grok-4.5",
    supportsReasoningEffort: true,
    ...options,
  });
}

describe("Grok CLI Responses compatibility", () => {
  it("exports a request translator", async () => {
    const compat = await import("../../open-sse/executors/grok-cli-compat.js").catch(() => null);

    expect(compat?.translateGrokCliResponsesRequest).toBeTypeOf("function");
  });

  it("rebuilds top-level wire without mutating client input", () => {
    const input = {
      model: "grok-4.5",
      instructions: "System rules",
      input: [{ type: "message", role: "developer", content: "Developer rules", id: "msg_foreign" }],
      service_tier: "fast",
      prompt_cache_key: "thread-1",
      metadata: { private: true },
      parallel_tool_calls: false,
      temperature: 0.2,
      top_p: 0.8,
      max_output_tokens: 1234,
    };
    const snapshot = structuredClone(input);

    const result = translate(input);

    expect(input).toEqual(snapshot);
    expect(result.body).toEqual({
      model: "grok-4.5",
      input: [
        { type: "message", role: "system", content: "System rules" },
        { type: "message", role: "system", content: "Developer rules" },
      ],
      max_output_tokens: 1234,
      temperature: 0.2,
      top_p: 0.8,
      parallel_tool_calls: false,
      reasoning: { summary: "concise", effort: "high" },
      include: ["reasoning.encrypted_content"],
      stream: true,
      store: false,
    });
    expect(result.diagnostics.droppedTopLevel).toEqual([
      "service_tier",
      "prompt_cache_key",
      "metadata",
    ]);
  });

  it("deduplicates identical leading instructions", () => {
    const { body } = translate({
      instructions: "same",
      input: [
        { type: "message", role: "system", content: "same" },
        { type: "message", role: "user", content: "next" },
      ],
    });

    expect(body.input).toEqual([
      { type: "message", role: "system", content: "same" },
      { type: "message", role: "user", content: "next" },
    ]);
    expect(body.instructions).toBeUndefined();
  });

  it("normalizes typed message content and removes output-only fields", () => {
    const { body } = translate({
      input: [{
        type: "message",
        role: "assistant",
        id: "msg_123",
        status: "completed",
        content: [
          { type: "output_text", text: "answer", annotations: [{ type: "url_citation" }] },
          { type: "input_image", image_url: "data:image/png;base64,AA==", detail: "high" },
        ],
        internal_chat_message_metadata_passthrough: { turn_id: "foreign" },
      }],
    });

    expect(body.input).toEqual([{
      type: "message",
      role: "assistant",
      content: [
        { type: "input_text", text: "answer" },
        { type: "input_image", image_url: "data:image/png;base64,AA==", detail: "high" },
      ],
    }]);
  });

  it("normalizes string input and injects placeholder for empty input", () => {
    expect(translate({ input: "hello" }).body.input).toEqual([
      { type: "message", role: "user", content: "hello" },
    ]);
    expect(translate({ input: [] }).body.input).toEqual([
      { type: "message", role: "user", content: "..." },
    ]);
  });

  it("drops empty message blocks without changing instruction bytes", () => {
    const { body } = translate({
      instructions: "  exact system bytes\n",
      input: [
        { type: "message", role: "user", content: "" },
        { type: "message", role: "assistant", content: [{ type: "output_text", text: "" }] },
        { type: "message", role: "user", content: "next" },
      ],
    });

    expect(body.input).toEqual([
      { type: "message", role: "system", content: "  exact system bytes\n" },
      { type: "message", role: "user", content: "next" },
    ]);
    expect(translate({ input: [{ role: "user", content: "" }] }).body.input).toEqual([
      { type: "message", role: "user", content: "..." },
    ]);
  });

  it("rejects unknown semantic input with an exact path", () => {
    expect(() => translate({
      input: [{ type: "future_semantic_item", payload: { encrypted: true } }],
    })).toThrowError(GrokCliCompatibilityError);

    try {
      translate({ input: [{ type: "future_semantic_item", payload: true }] });
    } catch (error) {
      expect(error.status).toBe(400);
      expect(error.path).toBe("input[0]");
      expect(error.message).toContain("future_semantic_item");
    }
  });

  it("rejects unknown message roles and nested semantic content", () => {
    expect(() => translate({
      input: [{ type: "message", role: "future_role", content: "secret" }],
    })).toThrowError(expect.objectContaining({ path: "input[0].role" }));

    expect(() => translate({
      input: [{
        type: "message",
        role: "user",
        content: [
          { type: "input_text", text: "keep" },
          { type: "input_file", file_id: "file_private" },
        ],
      }],
    })).toThrowError(expect.objectContaining({ path: "input[0].content[1]" }));
  });

  it("rejects malformed input containers and array entries", () => {
    expect(() => translate({
      input: { role: "user", content: "lost" },
    })).toThrowError(expect.objectContaining({ path: "input" }));

    expect(() => translate({ input: ["lost"] }))
      .toThrowError(expect.objectContaining({ path: "input[0]" }));
  });

  it("preserves native reasoning and x-search history while dropping foreign ciphertext", () => {
    const responseId = "144f7ee6-7881-9c5b-8bc5-ce10354424af";
    const reasoningId = `rs_${responseId}`;
    const tcoId = `tco_${responseId}_call-1`;
    const { body, diagnostics } = translate({
      input: [
        { type: "message", role: "user", content: "search" },
        {
          type: "reasoning",
          id: "rs_07fe505b3114f180016a5698411c448191bdcdcba678464461",
          encrypted_content: "openai-ciphertext",
          summary: [],
        },
        {
          type: "reasoning",
          id: "tco_foreign_call-1",
          encrypted_content: "different-id_ciphertext",
          summary: [],
        },
        {
          type: "reasoning",
          id: reasoningId,
          status: "completed",
          encrypted_content: "grok-ciphertext",
          summary: [{ type: "summary_text", text: "before search" }],
          content: [{ text: "private reasoning" }],
        },
        {
          type: "custom_tool_call",
          id: `ctc_${responseId}_call-1`,
          call_id: "xs_call-1",
          name: "x_user_search",
          input: "{\"query\":\"OpenAI\"}",
          status: "completed",
          internal_chat_message_metadata_passthrough: { turn_id: "drop" },
        },
        {
          type: "reasoning",
          id: tcoId,
          status: "completed",
          encrypted_content: `${tcoId}_ciphertext`,
          summary: [],
        },
        { type: "message", role: "assistant", content: "done" },
      ],
    });

    expect(body.input).toEqual([
      { type: "message", role: "user", content: "search" },
      {
        type: "reasoning",
        id: reasoningId,
        encrypted_content: "grok-ciphertext",
        summary: [{ type: "summary_text", text: "before search" }],
        content: [{ type: "reasoning_text", text: "private reasoning" }],
      },
      {
        type: "custom_tool_call",
        id: `ctc_${responseId}_call-1`,
        call_id: "xs_call-1",
        name: "x_user_search",
        input: "{\"query\":\"OpenAI\"}",
        status: "completed",
      },
      {
        type: "reasoning",
        id: tcoId,
        encrypted_content: `${tcoId}_ciphertext`,
        summary: [],
      },
      { type: "message", role: "assistant", content: "done" },
    ]);
    expect(diagnostics.droppedInputTypes).toEqual(["reasoning", "reasoning"]);
  });

  it("normalizes function and Codex custom history without losing typed output", () => {
    const { body } = translate({
      input: [
        {
          type: "function_call",
          id: "fc_native-output-id",
          call_id: "call-function",
          name: "read_image",
          arguments: "{broken",
          status: "completed",
        },
        {
          type: "function_call_output",
          id: "fco_output-id",
          call_id: "call-function",
          status: "completed",
          output: [
            { type: "input_text", text: "image result" },
            { type: "input_image", image_url: "data:image/png;base64,AA==", detail: "auto" },
          ],
        },
        {
          type: "custom_tool_call",
          id: "ctc_openai",
          call_id: "call-custom",
          name: "exec",
          input: "pwd",
          status: "completed",
        },
        {
          type: "custom_tool_call_output",
          call_id: "call-custom",
          output: null,
        },
        {
          type: "function_call",
          call_id: "call-structured",
          name: "structured",
          arguments: { z: 1 },
        },
        {
          type: "function_call_output",
          call_id: "call-structured",
          output: { ok: true, count: 2 },
        },
        { type: "function_call_output", call_id: "call-orphan", output: "orphan" },
      ],
    });

    expect(body.input).toEqual([
      { type: "function_call", call_id: "call-function", name: "read_image", arguments: "{}" },
      {
        type: "function_call_output",
        call_id: "call-function",
        output: [
          { type: "input_text", text: "image result" },
          { type: "input_image", image_url: "data:image/png;base64,AA==", detail: "auto" },
        ],
      },
      {
        type: "function_call",
        call_id: "call-custom",
        name: "exec",
        arguments: "{\"input\":\"pwd\"}",
      },
      { type: "function_call_output", call_id: "call-custom", output: "null" },
      {
        type: "function_call",
        call_id: "call-structured",
        name: "structured",
        arguments: "{\"z\":1}",
      },
      {
        type: "function_call_output",
        call_id: "call-structured",
        output: "{\"ok\":true,\"count\":2}",
      },
    ]);
  });

  it("rejects malformed function calls before provider transport", () => {
    expect(() => translate({
      input: [{ type: "function_call", call_id: "call-1", arguments: "{}" }],
    })).toThrowError(GrokCliCompatibilityError);

    try {
      translate({ input: [{ type: "function_call", call_id: "call-1", arguments: "{}" }] });
    } catch (error) {
      expect(error.path).toBe("input[0]");
      expect(error.message).toContain("name");
    }
  });

  it("keeps last duplicate result and repairs dangling historical calls", () => {
    const { body, diagnostics } = translate({
      input: [
        { type: "function_call", call_id: "call-dup", name: "dup", arguments: "{}" },
        { type: "function_call_output", call_id: "call-dup", output: "old" },
        { type: "function_call_output", call_id: "call-dup", output: "new" },
        { type: "function_call", call_id: "call-missing", name: "missing", arguments: "{}" },
        { type: "message", role: "user", content: "continue" },
      ],
    });

    expect(body.input).toEqual([
      { type: "function_call", call_id: "call-dup", name: "dup", arguments: "{}" },
      { type: "function_call_output", call_id: "call-dup", output: "new" },
      { type: "function_call", call_id: "call-missing", name: "missing", arguments: "{}" },
      {
        type: "function_call_output",
        call_id: "call-missing",
        output: "Tool execution was cancelled by the user (tool `missing` was not executed).",
      },
      { type: "message", role: "user", content: "continue" },
    ]);
    expect(diagnostics.repairedHistory).toBe(2);
  });

  it("keeps one call for duplicate call ids", () => {
    const { body, diagnostics } = translate({
      input: [
        { type: "function_call", call_id: "call-dup", name: "first", arguments: "{}" },
        { type: "function_call", call_id: "call-dup", name: "second", arguments: "{}" },
        { type: "function_call_output", call_id: "call-dup", output: "result" },
      ],
    });

    expect(body.input).toEqual([
      { type: "function_call", call_id: "call-dup", name: "first", arguments: "{}" },
      { type: "function_call_output", call_id: "call-dup", output: "result" },
    ]);
    expect(diagnostics.repairedHistory).toBe(1);
  });

  it("preserves source-backed backend tool history", () => {
    const { body } = translate({
      input: [
        {
          type: "web_search_call",
          id: "ws_1",
          status: "completed",
          action: { type: "search", query: "q", sources: [] },
          internal_chat_message_metadata_passthrough: { drop: true },
        },
        {
          type: "code_interpreter_call",
          id: "ci_1",
          status: "completed",
          code: "print(1)",
          outputs: [],
        },
      ],
    });

    expect(body.input).toEqual([
      {
        type: "web_search_call",
        id: "ws_1",
        status: "completed",
        action: { type: "search", query: "q", sources: [] },
      },
      {
        type: "code_interpreter_call",
        id: "ci_1",
        status: "completed",
        code: "print(1)",
        outputs: [],
      },
    ]);
  });

  it("rebuilds source-backed tools and resolves hosted collisions", () => {
    const { body, diagnostics } = translate({
      input: "search",
      tools: [
        {
          type: "web_search",
          filters: { allowed_domains: [" x.com ", "", 7, "x.com"] },
          external_web_access: true,
          search_context_size: "high",
        },
        { type: "web_search", filters: { allowed_domains: ["ignored.example"] } },
        { type: "x_search", unsupported: true },
        { type: "x_search" },
        {
          type: "function",
          name: "web_search",
          description: "collision",
          parameters: { type: "object" },
        },
        {
          type: "function",
          function: {
            name: "read_file",
            description: "Read file",
            parameters: { type: "object", properties: { path: { type: "string" } } },
            strict: true,
          },
          unsupported: "drop",
        },
        { type: "custom", name: "exec", description: "Run command", format: { type: "text" } },
      ],
    });

    expect(body.tools).toEqual([
      {
        type: "function",
        name: "read_file",
        description: "Read file",
        parameters: { type: "object", properties: { path: { type: "string" } } },
        strict: true,
      },
      {
        type: "function",
        name: "exec",
        description: "Run command",
        parameters: {
          type: "object",
          properties: { input: { type: "string" } },
          required: ["input"],
        },
      },
      { type: "web_search", filters: { allowed_domains: ["x.com"] } },
      { type: "x_search" },
    ]);
    expect(diagnostics.convertedCustomTools).toBe(1);
    expect(diagnostics.droppedToolTypes).toEqual(expect.arrayContaining([
      "web_search",
      "x_search",
      "function:web_search",
    ]));
  });

  it("caps provider tools while preserving hosted and explicitly selected tools", () => {
    const tools = Array.from({ length: 202 }, (_, index) => ({
      type: "function",
      name: `tool_${index}`,
      parameters: { type: "object" },
    }));
    tools.push({ type: "web_search" }, { type: "x_search" });

    const { body, diagnostics } = translate({
      input: "x",
      tools,
      tool_choice: { type: "function", name: "tool_201" },
    });

    expect(body.tools).toHaveLength(200);
    expect(body.tools).toContainEqual(expect.objectContaining({ name: "tool_201" }));
    expect(body.tools).toContainEqual({ type: "web_search" });
    expect(body.tools).toContainEqual({ type: "x_search" });
    expect(body.tool_choice).toEqual({ type: "function", name: "tool_201" });
    expect(diagnostics.droppedToolTypes).toContain("limit:function:tool_197");
  });

  it("rejects unsupported typed hosted tools with an exact path", () => {
    const run = () => translate({
      input: "search",
      tools: [
        { type: "function", name: "read_file", parameters: { type: "object" } },
        { type: "file_search", vector_store_ids: ["vs_1"] },
      ],
    });

    expect(run).toThrowError(GrokCliCompatibilityError);
    expect(run).toThrowError(expect.objectContaining({
      status: 400,
      path: "tools[1].type",
    }));
  });

  it("normalizes tool choice against final tools", () => {
    const tools = [
      { type: "function", name: "read_file", parameters: { type: "object" } },
      { type: "custom", name: "exec" },
      { type: "web_search" },
    ];

    expect(translate({ input: "x", tools, tool_choice: "required" }).body.tool_choice)
      .toBe("required");
    expect(translate({
      input: "x",
      tools,
      tool_choice: { type: "custom", name: "exec" },
    }).body.tool_choice).toEqual({ type: "function", name: "exec" });
    expect(translate({
      input: "x",
      tools,
      tool_choice: { type: "function", function: { name: "read_file" } },
    }).body.tool_choice).toEqual({ type: "function", name: "read_file" });
    expect(translate({
      input: "x",
      tools,
      tool_choice: { type: "web_search" },
    }).body.tool_choice).toBeUndefined();
    expect(translate({ input: "x", tools, tool_choice: { type: "function", name: "stale" } })
      .body.tool_choice).toBeUndefined();
    expect(translate({ input: "x", tool_choice: "auto" }).body.tool_choice).toBeUndefined();
  });

  it("normalizes reasoning effort only for proven models", () => {
    expect(normalizeGrokCliEffort("low")).toBe("low");
    expect(normalizeGrokCliEffort("MAX")).toBe("xhigh");
    expect(normalizeGrokCliEffort("ultra")).toBe("high");

    const supported = translate({
      input: "x",
      reasoning: { effort: "max", summary: "detailed", generate_summary: true },
      include: ["file_search_call.results", "reasoning.encrypted_content"],
    }).body;
    expect(supported.reasoning).toEqual({ effort: "xhigh", summary: "concise" });
    expect(supported.include).toEqual(["reasoning.encrypted_content"]);

    const unsupported = translate({
      input: "x",
      reasoning_effort: "max",
    }, { model: "grok-build", supportsReasoningEffort: false }).body;
    expect(unsupported.reasoning).toEqual({ summary: "concise" });
    expect(unsupported.include).toEqual(["reasoning.encrypted_content"]);
  });

  it("rebuilds plain text and JSON schema output configuration", () => {
    expect(translate({
      input: "x",
      text: { format: { type: "text" }, verbosity: "high" },
    }).body.text).toEqual({ format: { type: "text" } });

    expect(translate({
      input: "x",
      text: {
        verbosity: "low",
        format: {
          type: "json_schema",
          name: " result ",
          description: "Result object",
          schema: { type: "object", properties: { ok: { type: "boolean" } } },
          strict: false,
          extra: "drop",
        },
      },
    }).body.text).toEqual({
      format: {
        type: "json_schema",
        name: "result",
        description: "Result object",
        schema: { type: "object", properties: { ok: { type: "boolean" } } },
        strict: false,
      },
    });

    expect(translate({ input: "x", text: { format: { type: "json_object" } } }).body.text)
      .toBeUndefined();
  });

  it("produces stable output when translated twice", () => {
    const first = translate({
      model: "grok-4.5",
      input: [{ type: "message", role: "user", content: "search" }],
      tools: [
        { type: "custom", name: "exec" },
        { type: "x_search", metadata: "drop" },
      ],
      tool_choice: { type: "custom", name: "exec" },
      reasoning: { effort: "max" },
      text: { format: { type: "text" }, verbosity: "low" },
    }).body;

    expect(translate(first).body).toEqual(first);
  });
});
