import { describe, expect, it } from "vitest";
import { AzureExecutor } from "../../open-sse/executors/azure.js";

const executor = new AzureExecutor();

describe("AzureExecutor", () => {
  it("uses the requested model as the Azure deployment", () => {
    const credentials = {
      providerSpecificData: {
        azureEndpoint: "https://example-resource.openai.azure.com",
        apiVersion: "2025-04-01-preview",
        deployment: "gpt-5-chat-deployment",
      },
    };

    expect(executor.buildUrl("requested-deployment", true, 0, credentials)).toBe(
      "https://example-resource.openai.azure.com/openai/deployments/requested-deployment/chat/completions?api-version=2025-04-01-preview"
    );
  });

  it("uses the connection deployment only when no model is requested", () => {
    expect(executor.resolveDeployment(null, {
      providerSpecificData: { deployment: "gpt-5-chat-deployment" },
    })).toBe("gpt-5-chat-deployment");
  });

  it("converts max_tokens without mutating the original GPT-5 request", () => {
    const body = Object.freeze({
      max_tokens: 4096,
      messages: Object.freeze([{ role: "user", content: "Hello" }]),
    });

    const result = executor.transformRequest("gpt-5-chat-deployment", body);

    expect(result).toEqual({
      max_completion_tokens: 4096,
      messages: body.messages,
    });
    expect(body).toHaveProperty("max_tokens", 4096);
  });

  it("preserves explicit max_completion_tokens", () => {
    const result = executor.transformRequest("o3-reasoning-deployment", {
      max_tokens: 1024,
      max_completion_tokens: 8192,
    });

    expect(result).toEqual({ max_completion_tokens: 8192 });
  });

  it("omits custom temperature but preserves the supported default", () => {
    expect(
      executor.transformRequest("gpt-5-chat-deployment", { temperature: 0.2 })
    ).toEqual({});
    expect(
      executor.transformRequest("gpt-5-chat-deployment", { temperature: 1 })
    ).toEqual({ temperature: 1 });
  });

  it("removes reasoning_effort with function tools while preserving tool fields", () => {
    const tools = [{ type: "function", function: { name: "get_weather" } }];
    const body = Object.freeze({
      tools: Object.freeze(tools),
      tool_choice: "auto",
      reasoning_effort: "medium",
    });

    const result = executor.transformRequest("gpt-5-chat-deployment", body);

    expect(result).toEqual({ tools, tool_choice: "auto" });
    expect(body).toHaveProperty("reasoning_effort", "medium");
  });

  it("removes reasoning_effort when its value is none", () => {
    expect(
      executor.transformRequest("o4-mini-deployment", { reasoning_effort: "none" })
    ).toEqual({});
  });

  it("keeps GPT-4 requests unchanged", () => {
    const body = {
      max_tokens: 1024,
      temperature: 0.2,
      reasoning_effort: "none",
      tools: [{ type: "function", function: { name: "get_weather" } }],
      tool_choice: "required",
    };

    expect(executor.transformRequest("gpt-4o-deployment", body)).toBe(body);
  });
});
