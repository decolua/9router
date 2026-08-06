import { describe, expect, it } from "vitest";

import {
  buildCompatibleModelsResponse,
  isCodexModelsRequest,
} from "@/app/api/v1/models/route.js";

const data = [
  { id: "gpt-5.6-sol", object: "model", owned_by: "combo" },
  { id: "cx/gpt-5.6-sol", object: "model", owned_by: "cx" },
  { id: "oa/gpt-4.1", object: "model", owned_by: "oa" },
];

describe("GET /v1/models response compatibility", () => {
  it("preserves the exact OpenAI model-list envelope by default", () => {
    expect(buildCompatibleModelsResponse(data)).toEqual({ object: "list", data });
  });

  it("returns the Codex models protocol only for Codex clients", () => {
    const response = buildCompatibleModelsResponse(data, { includeCodexCatalog: true });

    expect(Object.keys(response)).toEqual(["models"]);
    expect(response.models.map((model) => model.slug)).toEqual([
      "gpt-5.6-sol",
      "cx/gpt-5.6-sol",
      "oa/gpt-4.1",
    ]);
    expect(response).not.toHaveProperty("data");
    expect(response).not.toHaveProperty("object");
  });

  it("maps GPT-5.6 capabilities into Codex model metadata", () => {
    const response = buildCompatibleModelsResponse(data, { includeCodexCatalog: true });
    const model = response.models.find((entry) => entry.slug === "cx/gpt-5.6-sol");

    expect(model).toMatchObject({
      display_name: "cx/gpt-5.6-sol",
      default_reasoning_level: "medium",
      shell_type: "shell_command",
      visibility: "list",
      supported_in_api: true,
      supports_reasoning_summaries: true,
      support_verbosity: true,
      truncation_policy: { mode: "tokens", limit: 10000 },
      supports_parallel_tool_calls: true,
      context_window: 400000,
      input_modalities: ["text", "image"],
      use_responses_lite: true,
      tool_mode: "code_mode_only",
      multi_agent_version: "v2",
    });
    expect(model.supported_reasoning_levels.map(({ effort }) => effort)).toEqual([
      "none",
      "minimal",
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ]);
    expect(model.base_instructions).toContain("coding agent");
  });

  it("does not advertise reasoning for a non-reasoning model", () => {
    const response = buildCompatibleModelsResponse(data, { includeCodexCatalog: true });
    const model = response.models.find((entry) => entry.slug === "oa/gpt-4.1");

    expect(model.default_reasoning_level).toBeNull();
    expect(model.supported_reasoning_levels).toEqual([]);
    expect(model.supports_reasoning_summaries).toBe(false);
    expect(model.use_responses_lite).toBe(false);
  });

  it.each([
    ["Codex Desktop/0.144.0-alpha.4", true],
    ["codex_cli_rs/0.144.1", true],
    ["codex_exec/0.144.1", true],
    ["openai-node/6.0.0", false],
  ])("detects %s only when client_version is present", (userAgent, expected) => {
    const request = new Request("https://router.example/v1/models?client_version=0.144.0", {
      headers: { "User-Agent": userAgent },
    });
    expect(isCodexModelsRequest(request)).toBe(expected);
  });

  it("does not alter Codex-looking requests without the version query", () => {
    const request = new Request("https://router.example/v1/models", {
      headers: { "User-Agent": "Codex Desktop/0.144.0-alpha.4" },
    });
    expect(isCodexModelsRequest(request)).toBe(false);
  });
});
