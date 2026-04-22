import { beforeEach, describe, expect, it, vi } from "vitest";

const getOpenCodePreferences = vi.fn();
const load9RouterModelCatalog = vi.fn();

vi.mock("next/server", () => ({
  NextResponse: {
    json: vi.fn((body, init) => ({
      status: init?.status || 200,
      body,
      json: async () => body,
    })),
  },
}));

vi.mock("@/models", () => ({
  getOpenCodePreferences,
}));

vi.mock("@/lib/opencodeSync/generator.js", async () => {
  const actual = await vi.importActual("../../src/lib/opencodeSync/generator.js");
  return actual;
});

vi.mock("@/lib/opencodeSync/modelCatalog.js", () => ({
  load9RouterModelCatalog,
}));

let GET;

describe("/api/opencode/bundle/preview", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("../../src/app/api/opencode/bundle/preview/route.js");
    GET = mod.GET;
  });

  it("returns generated preview payload with sync plugin present", async () => {
    getOpenCodePreferences.mockResolvedValue({
      variant: "openagent",
      defaultModel: "openai/gpt-4.1-free",
      excludedModels: ["anthropic/claude-3.7-sonnet-free"],
      customPlugins: ["team-plugin@latest"],
      envVars: [{ key: "OPENAI_API_KEY", value: "super-secret", secret: true }],
    });

    load9RouterModelCatalog.mockResolvedValue({
      "openai/gpt-4.1-free": { id: "openai/gpt-4.1-free" },
      "anthropic/claude-3.7-sonnet-free": { id: "anthropic/claude-3.7-sonnet-free" },
      "openai/gpt-4.1": { id: "openai/gpt-4.1" },
    });

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.body.version).toEqual(expect.any(String));
    expect(response.body.version).toHaveLength(64);
    expect(response.body.catalogModels).toEqual([
      {
        id: "anthropic/claude-3.7-sonnet-free",
        name: "anthropic/claude-3.7-sonnet-free",
        provider: "anthropic",
      },
      {
        id: "openai/gpt-4.1",
        name: "openai/gpt-4.1",
        provider: "openai",
      },
      {
        id: "openai/gpt-4.1-free",
        name: "openai/gpt-4.1-free",
        provider: "openai",
      },
    ]);
    expect(response.body.opencode.plugin).toContain("opencode-9router-sync@latest");
    expect(response.body.opencode.plugin).toContain("team-plugin@latest");
    expect(response.body.opencode.model).toBe("9router/openai/gpt-4.1-free");
    expect(response.body.opencode.env).toEqual({ OPENAI_API_KEY: "<set-locally>" });
    expect(response.body.ohMyOpencode).toEqual(expect.any(Object));
    expect(response.body.ohMyOpenCodeSlim).toBeNull();
    expect(response.body.opencode).toEqual({
      $schema: "https://opencode.ai/config.json",
      plugin: [
        "opencode-9router-sync@latest",
        "oh-my-openagent@latest",
        "team-plugin@latest",
      ],
      provider: {
        "9router": {
          npm: "@ai-sdk/openai-compatible",
          name: "9Router",
          options: {
            baseURL: expect.any(String),
            apiKey: expect.any(String),
          },
          models: {
            "openai/gpt-4.1": {
              name: "openai/gpt-4.1",
              attachment: true,
              modalities: {
                input: ["text", "image"],
                output: ["text"],
              },
              limit: {
                context: 200000,
                output: 64000,
              },
            },
            "openai/gpt-4.1-free": {
              name: "openai/gpt-4.1-free",
              attachment: true,
              modalities: {
                input: ["text", "image"],
                output: ["text"],
              },
              limit: {
                context: 200000,
                output: 64000,
              },
            },
          },
        },
      },
      model: "9router/openai/gpt-4.1-free",
      env: {
        OPENAI_API_KEY: "<set-locally>",
      },
    });
    expect(response.body.opencode).not.toHaveProperty("models");
    expect(response.body).not.toHaveProperty("hash");
    expect(response.body).not.toHaveProperty("revision");
    expect(response.body).not.toHaveProperty("generatedAt");
    expect(response.body).not.toHaveProperty("schemaVersion");
    expect(response.body).not.toHaveProperty("preview");
    expect(response.body).not.toHaveProperty("bundle");
  });

  it("supports object-shaped catalogs and preserves model metadata", async () => {
    getOpenCodePreferences.mockResolvedValue({
      variant: "openagent",
      defaultModel: "openai/gpt-4.1-free",
    });

    load9RouterModelCatalog.mockResolvedValue({
      "openai/gpt-4.1-free": {
        id: "openai/gpt-4.1-free",
        name: "GPT-4.1 Free",
        provider: "openai",
        contextWindow: 128000,
        tags: ["free", "chat"],
      },
      "openai/gpt-4.1": {
        id: "openai/gpt-4.1",
        name: "GPT-4.1",
      },
    });

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.body.catalogModels).toEqual([
      {
        id: "openai/gpt-4.1",
        name: "GPT-4.1",
        provider: "openai",
      },
      {
        id: "openai/gpt-4.1-free",
        name: "GPT-4.1 Free",
        provider: "openai",
      },
    ]);
  });

  it("keeps include mode previews resolved from the 9router model catalog", async () => {
    getOpenCodePreferences.mockResolvedValue({
      variant: "openagent",
      modelSelectionMode: "include",
      includedModels: ["anthropic/claude-3.7-sonnet-free"],
    });

    load9RouterModelCatalog.mockResolvedValue({
      "openai/gpt-4.1-free": { id: "openai/gpt-4.1-free", provider: "openai", name: "GPT-4.1 Free" },
      "anthropic/claude-3.7-sonnet-free": { id: "anthropic/claude-3.7-sonnet-free", provider: "anthropic", name: "Claude 3.7 Sonnet Free" },
    });

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.body.opencode.provider["9router"].models).toEqual({
      "anthropic/claude-3.7-sonnet-free": {
        name: "anthropic/claude-3.7-sonnet-free",
        attachment: true,
        modalities: {
          input: ["text", "image"],
          output: ["text"],
        },
        limit: {
          context: 200000,
          output: 32000,
        },
      },
    });
  });

  it("returns 500 when loading the 9router catalog fails", async () => {
    getOpenCodePreferences.mockResolvedValue({ variant: "openagent" });

    load9RouterModelCatalog.mockRejectedValue(new Error("boom"));

    const response = await GET();

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: "Failed to generate OpenCode bundle preview" });
  });

  it("returns 400 when preview generation rejects an invalid default model", async () => {
    getOpenCodePreferences.mockResolvedValue({
      variant: "openagent",
      defaultModel: "anthropic/claude-3.7-sonnet-free",
    });

    load9RouterModelCatalog.mockResolvedValue({
      "openai/gpt-4.1-free": { id: "openai/gpt-4.1-free", name: "GPT-4.1 Free", provider: "openai" },
    });

    const response = await GET();

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: "Default model must be included in generated bundle models",
    });
  });

  it("returns generated advanced config materialized for the selected variant", async () => {
    getOpenCodePreferences.mockResolvedValue({
      variant: "openagent",
      defaultModel: "openai/gpt-4.1",
      modelSelectionMode: "include",
      includedModels: ["openai/gpt-4.1", "anthropic/claude-3.7-sonnet", "xai/grok-3-mini"],
    });

    load9RouterModelCatalog.mockResolvedValue({
      "openai/gpt-4.1": { id: "openai/gpt-4.1", provider: "openai", name: "GPT-4.1" },
      "anthropic/claude-3.7-sonnet": { id: "anthropic/claude-3.7-sonnet", provider: "anthropic", name: "Claude 3.7 Sonnet" },
      "xai/grok-3-mini": { id: "xai/grok-3-mini", provider: "xai", name: "Grok 3 Mini" },
    });

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.body.opencode).toEqual(expect.any(Object));
    expect(response.body.ohMyOpencode).toEqual({
      $schema:
        "https://raw.githubusercontent.com/code-yeongyu/oh-my-openagent/main/assets/oh-my-opencode.schema.json",
      agents: {
        explorer: { model: "9router/anthropic/claude-3.7-sonnet" },
        sisyphus: { model: "9router/openai/gpt-4.1" },
        oracle: { model: "9router/openai/gpt-4.1" },
        librarian: { model: "9router/anthropic/claude-3.7-sonnet" },
        prometheus: { model: "9router/openai/gpt-4.1" },
        atlas: { model: "9router/anthropic/claude-3.7-sonnet" },
      },
      categories: {
        deep: { model: "9router/openai/gpt-4.1" },
        quick: { model: "9router/anthropic/claude-3.7-sonnet" },
        "visual-engineering": { model: "9router/anthropic/claude-3.7-sonnet" },
        writing: { model: "9router/openai/gpt-4.1" },
        artistry: { model: "9router/xai/grok-3-mini" },
      },
      auto_update: false,
      background_task: {
        defaultConcurrency: 5,
      },
      sisyphus_agent: {
        planner_enabled: true,
        replace_plan: true,
      },
      git_master: {
        commit_footer: false,
        include_co_authored_by: false,
      },
    });
  });

  it("returns preview public artifacts with the same placeholder contract as sync bundle output", async () => {
    getOpenCodePreferences.mockResolvedValue({
      variant: "openagent",
      defaultModel: "openai/gpt-4.1-free",
      envVars: [{ key: "OPENAI_API_KEY", value: "super-secret", secret: true }],
    });

    load9RouterModelCatalog.mockResolvedValue({
      "openai/gpt-4.1-free": { id: "openai/gpt-4.1-free", name: "GPT-4.1 Free", provider: "openai" },
    });

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.body.opencode.provider["9router"].options.apiKey).toBe("sk_9router");
    expect(response.body.opencode.env).toEqual({ OPENAI_API_KEY: "<set-locally>" });
  });

  it("redacts secret-like advanced overrides from preview public artifacts", async () => {
    getOpenCodePreferences.mockResolvedValue({
      variant: "openagent",
      defaultModel: "openai/gpt-4.1-free",
      advancedOverrides: {
        openagent: {
          headers: {
            authorization: "Bearer super-secret-token",
          },
        },
      },
    });

    load9RouterModelCatalog.mockResolvedValue({
      "openai/gpt-4.1-free": { id: "openai/gpt-4.1-free", name: "GPT-4.1 Free", provider: "openai" },
    });

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.body.ohMyOpencode).toMatchObject({
      headers: {
        authorization: "********",
      },
    });
  });

  it("does not use model name as catalog id fallback", async () => {
    getOpenCodePreferences.mockResolvedValue({
      variant: "openagent",
      defaultModel: "openai/gpt-4.1-free",
    });

    load9RouterModelCatalog.mockResolvedValue([
      { name: "No canonical id" },
      { id: "openai/gpt-4.1-free", name: "GPT-4.1 Free", provider: "openai" },
    ]);

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.body.catalogModels).toEqual([
      {
        id: "openai/gpt-4.1-free",
        name: "GPT-4.1 Free",
        provider: "openai",
      },
    ]);
  });
});
