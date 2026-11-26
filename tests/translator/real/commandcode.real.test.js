import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { CommandCodeExecutor } from "../../../open-sse/executors/commandcode.js";
import { openaiToCommandCodeRequest } from "../../../open-sse/translator/request/openai-to-commandcode.js";

describe("Live verification: CommandCode real upstream call", () => {
  it("authenticates and streams SSE response via CommandCodeExecutor", async () => {
    const authPath = join(homedir(), ".commandcode", "auth.json");
    if (!existsSync(authPath)) {
      console.log("Skipping live test: ~/.commandcode/auth.json not found");
      return;
    }

    const auth = JSON.parse(readFileSync(authPath, "utf8"));
    if (!auth.apiKey) {
      console.log("Skipping live test: No apiKey in auth.json");
      return;
    }

    const model = "deepseek/deepseek-v4-flash";
    const body = {
      messages: [{ role: "user", content: "Katakan 'Halo Alwa' saja!" }],
      max_tokens: 30,
    };

    const transformed = openaiToCommandCodeRequest(model, body, true, {
      _clientSessionId: "live-test-session",
    });
    const executor = new CommandCodeExecutor();

    const result = await executor.execute({
      model,
      body: transformed,
      credentials: { apiKey: auth.apiKey },
      stream: true,
    });

    expect(result.response.status).toBe(200);

    const reader = result.response.body.getReader();
    const decoder = new TextDecoder();
    let accumulated = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      accumulated += decoder.decode(value);
      if (accumulated.includes("[DONE]")) break;
    }

    // Verify it returned valid SSE chat completions chunks
    expect(accumulated).toContain("data: ");
    expect(accumulated).toContain("chat.completion.chunk");
  }, 30000);

  it("handles multi-turn with tool result omitting tool name live upstream", async () => {
    const authPath = join(homedir(), ".commandcode", "auth.json");
    if (!existsSync(authPath)) return;
    const auth = JSON.parse(readFileSync(authPath, "utf8"));
    if (!auth.apiKey) return;

    const model = "deepseek/deepseek-v4-flash";
    const body = {
      messages: [
        { role: "user", content: "What is the time?" },
        {
          role: "assistant",
          content: "Let me check the time.",
          tool_calls: [
            { id: "call_time_1", type: "function", function: { name: "get_time", arguments: "{}" } },
          ],
        },
        // Notice: NO name property, exactly as sent by real Claude Code or OpenAI SDK!
        { role: "tool", tool_call_id: "call_time_1", content: "12:00 PM" },
      ],
      max_tokens: 30,
    };

    const transformed = openaiToCommandCodeRequest(model, body, true, {
      _clientSessionId: "live-tool-session",
    });
    const executor = new CommandCodeExecutor();

    const result = await executor.execute({
      model,
      body: transformed,
      credentials: { apiKey: auth.apiKey },
      stream: true,
    });

    expect(result.response.status).toBe(200);

    const reader = result.response.body.getReader();
    const decoder = new TextDecoder();
    let accumulated = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      accumulated += decoder.decode(value);
      if (accumulated.includes("[DONE]")) break;
    }

    expect(accumulated).toContain("data: ");
    expect(accumulated).toContain("chat.completion.chunk");
  }, 30000);
});
