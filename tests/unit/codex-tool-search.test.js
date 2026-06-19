import { describe, expect, it } from "vitest";

import { CodexExecutor } from "../../open-sse/executors/codex.js";

describe("CodexExecutor tool normalization", () => {
  it("preserves tool_search for deferred Codex tool discovery", () => {
    const executor = new CodexExecutor();
    const body = {
      model: "gpt-5.5",
      input: [
        {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "probe" }],
        },
      ],
      tools: [
        {
          type: "tool_search",
          execution: "sync",
          description: "Discover deferred tools",
          parameters: { type: "object", properties: {} },
        },
        {
          type: "namespace",
          name: "codex_app",
          description: "App tools",
          tools: [
            {
              type: "function",
              name: "automation_update",
              description: "Update automation state",
              parameters: { type: "object", properties: {} },
              defer_loading: true,
            },
          ],
        },
        {
          type: "function",
          name: "plain_fn",
          description: "plain",
          parameters: { type: "object", properties: {} },
        },
      ],
    };

    executor.transformRequest("gpt-5.5", body, true, {
      connectionId: "codex-tool-search-test",
      providerSpecificData: {},
    });

    expect(body.tools.map((tool) => tool.type)).toEqual([
      "tool_search",
      "namespace",
      "function",
    ]);
    expect(body.tools[0]).toMatchObject({
      type: "tool_search",
      execution: "sync",
      description: "Discover deferred tools",
    });
  });
});
