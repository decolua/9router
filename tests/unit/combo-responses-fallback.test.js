import { beforeEach, describe, expect, it, vi } from "vitest";

import { handleComboChat } from "../../open-sse/services/combo.js";

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const log = {
  info: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
};

const responsesBody = {
  input: [{ role: "user", content: "hello" }],
};

describe("handleComboChat /v1/responses fallback classification (#1946)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("still falls back on upstream/provider 404s when another combo model can answer", async () => {
    const handleSingleModel = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(404, { error: { message: "Upstream /responses returned 404" } }))
      .mockResolvedValueOnce(jsonResponse(200, {
        output: [{ content: [{ text: "combo fallback ok" }] }],
      }));

    const response = await handleComboChat({
      body: responsesBody,
      models: ["openai/gpt-5-codex", "anthropic/claude-sonnet-4.5"],
      handleSingleModel,
      log,
      comboName: "combo-responses",
      comboStrategy: "fallback",
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      output: [{ content: [{ text: "combo fallback ok" }] }],
    });
    expect(handleSingleModel.mock.calls.map(([, model]) => model)).toEqual([
      "openai/gpt-5-codex",
      "anthropic/claude-sonnet-4.5",
    ]);
  });

  it("does not mask local no-credentials 404s behind combo fallback", async () => {
    const handleSingleModel = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(404, { error: { message: "No active credentials for provider: openai" } }))
      .mockResolvedValueOnce(jsonResponse(200, {
        output: [{ content: [{ text: "should not reach fallback" }] }],
      }));

    const response = await handleComboChat({
      body: responsesBody,
      models: ["openai/gpt-5-codex", "anthropic/claude-sonnet-4.5"],
      handleSingleModel,
      log,
      comboName: "combo-no-creds",
      comboStrategy: "fallback",
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: { message: "No active credentials for provider: openai" },
    });
    expect(handleSingleModel).toHaveBeenCalledTimes(1);
    expect(handleSingleModel).toHaveBeenCalledWith(responsesBody, "openai/gpt-5-codex");
  });

  it("does not mask local invalid-model errors behind combo fallback", async () => {
    const handleSingleModel = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(400, { error: { message: "Invalid model format" } }))
      .mockResolvedValueOnce(jsonResponse(200, {
        output: [{ content: [{ text: "should not reach fallback" }] }],
      }));

    const response = await handleComboChat({
      body: responsesBody,
      models: ["broken-leaf-model", "anthropic/claude-sonnet-4.5"],
      handleSingleModel,
      log,
      comboName: "combo-invalid-leaf",
      comboStrategy: "fallback",
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: { message: "Invalid model format" },
    });
    expect(handleSingleModel).toHaveBeenCalledTimes(1);
    expect(handleSingleModel).toHaveBeenCalledWith(responsesBody, "broken-leaf-model");
  });

  it("does not swallow local provider-config 404s", async () => {
    const handleSingleModel = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(404, { error: { message: "OpenAI Compatible node not found" } }))
      .mockResolvedValueOnce(jsonResponse(200, {
        output: [{ content: [{ text: "should not reach fallback" }] }],
      }));

    const response = await handleComboChat({
      body: responsesBody,
      models: ["openai/gpt-5-codex", "anthropic/claude-sonnet-4.5"],
      handleSingleModel,
      log,
      comboName: "combo-local-config",
      comboStrategy: "fallback",
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: { message: "OpenAI Compatible node not found" },
    });
    expect(handleSingleModel).toHaveBeenCalledTimes(1);
    expect(handleSingleModel).toHaveBeenCalledWith(responsesBody, "openai/gpt-5-codex");
  });
});
