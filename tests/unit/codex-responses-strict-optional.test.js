import { describe, expect, it } from "vitest";

import { openaiToOpenAIResponsesRequest } from "../../open-sse/translator/request/openai-responses.js";
import "../../open-sse/translator/index.js";
import { CodexExecutor } from "../../open-sse/executors/codex.js";

// Responses auto-normalizes omitted strict to strict mode when possible, which
// would force optional fields (e.g. EnterWorktree name/path) to required.
// Chat source is non-strict, so the Chat->Responses hop opts out explicitly.
const chatBody = (fnExtra) => ({
  model: "x",
  messages: [{ role: "user", content: "hi" }],
  tools: [{
    type: "function",
    function: {
      name: "EnterWorktree",
      description: "enter",
      parameters: {
        type: "object",
        properties: { name: { type: "string" }, path: { type: "string" } },
      },
      ...fnExtra,
    },
  }],
});

const codexBody = (tool) => ({
  model: "gpt-5.5",
  input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] }],
  tools: [tool],
  stream: true,
});

describe("codex responses strict optional tools", () => {
  it("defaults missing strict to false on Chat->Responses, keeps schema optional", () => {
    const out = openaiToOpenAIResponsesRequest("m", chatBody(), true, {});
    expect(out.tools[0].strict).toBe(false);
    expect(Object.keys(out.tools[0].parameters.properties).sort()).toEqual(["name", "path"]);
    expect(out.tools[0].parameters).not.toHaveProperty("required");
  });

  it("preserves explicit strict true/false on Chat->Responses", () => {
    expect(openaiToOpenAIResponsesRequest("m", chatBody({ strict: true }), true, {}).tools[0].strict).toBe(true);
    expect(openaiToOpenAIResponsesRequest("m", chatBody({ strict: false }), true, {}).tools[0].strict).toBe(false);
  });

  it("leaves Chat->Responses tool_choice handling unchanged", () => {
    const body = chatBody();
    body.tool_choice = { type: "function", name: "EnterWorktree" };
    expect(openaiToOpenAIResponsesRequest("m", body, true, {}).tool_choice).toBeUndefined();
  });

  it("preserves explicit strict through Codex native flatten, leaves omitted absent", () => {
    const ex = new CodexExecutor();
    const creds = { connectionId: "t", providerSpecificData: {} };
    const bFalse = codexBody({
      type: "function", name: "EnterWorktree", description: "d",
      parameters: { type: "object", properties: { name: { type: "string" } } }, strict: false,
    });
    ex.transformRequest("gpt-5.5", bFalse, true, creds);
    expect(bFalse.tools[0].strict).toBe(false);

    const bTrue = codexBody({
      type: "function", function: {
        name: "EnterWorktree", description: "d",
        parameters: { type: "object", properties: {} }, strict: true,
      },
    });
    ex.transformRequest("gpt-5.5", bTrue, true, creds);
    expect(bTrue.tools[0].strict).toBe(true);

    const bOmit = codexBody({
      type: "function", name: "EnterWorktree", description: "d",
      parameters: { type: "object", properties: {} },
    });
    ex.transformRequest("gpt-5.5", bOmit, true, creds);
    expect(bOmit.tools[0]).not.toHaveProperty("strict");
  });

  it("keeps Codex tool_choice validation and native/custom tools intact", () => {
    const ex = new CodexExecutor();
    const creds = { connectionId: "t", providerSpecificData: {} };
    const bChoice = codexBody({
      type: "function", name: "EnterWorktree", description: "d",
      parameters: { type: "object", properties: {} },
    });
    bChoice.tool_choice = { type: "function", name: "EnterWorktree" };
    ex.transformRequest("gpt-5.5", bChoice, true, creds);
    expect(bChoice.tool_choice).toEqual({ type: "function", name: "EnterWorktree" });

    const bBad = codexBody({
      type: "function", name: "EnterWorktree", description: "d",
      parameters: { type: "object", properties: {} },
    });
    bBad.tool_choice = { type: "function", name: "Nope" };
    ex.transformRequest("gpt-5.5", bBad, true, creds);
    expect(bBad.tool_choice).toBeUndefined();

    const bNative = codexBody({ type: "web_search", search_context_size: "medium" });
    ex.transformRequest("gpt-5.5", bNative, true, creds);
    expect(bNative.tools[0].type).toBe("web_search");

    const bCustom = codexBody({ type: "custom", name: "apply_patch", description: "p" });
    ex.transformRequest("gpt-5.5", bCustom, true, creds);
    expect(bCustom.tools[0].type).toBe("custom");
  });
});
