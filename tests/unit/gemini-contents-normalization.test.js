import { describe, it, expect } from "vitest";
import { normalizeGeminiContents, sanitizeFunctionResponsePayload } from "../../open-sse/translator/formats/gemini.js";
import { openaiToGeminiRequest } from "../../open-sse/translator/request/openai-to-gemini.js";

describe("normalizeGeminiContents terminal turn guards", () => {
  it("appends user Continue turn when ending with model text turn", () => {
    const contents = [
      { role: "user", parts: [{ text: "hi" }] },
      { role: "model", parts: [{ text: "hello" }] }
    ];
    const out = normalizeGeminiContents(contents);
    expect(out).toHaveLength(3);
    expect(out[2]).toEqual({ role: "user", parts: [{ text: "Continue." }] });
  });

  it("appends functionResponse user turn when ending with functionCall", () => {
    const contents = [
      { role: "user", parts: [{ text: "run" }] },
      {
        role: "model",
        parts: [
          { functionCall: { id: "call_1", name: "search", args: { q: "test" } } }
        ]
      }
    ];
    const out = normalizeGeminiContents(contents);
    expect(out).toHaveLength(3);
    expect(out[2]).toEqual({
      role: "user",
      parts: [
        {
          functionResponse: {
            id: "call_1",
            name: "search",
            response: { result: "Continue." }
          }
        }
      ]
    });
  });

  it("handles multiple functionCalls in terminal model turn", () => {
    const contents = [
      { role: "user", parts: [{ text: "run" }] },
      {
        role: "model",
        parts: [
          { functionCall: { id: "call_1", name: "fn_1" } },
          { functionCall: { id: "call_2", name: "fn_2" } }
        ]
      }
    ];
    const out = normalizeGeminiContents(contents);
    expect(out).toHaveLength(3);
    expect(out[2].parts).toHaveLength(2);
    expect(out[2].parts[0].functionResponse.id).toBe("call_1");
    expect(out[2].parts[1].functionResponse.id).toBe("call_2");
  });

  it("handles terminal model turn with both text and functionCall", () => {
    const contents = [
      { role: "user", parts: [{ text: "run" }] },
      {
        role: "model",
        parts: [
          { text: "Executing..." },
          { functionCall: { id: "call_3", name: "exec" } }
        ]
      }
    ];
    const out = normalizeGeminiContents(contents);
    expect(out).toHaveLength(3);
    expect(out[2].parts[0].functionResponse.id).toBe("call_3");
  });

  it("handles single model turn by prepending user prompt and appending terminal user", () => {
    const contents = [{ role: "model", parts: [{ text: "prefill" }] }];
    const out = normalizeGeminiContents(contents);
    expect(out).toHaveLength(3);
    expect(out[0]).toEqual({ role: "user", parts: [{ text: "..." }] });
    expect(out[1]).toEqual({ role: "model", parts: [{ text: "prefill" }] });
    expect(out[2]).toEqual({ role: "user", parts: [{ text: "Continue." }] });
  });

  it("does not mutate payloads already ending with a user turn", () => {
    const contents = [{ role: "user", parts: [{ text: "question" }] }];
    const out = normalizeGeminiContents(contents);
    expect(out).toHaveLength(1);
    expect(out[0].role).toBe("user");
  });

  it("handles functionCall without name or id with fallback defaults", () => {
    const contents = [
      { role: "user", parts: [{ text: "Go" }] },
      { role: "model", parts: [{ functionCall: {} }] }
    ];
    const out = normalizeGeminiContents(contents);
    expect(out).toHaveLength(3);
    expect(out[2].parts[0]).toEqual({
      functionResponse: {
        name: "tool",
        response: { result: "Continue." }
      }
    });
    expect(out[2].parts[0].functionResponse.id).toBeUndefined();
  });

  it("merges adjacent model turns before appending terminal user turn", () => {
    const contents = [
      { role: "user", parts: [{ text: "Prompt" }] },
      { role: "model", parts: [{ text: "Part A" }] },
      { role: "model", parts: [{ text: "Part B" }] }
    ];
    const out = normalizeGeminiContents(contents);
    expect(out).toHaveLength(3);
    expect(out[1].role).toBe("model");
    expect(out[1].parts).toHaveLength(2);
    expect(out[2]).toEqual({ role: "user", parts: [{ text: "Continue." }] });
  });

  it("appends user Continue turn when terminal model turn has thought parts", () => {
    const contents = [
      { role: "user", parts: [{ text: "Solve math" }] },
      {
        role: "model",
        parts: [
          { thought: true, text: "Let 2x = 4..." },
          { thoughtSignature: "sig123", text: "" }
        ]
      }
    ];
    const out = normalizeGeminiContents(contents);
    expect(out).toHaveLength(3);
    expect(out[2]).toEqual({ role: "user", parts: [{ text: "Continue." }] });
  });

  it("handles empty, null, and undefined inputs gracefully", () => {
    expect(normalizeGeminiContents([])).toEqual([]);
    expect(normalizeGeminiContents(null)).toEqual([]);
    expect(normalizeGeminiContents(undefined)).toEqual([]);
  });
});

describe("functionResponse `$ref` sanitization", () => {
  const schemaResult = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $ref: "#/$defs/Config",
    $defs: { Config: { properties: { a: { $ref: "#/$defs/A" } } } },
    list: [{ $ref: "#/$defs/B" }, "plain", 5, null]
  };

  it("renames `$ref` keys recursively and leaves other values untouched", () => {
    const out = sanitizeFunctionResponsePayload(schemaResult);
    expect(out.$ref).toBeUndefined();
    expect(out._ref).toBe("#/$defs/Config");
    expect(out.$defs.Config.properties.a._ref).toBe("#/$defs/A");
    expect(out.list).toEqual([{ _ref: "#/$defs/B" }, "plain", 5, null]);
    expect(out.$schema).toBe(schemaResult.$schema);
    expect(sanitizeFunctionResponsePayload("str")).toBe("str");
    expect(sanitizeFunctionResponsePayload(null)).toBeNull();
  });

  it("normalizeGeminiContents sanitizes functionResponse without mutating input", () => {
    const contents = [
      { role: "user", parts: [{ text: "go" }] },
      { role: "model", parts: [{ functionCall: { id: "c1", name: "webfetch", args: {} } }] },
      { role: "user", parts: [{ functionResponse: { id: "c1", name: "webfetch", response: { result: schemaResult } } }] }
    ];
    const out = normalizeGeminiContents(contents);
    const resp = out[2].parts[0].functionResponse.response;
    expect(JSON.stringify(resp)).not.toContain('"$ref"');
    expect(resp.result._ref).toBe("#/$defs/Config");
    expect(contents[2].parts[0].functionResponse.response.result.$ref).toBe("#/$defs/Config");
  });

  it("openai -> gemini translation of a JSON-schema tool result carries no `$ref` key", () => {
    const body = {
      messages: [
        { role: "user", content: "fetch it" },
        {
          role: "assistant",
          content: null,
          tool_calls: [{ id: "call_1", type: "function", function: { name: "webfetch", arguments: "{}" } }]
        },
        { role: "tool", tool_call_id: "call_1", content: JSON.stringify(schemaResult) },
        { role: "user", content: "thanks" }
      ]
    };
    const out = openaiToGeminiRequest("gemini-3-flash", body, true);
    const frs = out.contents.flatMap(c => c.parts).filter(p => p.functionResponse);
    expect(frs).toHaveLength(1);
    expect(JSON.stringify(frs[0].functionResponse.response)).not.toContain('"$ref"');
    expect(frs[0].functionResponse.response.result._ref).toBe("#/$defs/Config");
  });
});

describe("strict role alternation (user <-> model)", () => {
  it("separates user functionResponse and subsequent user text with an intervening model turn", () => {
    const contents = [
      { role: "user", parts: [{ text: "do work" }] },
      { role: "model", parts: [{ functionCall: { id: "c1", name: "tool1" } }] },
      { role: "user", parts: [{ functionResponse: { id: "c1", name: "tool1", response: { result: "done" } } }] },
      { role: "user", parts: [{ text: "now summarize" }] }
    ];
    const out = normalizeGeminiContents(contents);

    // Roles must alternate: user -> model -> user -> model -> user
    const roles = out.map(c => c.role);
    expect(roles).toEqual(["user", "model", "user", "model", "user"]);
    expect(out[2].parts[0].functionResponse).toBeDefined();
    expect(out[3].parts[0].text).toBe("...");
    expect(out[4].parts[0].text).toBe("now summarize");
  });

  it("preserves empty assistant message in openaiToGeminiRequest to prevent user turn collision", () => {
    const body = {
      messages: [
        { role: "user", content: "Query 1" },
        { role: "assistant", content: "" }, // Empty assistant response (e.g. error/timeout)
        { role: "user", content: "Query 2" }
      ]
    };
    const out = openaiToGeminiRequest("gemini-3-flash", body, false);
    const roles = out.contents.map(c => c.role);
    expect(roles).toEqual(["user", "model", "user"]);
    expect(out.contents[0].parts[0].text).toBe("Query 1");
    expect(out.contents[1].parts[0].text).toBe("...");
    expect(out.contents[2].parts[0].text).toBe("Query 2");
  });

  it("synthesizes functionResponse and bridge model turn if user sends text after functionCall without tool response", () => {
    const contents = [
      { role: "user", parts: [{ text: "start" }] },
      { role: "model", parts: [{ functionCall: { id: "c_cancel", name: "calc" } }] },
      { role: "user", parts: [{ text: "cancel, do something else" }] }
    ];
    const out = normalizeGeminiContents(contents);
    const roles = out.map(c => c.role);
    expect(roles).toEqual(["user", "model", "user", "model", "user"]);
    expect(out[2].parts[0].functionResponse.id).toBe("c_cancel");
    expect(out[3].parts[0].text).toBe("...");
    expect(out[4].parts[0].text).toBe("cancel, do something else");
  });

  it("merges adjacent user text turns when neither contains functionResponse", () => {
    const contents = [
      { role: "user", parts: [{ text: "Hello" }] },
      { role: "user", parts: [{ text: "world" }] }
    ];
    const out = normalizeGeminiContents(contents);
    expect(out).toHaveLength(1);
    expect(out[0].role).toBe("user");
    expect(out[0].parts).toHaveLength(2);
    expect(out[0].parts[0].text).toBe("Hello");
    expect(out[0].parts[1].text).toBe("world");
  });

  it("strictly enforces role alternation across complex sequences with duplicate roles", () => {
    const contents = [
      { role: "model", parts: [{ text: "initial model" }] },
      { role: "user", parts: [{ text: "u1" }] },
      { role: "user", parts: [{ functionResponse: { name: "t", response: {} } }] },
      { role: "user", parts: [{ text: "u2" }] }
    ];
    const out = normalizeGeminiContents(contents);

    // Check that every turn alternates role
    for (let i = 0; i < out.length - 1; i++) {
      expect(out[i].role).not.toBe(out[i + 1].role);
    }
    expect(out[0].role).toBe("user");
    expect(out.at(-1).role).toBe("user");
  });
});

