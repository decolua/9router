import { describe, it, expect } from "vitest";
import { AzureExecutor } from "../../open-sse/executors/azure.js";
import { getExecutor, hasSpecializedExecutor } from "../../open-sse/executors/index.js";

describe("AzureExecutor registry", () => {
  it("is registered on executor map", () => {
    expect(hasSpecializedExecutor("azure")).toBe(true);
    expect(getExecutor("azure")).toBeInstanceOf(AzureExecutor);
  });
});

describe("AzureExecutor.requiresMaxCompletionTokens", () => {
  const executor = new AzureExecutor();

  it("matches gpt-5 family deployments", () => {
    expect(executor.requiresMaxCompletionTokens("gpt-5.6-luna")).toBe(true);
    expect(executor.requiresMaxCompletionTokens("gpt-5-mini")).toBe(true);
    expect(executor.requiresMaxCompletionTokens("GPT-5.6-SOL")).toBe(true);
  });

  it("matches o1/o3/o4 reasoning deployments", () => {
    expect(executor.requiresMaxCompletionTokens("o1-preview")).toBe(true);
    expect(executor.requiresMaxCompletionTokens("o3-mini")).toBe(true);
    expect(executor.requiresMaxCompletionTokens("o4-mini")).toBe(true);
  });

  it("does not match non-reasoning deployments", () => {
    expect(executor.requiresMaxCompletionTokens("gpt-4o")).toBe(false);
    expect(executor.requiresMaxCompletionTokens("gpt-4.1-nano")).toBe(false);
    expect(executor.requiresMaxCompletionTokens("o2-something")).toBe(false);
  });
});

describe("AzureExecutor.transformRequest", () => {
  const executor = new AzureExecutor();

  it("renames max_tokens to max_completion_tokens for reasoning deployments", () => {
    const body = { messages: [{ role: "user", content: "hi" }], max_tokens: 50 };
    const out = executor.transformRequest("gpt-5.6-luna", body, true, {});

    expect(out.max_tokens).toBeUndefined();
    expect(out.max_completion_tokens).toBe(50);
    // original body must not be mutated
    expect(body.max_tokens).toBe(50);
  });

  it("leaves max_tokens untouched for non-reasoning deployments", () => {
    const body = { messages: [{ role: "user", content: "hi" }], max_tokens: 50 };
    const out = executor.transformRequest("gpt-4o", body, true, {});

    expect(out).toBe(body);
    expect(out.max_tokens).toBe(50);
    expect(out.max_completion_tokens).toBeUndefined();
  });

  it("is a no-op when max_tokens is absent", () => {
    const body = { messages: [{ role: "user", content: "hi" }] };
    const out = executor.transformRequest("gpt-5.6-luna", body, true, {});

    expect(out).toBe(body);
    expect(out.max_completion_tokens).toBeUndefined();
  });

  it("keeps an explicit max_completion_tokens and still deletes max_tokens", () => {
    const body = {
      messages: [{ role: "user", content: "hi" }],
      max_tokens: 50,
      max_completion_tokens: 200,
    };
    const out = executor.transformRequest("gpt-5.6-luna", body, true, {});

    expect(out.max_completion_tokens).toBe(200);
    expect(out.max_tokens).toBeUndefined();
    // original body must not be mutated
    expect(body.max_completion_tokens).toBe(200);
    expect(body.max_tokens).toBe(50);
  });
});
