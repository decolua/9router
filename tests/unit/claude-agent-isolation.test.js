import { describe, expect, it } from "vitest";

import { claudeToOpenAIRequest } from "../../open-sse/translator/request/claude-to-openai.js";
import { openaiToClaudeResponse } from "../../open-sse/translator/response/openai-to-claude.js";

function createState() {
  return { toolCalls: new Map(), nextBlockIndex: 0 };
}

function getInputJsonDelta(events) {
  return events.find((event) => event.type === "content_block_delta" && event.delta?.type === "input_json_delta")?.delta.partial_json;
}

describe("Claude Agent isolation sanitization", () => {
  it("removes worktree isolation from Agent schema and history", () => {
    const body = {
      messages: [
        {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "call_agent",
              name: "Agent",
              input: {
                description: "Find files",
                prompt: "Read-only exploration",
                subagent_type: "Explore",
                model: "haiku",
                run_in_background: false,
                isolation: "worktree",
              },
            },
          ],
        },
      ],
      tools: [
        {
          name: "Agent",
          description: "Launch an agent",
          input_schema: {
            type: "object",
            properties: {
              description: { type: "string" },
              prompt: { type: "string" },
              subagent_type: { type: "string" },
              isolation: { type: "string", enum: ["worktree"] },
            },
            required: ["description", "prompt", "isolation"],
          },
        },
      ],
    };

    const result = claudeToOpenAIRequest("gpt-5.5", body, true);
    const agentTool = result.tools.find((tool) => tool.function?.name === "Agent");
    const agentArgs = JSON.parse(result.messages[0].tool_calls[0].function.arguments);

    expect(agentTool.function.parameters.properties.isolation).toBeUndefined();
    expect(agentTool.function.parameters.required).toEqual(["description", "prompt"]);
    expect(agentArgs).toEqual({
      description: "Find files",
      prompt: "Read-only exploration",
      subagent_type: "Explore",
      model: "haiku",
      run_in_background: false,
    });
  });

  it("removes worktree isolation from emitted Agent tool args", () => {
    const state = createState();

    openaiToClaudeResponse({
      id: "chatcmpl-agent",
      model: "test-model",
      choices: [{ delta: { tool_calls: [{ index: 0, id: "call_agent", function: { name: "Agent" } }] } }],
    }, state);

    const events = openaiToClaudeResponse({
      id: "chatcmpl-agent",
      model: "test-model",
      choices: [{
        delta: {
          tool_calls: [{
            index: 0,
            function: {
              arguments: JSON.stringify({
                description: "Find files",
                prompt: "Read-only exploration",
                subagent_type: "Explore",
                model: "haiku",
                run_in_background: false,
                isolation: "worktree",
              }),
            },
          }],
        },
        finish_reason: "tool_calls",
      }],
    }, state);

    expect(JSON.parse(getInputJsonDelta(events))).toEqual({
      description: "Find files",
      prompt: "Read-only exploration",
      subagent_type: "Explore",
      model: "haiku",
      run_in_background: false,
    });
  });
});
