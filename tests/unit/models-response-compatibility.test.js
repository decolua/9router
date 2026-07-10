import { describe, expect, it } from "vitest";

import {
  buildCompatibleModelsResponse,
  isCodexModelsRequest,
} from "@/app/api/v1/models/route.js";

const data = [
  { id: "gpt-5.6-sol", object: "model", owned_by: "combo" },
  { id: "cx/gpt-5.6-sol", object: "model", owned_by: "cx" },
];

describe("GET /v1/models response compatibility", () => {
  it("preserves the exact OpenAI model-list envelope by default", () => {
    expect(buildCompatibleModelsResponse(data)).toEqual({ object: "list", data });
  });

  it("adds an empty Codex catalog without changing OpenAI data", () => {
    expect(buildCompatibleModelsResponse(data, { includeCodexCatalog: true })).toEqual({
      object: "list",
      data,
      models: [],
    });
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
