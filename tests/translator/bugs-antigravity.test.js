// Real Antigravity-MITM requests (Gemini-internal: { request: { contents, ... } }) → OpenAI.
import { describe, it, expect } from "vitest";
import "./registerAll.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { AntigravityExecutor } from "../../open-sse/executors/antigravity.js";

const AG2O = (req) =>
  translateRequest(FORMATS.ANTIGRAVITY, FORMATS.OPENAI, "m", { request: req }, true, null, null);

const O2AG = (body) =>
  translateRequest(
    FORMATS.OPENAI,
    FORMATS.ANTIGRAVITY,
    "gemini-3-flash",
    body,
    true,
    { email: "test@example.com", connectionId: "test-conn" },
    "antigravity"
  );

const opencodeGrepTool = () => ({
  type: "function",
  function: {
    name: "grep",
    description: "Search content",
    parameters: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description: "The regex pattern to search for in file contents",
        },
        path: {
          type: "string",
          description: "The directory to search in",
        },
        include: {
          type: "string",
          description: "Optional file include pattern",
          pattern: "\\\\.js$",
        },
      },
      required: ["pattern"],
    },
  },
});

const firstFunctionParameters = (body) =>
  body.request.tools[0].functionDeclarations[0].parameters;

describe("Antigravity → OpenAI", () => {
  // antigravity-to-openai.js:177-189 — content with BOTH functionResponse and functionCall/text
  // returns toolResults early → drops the tool calls / text.
  // KNOWN BUG
  it.fails("functionResponse + functionCall in same content keeps both", () => {
    const out = AG2O({
      contents: [{
        role: "model",
        parts: [
          { functionResponse: { id: "c1", name: "prev", response: { result: "done" } } },
          { functionCall: { id: "c2", name: "next", args: {} } },
        ],
      }],
    });
    const json = JSON.stringify(out);
    expect(json, "functionCall lost when sharing content with functionResponse").toContain("\"next\"");
  });

  // antigravity-to-openai.js:167 — functionCall without id gets a random Date.now() id
  // KNOWN BUG: unstable id breaks matching with its functionResponse
  it.fails("functionCall without id keeps a stable matchable id", () => {
    const out = AG2O({
      contents: [
        { role: "model", parts: [{ functionCall: { name: "search", args: { q: "x" } } }] },
        { role: "user", parts: [{ functionResponse: { name: "search", response: { result: "r" } } }] },
      ],
    });
    const asst = out.messages.find((m) => m.tool_calls);
    const tool = out.messages.find((m) => m.role === "tool");
    expect(tool?.tool_call_id, "id mismatch between call and response").toBe(asst?.tool_calls?.[0]?.id);
  });

  // antigravity-to-openai.js:144-147 — signature-only part handling (regression guard)
  it("signature-only part does not produce empty text", () => {
    const out = AG2O({
      contents: [{ role: "model", parts: [{ thoughtSignature: "sig", text: "" }] }],
    });
    const asst = out.messages.find((m) => m.role === "assistant");
    const content = asst?.content;
    const hasEmpty = Array.isArray(content)
      ? content.some((c) => c.type === "text" && c.text === "")
      : content === "";
    expect(hasEmpty, "empty text part emitted").toBe(false);
  });
});

describe("OpenAI → Antigravity", () => {
  it("preserves OpenCode grep/glob parameter named pattern", () => {
    const out = O2AG({
      messages: [{ role: "user", content: "Search for TODO comments" }],
      tools: [opencodeGrepTool()],
    });
    const parameters = firstFunctionParameters(out);

    expect(parameters.properties.pattern?.type).toBe("string");
    expect(parameters.required).toContain("pattern");
    expect(parameters.properties.include?.pattern).toBeUndefined();
  });

  it("keeps required pattern after Antigravity executor sanitizes tools again", () => {
    const translated = O2AG({
      messages: [{ role: "user", content: "Search for TODO comments" }],
      tools: [opencodeGrepTool()],
    });
    const executor = new AntigravityExecutor();
    const finalBody = executor.transformRequest("gemini-3-flash", translated, true, {
      email: "test@example.com",
      connectionId: "test-conn",
    });
    const parameters = firstFunctionParameters(finalBody);

    expect(parameters.properties.pattern?.type).toBe("string");
    expect(parameters.required).toContain("pattern");
  });
});
