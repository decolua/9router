import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { sanitizeChatBody } from "./request.js";
import { normalizeChatChunk } from "./response.js";

describe("codebuddy sanitizeChatBody", () => {
  it("forces stream and drops non-minimal top-level keys", () => {
    const out = sanitizeChatBody({
      model: "hy3-preview",
      messages: [{ role: "user", content: "hi" }],
      stream: false,
      // Valid hub Chat fields — still dropped here (minimal CodeBuddy proxy)
      store: true,
      metadata: { x: 1 },
      service_tier: "default",
      stream_options: { include_usage: true },
      modalities: ["text"],
      functions: [],
      function_call: "auto",
      extra_body: { thinking: { type: "enabled" } },
      client_metadata: { a: 1 },
      thinking: { type: "enabled" },
      temperature: 0.2,
    });
    assert.equal(out.stream, true);
    assert.equal(out.model, "hy3-preview");
    assert.equal(out.temperature, 0.2);
    assert.equal(out.store, undefined);
    assert.equal(out.metadata, undefined);
    assert.equal(out.service_tier, undefined);
    assert.equal(out.stream_options, undefined);
    assert.equal(out.modalities, undefined);
    assert.equal(out.functions, undefined);
    assert.equal(out.function_call, undefined);
    assert.equal(out.extra_body, undefined);
    assert.equal(out.client_metadata, undefined);
    assert.equal(out.thinking, undefined);
  });

  it("keeps multimodal messages and non-empty tools while stripping unknown CN fields", () => {
    const content = [
      { type: "text", text: "describe" },
      { type: "image_url", image_url: { url: "data:image/png;base64,AA==" } },
    ];
    const tools = [{ type: "function", function: { name: "lookup", parameters: { type: "object" } } }];
    const out = sanitizeChatBody({
      messages: [{ role: "user", content }],
      tools,
      unknown_top_level: { keep: false },
      stream: false,
    });

    assert.deepEqual(out.messages[0].content, content);
    assert.deepEqual(out.tools, tools);
    assert.equal(out.unknown_top_level, undefined);
    assert.equal(out.stream, true);
  });

  it("preserves unknown Intl fields when explicitly requested", () => {
    const body = {
      messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
      tools: [{ type: "function", function: { name: "lookup" } }],
      unknown_top_level: { keep: true },
      stream: false,
    };
    const out = sanitizeChatBody(body, { preserveUnknownFields: true });

    assert.deepEqual(out.unknown_top_level, { keep: true });
    assert.deepEqual(out.messages, body.messages);
    assert.deepEqual(out.tools, body.tools);
    assert.equal(out.stream, true);
  });

  it("omits reasoning params on plain chat", () => {
    const out = sanitizeChatBody({
      model: "hy3-preview",
      messages: [{ role: "user", content: "hi" }],
    });
    assert.equal(out.reasoning_effort, undefined);
    assert.equal(out.reasoning_summary, undefined);
  });

  it("drops empty, none, and off effort and never adds summary", () => {
    for (const effort of ["", "  ", "none", "off", "NONE"]) {
      const out = sanitizeChatBody({
        model: "hy3-preview",
        messages: [],
        reasoning_effort: effort,
        reasoning_summary: "auto",
      });
      assert.equal(out.reasoning_effort, undefined, effort);
      assert.equal(out.reasoning_summary, undefined, effort);
    }
  });

  it("keeps effort and defaults reasoning_summary to auto", () => {
    const out = sanitizeChatBody({
      model: "hy3-preview",
      messages: [],
      reasoning_effort: "medium",
    });
    assert.equal(out.reasoning_effort, "medium");
    assert.equal(out.reasoning_summary, "auto");
  });

  it("preserves an explicit non-empty reasoning_summary", () => {
    const out = sanitizeChatBody({
      model: "hy3-preview",
      messages: [],
      reasoning_effort: "high",
      reasoning_summary: "detailed",
    });
    assert.equal(out.reasoning_effort, "high");
    assert.equal(out.reasoning_summary, "detailed");
  });

  it("removes empty tools array", () => {
    const out = sanitizeChatBody({ model: "x", messages: [], tools: [] });
    assert.equal(out.tools, undefined);
  });
});

describe("codebuddy normalizeChatChunk", () => {
  it("maps empty finish_reason to null", () => {
    const out = normalizeChatChunk({
      object: "chat.completion.chunk",
      choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: "" }],
    });
    assert.equal(out.choices[0].finish_reason, null);
  });

  it("drops empty function_call shells", () => {
    const out = normalizeChatChunk({
      choices: [
        {
          index: 0,
          delta: {
            content: "",
            function_call: { name: "", arguments: "" },
          },
          finish_reason: null,
        },
      ],
    });
    assert.equal(out.choices[0].delta.function_call, undefined);
    assert.equal(out.choices[0].delta.content, "");
  });

  it("keeps real finish_reason and tool deltas", () => {
    const chunk = {
      choices: [
        {
          delta: {
            tool_calls: [{ index: 0, function: { name: "x", arguments: "{" } }],
          },
          finish_reason: "tool_calls",
        },
      ],
    };
    const out = normalizeChatChunk(chunk);
    assert.equal(out.choices[0].finish_reason, "tool_calls");
    assert.ok(out.choices[0].delta.tool_calls);
  });
});
