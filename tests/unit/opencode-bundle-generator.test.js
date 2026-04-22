import { describe, expect, it } from "vitest";

import {
  buildOpenCodeSyncBundle,
  buildOpenCodeSyncPreview,
  OPENCODE_SYNC_BUNDLE_SCHEMA_VERSION,
} from "../../src/lib/opencodeSync/generator.js";
import {
  OPENAGENT_PRESET_PLUGIN,
  OPENCODE_SYNC_PLUGIN,
  SLIM_PRESET_PLUGIN,
} from "../../src/lib/opencodeSync/presets.js";

describe("buildOpenCodeSyncBundle", () => {
  const modelCatalog = {
    "anthropic/claude-3.7-sonnet": { label: "Claude 3.7 Sonnet" },
    "openai/gpt-4.1": { label: "GPT-4.1" },
    "xai/grok-3-mini": { label: "Grok 3 Mini" },
  };

  it("includes sync and openagent preset plugins deterministically", () => {
    const result = buildOpenCodeSyncBundle({
      preferences: {
        variant: "openagent",
        customPlugins: ["zeta-plugin@latest", "alpha-plugin@latest", OPENCODE_SYNC_PLUGIN],
        excludedModels: ["xai/grok-3-mini"],
      },
      modelCatalog,
    });

    expect(result.schemaVersion).toBe(OPENCODE_SYNC_BUNDLE_SCHEMA_VERSION);
    expect(result.bundle.plugins).toEqual([
      OPENCODE_SYNC_PLUGIN,
      OPENAGENT_PRESET_PLUGIN,
      "alpha-plugin@latest",
      "zeta-plugin@latest",
    ]);
    expect(Object.keys(result.bundle.models)).toEqual([
      "anthropic/claude-3.7-sonnet",
      "openai/gpt-4.1",
    ]);
    expect(result.bundle.generatedArtifacts["opencode.json"]).toEqual({
      $schema: "https://opencode.ai/config.json",
      plugin: [
        OPENCODE_SYNC_PLUGIN,
        OPENAGENT_PRESET_PLUGIN,
        "alpha-plugin@latest",
        "zeta-plugin@latest",
      ],
      provider: {
        "9router": {
          npm: "@ai-sdk/openai-compatible",
          name: "9Router",
          options: {
            baseURL: "http://localhost:20129/v1",
            apiKey: "sk_9router",
          },
          models: {
            "anthropic/claude-3.7-sonnet": {
              name: "anthropic/claude-3.7-sonnet",
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
          },
        },
      },
      model: "9router/anthropic/claude-3.7-sonnet",
    });
    expect(result.bundle.generatedArtifacts["opencode.json"]).not.toHaveProperty("models");
  });

  it("supports custom include mode without preset plugin injection", () => {
    const result = buildOpenCodeSyncBundle({
      preferences: {
        variant: "custom",
        customTemplate: "opinionated",
        modelSelectionMode: "include",
        includedModels: ["openai/gpt-4.1", "anthropic/claude-3.7-sonnet", "openai/gpt-4.1"],
        customPlugins: ["team-plugin@latest"],
      },
      modelCatalog,
    });

    expect(result.bundle.plugins).toEqual([
      OPENCODE_SYNC_PLUGIN,
      "team-plugin@latest",
    ]);
    expect(result.bundle.plugins).not.toContain(OPENAGENT_PRESET_PLUGIN);
    expect(result.bundle.plugins).not.toContain(SLIM_PRESET_PLUGIN);
    expect(Object.keys(result.bundle.models)).toEqual([
      "anthropic/claude-3.7-sonnet",
      "openai/gpt-4.1",
    ]);
    expect(result.bundle.advancedOverrides).toEqual({
      generation: {
        strategy: "assisted",
      },
      safety: {
        confirmations: true,
      },
      ui: {
        mode: "opinionated",
      },
    });
    expect(result.bundle.generatedArtifacts["opencode.json"].provider["9router"].models).toEqual({
      "anthropic/claude-3.7-sonnet": {
        name: "anthropic/claude-3.7-sonnet",
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
    });
  });

  it("generates reference-like opencode artifact shape with 9router provider wiring", () => {
    const result = buildOpenCodeSyncBundle({
      preferences: {
        variant: "openagent",
        defaultModel: "openai/gpt-4.1",
        excludedModels: ["xai/grok-3-mini"],
        mcpServers: [{ name: "docs", type: "remote", url: "https://example.test/mcp" }],
        envVars: [{ key: "OPENAI_API_KEY", value: "secret", secret: true }],
      },
      modelCatalog,
    });

    expect(result.bundle.generatedArtifacts["opencode.json"]).toEqual({
      $schema: "https://opencode.ai/config.json",
      plugin: [OPENCODE_SYNC_PLUGIN, OPENAGENT_PRESET_PLUGIN],
      provider: {
        "9router": {
          npm: "@ai-sdk/openai-compatible",
          name: "9Router",
          options: {
            baseURL: "http://localhost:20129/v1",
            apiKey: "sk_9router",
          },
          models: {
            "anthropic/claude-3.7-sonnet": {
              name: "anthropic/claude-3.7-sonnet",
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
          },
        },
      },
      model: "9router/openai/gpt-4.1",
      mcp: {
        docs: {
          type: "remote",
          url: "https://example.test/mcp",
        },
      },
      env: {
        OPENAI_API_KEY: "<set-locally>",
      },
    });
    expect(result.bundle.generatedArtifacts["opencode.json"]).not.toHaveProperty("models");
  });

  it("preserves string local MCP commands in generated artifacts", () => {
    const result = buildOpenCodeSyncBundle({
      preferences: {
        variant: "openagent",
        defaultModel: "openai/gpt-4.1",
        excludedModels: ["xai/grok-3-mini"],
        mcpServers: [{ name: "docs", type: "local", command: "npx -y @modelcontextprotocol/server-filesystem" }],
      },
      modelCatalog,
    });

    expect(result.bundle.generatedArtifacts["opencode.json"].mcp).toEqual({
      docs: {
        type: "local",
        command: "npx -y @modelcontextprotocol/server-filesystem",
      },
    });
    expect(result.publicArtifacts.opencode.mcp).toEqual({
      docs: {
        type: "local",
        command: "npx -y @modelcontextprotocol/server-filesystem",
      },
    });
  });

  it("defaults to exclude mode and resolves the remaining catalog models", () => {
    const result = buildOpenCodeSyncBundle({
      preferences: {
        variant: "openagent",
        excludedModels: ["xai/grok-3-mini"],
      },
      modelCatalog,
    });

    expect(result.bundle.modelSelectionMode).toBe("exclude");
    expect(result.bundle.models).toEqual({
      "anthropic/claude-3.7-sonnet": {
        id: "anthropic/claude-3.7-sonnet",
        label: "Claude 3.7 Sonnet",
      },
      "openai/gpt-4.1": {
        id: "openai/gpt-4.1",
        label: "GPT-4.1",
      },
    });
  });

  it("resolves include mode model metadata into the generated bundle", () => {
    const result = buildOpenCodeSyncBundle({
      preferences: {
        variant: "openagent",
        modelSelectionMode: "include",
        includedModels: ["openai/gpt-4.1", "anthropic/claude-3.7-sonnet"],
      },
      modelCatalog,
    });

    expect(result.bundle.models).toEqual({
      "anthropic/claude-3.7-sonnet": {
        id: "anthropic/claude-3.7-sonnet",
        label: "Claude 3.7 Sonnet",
      },
      "openai/gpt-4.1": {
        id: "openai/gpt-4.1",
        label: "GPT-4.1",
      },
    });
  });

  it("applies deterministic custom template presets to bundle output", () => {
    const minimal = buildOpenCodeSyncBundle({
      preferences: {
        variant: "custom",
        customTemplate: "minimal",
      },
      modelCatalog,
    });

    const opinionated = buildOpenCodeSyncBundle({
      preferences: {
        variant: "custom",
        customTemplate: "opinionated",
      },
      modelCatalog,
    });

    expect(minimal.bundle.advancedOverrides).toEqual({
      generation: {
        strategy: "manual",
      },
      ui: {
        mode: "minimal",
      },
    });
    expect(opinionated.bundle.advancedOverrides).toEqual({
      generation: {
        strategy: "assisted",
      },
      safety: {
        confirmations: true,
      },
      ui: {
        mode: "opinionated",
      },
    });
    expect(minimal.hash).toBe(opinionated.hash);
  });

  it("includes slim preset plugin and keeps bundle default model consistent", () => {
    const result = buildOpenCodeSyncBundle({
      preferences: {
        variant: "slim",
        defaultModel: "openai/gpt-4.1",
        excludedModels: ["xai/grok-3-mini"],
      },
      modelCatalog,
    });

    expect(result.bundle.plugins).toEqual([OPENCODE_SYNC_PLUGIN, SLIM_PRESET_PLUGIN]);
    expect(result.bundle.defaultModel).toBe("openai/gpt-4.1");
    expect(Object.keys(result.bundle.models)).toContain("openai/gpt-4.1");
    expect(result.bundle.generatedAdvancedConfig).toEqual({
      preset: "balanced",
      agentAssignments: {
        core: "openai/gpt-4.1",
        research: "anthropic/claude-3.7-sonnet",
        execution: "anthropic/claude-3.7-sonnet",
      },
      categoryAssignments: {
        default: "openai/gpt-4.1",
        "long-context": "openai/gpt-4.1",
        "low-latency": "anthropic/claude-3.7-sonnet",
      },
    });
    expect(result.bundle.generatedArtifacts).toEqual({
      "opencode.json": expect.any(Object),
      "oh-my-opencode-slim.json": {
        $schema: "https://unpkg.com/oh-my-opencode-slim@latest/oh-my-opencode-slim.schema.json",
        agents: {
          core: {
            model: "9router/openai/gpt-4.1",
          },
          research: {
            model: "9router/anthropic/claude-3.7-sonnet",
          },
          execution: {
            model: "9router/anthropic/claude-3.7-sonnet",
          },
        },
      },
    });
  });

  it("materializes openagent advanced config from bundle output", () => {
    const result = buildOpenCodeSyncBundle({
      preferences: {
        variant: "openagent",
        defaultModel: "openai/gpt-4.1",
        modelSelectionMode: "include",
        includedModels: ["openai/gpt-4.1", "anthropic/claude-3.7-sonnet", "xai/grok-3-mini"],
        advancedOverrides: {
          openagent: {
            lspServers: [{ language: "typescript", command: "typescript-language-server" }],
          },
        },
      },
      modelCatalog,
    });

    expect(result.bundle.generatedAdvancedConfig).toEqual({
      preset: "balanced",
      agentAssignments: {
        explorer: "anthropic/claude-3.7-sonnet",
        sisyphus: "openai/gpt-4.1",
        oracle: "openai/gpt-4.1",
        librarian: "anthropic/claude-3.7-sonnet",
        prometheus: "openai/gpt-4.1",
        atlas: "anthropic/claude-3.7-sonnet",
      },
      categoryAssignments: {
        deep: "openai/gpt-4.1",
        quick: "anthropic/claude-3.7-sonnet",
        "visual-engineering": "anthropic/claude-3.7-sonnet",
        writing: "openai/gpt-4.1",
        artistry: "xai/grok-3-mini",
      },
      lspServers: [{ language: "typescript", command: "typescript-language-server" }],
    });
    expect(result.bundle.generatedArtifacts).toEqual({
      "opencode.json": expect.any(Object),
      "oh-my-openagent.json": {
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
        lspServers: [{ language: "typescript", command: "typescript-language-server" }],
      },
    });
  });

  it("keeps custom variant advanced config internal while exposing parity-safe artifacts", () => {
    const result = buildOpenCodeSyncBundle({
      preferences: {
        variant: "custom",
        customTemplate: "minimal",
      },
      modelCatalog,
    });

    expect(result.bundle.generatedAdvancedConfig).toEqual({
      generation: {
        strategy: "manual",
      },
      ui: {
        mode: "minimal",
      },
    });
    expect(result.bundle.generatedArtifacts).toEqual({
      "opencode.json": expect.any(Object),
    });
  });

  it("derives public artifacts from the unsanitized sync contract", () => {
    const result = buildOpenCodeSyncPreview({
      preferences: {
        variant: "openagent",
        defaultModel: "openai/gpt-4.1",
        excludedModels: ["xai/grok-3-mini"],
        envVars: [{ key: "OPENAI_API_KEY", value: "super-secret", secret: true }],
      },
      modelCatalog,
    });

    expect(result.bundle.generatedArtifacts["opencode.json"].env).toEqual({
      OPENAI_API_KEY: "********",
    });
    expect(result.publicArtifacts.opencode.env).toEqual({
      OPENAI_API_KEY: "<set-locally>",
    });
    expect(result.publicArtifacts.opencode.provider["9router"].options.apiKey).toBe("sk_9router");
  });

  it("redacts secret-like advanced override values from public openagent artifacts", () => {
    const result = buildOpenCodeSyncBundle({
      preferences: {
        variant: "openagent",
        defaultModel: "openai/gpt-4.1",
        excludedModels: ["xai/grok-3-mini"],
        advancedOverrides: {
          openagent: {
            headers: {
              authorization: "Bearer super-secret-token",
            },
            nested: {
              apiKey: "super-secret-api-key",
            },
          },
        },
      },
      modelCatalog,
    });

    expect(result.bundle.generatedArtifacts["oh-my-openagent.json"]).toMatchObject({
      headers: {
        authorization: "Bearer super-secret-token",
      },
      nested: {
        apiKey: "super-secret-api-key",
      },
    });
    expect(result.publicArtifacts.ohMyOpencode).toMatchObject({
      headers: {
        authorization: "********",
      },
      nested: {
        apiKey: "********",
      },
    });
  });

  it("lets explicit custom overrides extend template preset output", () => {
    const result = buildOpenCodeSyncBundle({
      preferences: {
        variant: "custom",
        customTemplate: "minimal",
        advancedOverrides: {
          custom: {
            generation: {
              strategy: "guided",
            },
            safety: {
              confirmations: false,
            },
          },
        },
      },
      modelCatalog,
    });

    expect(result.bundle.advancedOverrides).toEqual({
      generation: {
        strategy: "guided",
      },
      safety: {
        confirmations: false,
      },
      ui: {
        mode: "minimal",
      },
    });
  });

  it("keeps explicit null advanced overrides as values instead of removal", () => {
    const result = buildOpenCodeSyncBundle({
      preferences: {
        variant: "custom",
        customTemplate: "opinionated",
        advancedOverrides: {
          custom: {
            safety: null,
            ui: {
              mode: null,
            },
          },
        },
      },
      modelCatalog,
    });

    expect(result.bundle.advancedOverrides).toEqual({
      generation: {
        strategy: "assisted",
      },
      safety: null,
      ui: {
        mode: null,
      },
    });
  });

  it("fails fast when default model is not present in selected models", () => {
    expect(() =>
      buildOpenCodeSyncBundle({
        preferences: {
          variant: "openagent",
          defaultModel: "xai/grok-3-mini",
          excludedModels: ["xai/grok-3-mini"],
        },
        modelCatalog,
      })
    ).toThrow("Default model must be included in generated bundle models");
  });

  it("fails fast for invalid normalized preference combinations", () => {
    expect(() =>
      buildOpenCodeSyncBundle({
        preferences: {
          variant: "openagent",
          customTemplate: "minimal",
        },
        modelCatalog,
      })
    ).toThrow("Custom template is only valid for custom variant");
  });

  it("keeps revision and hash stable for same effective input", () => {
    const first = buildOpenCodeSyncPreview({
      preferences: {
        variant: "openagent",
        customPlugins: ["zeta-plugin@latest", "alpha-plugin@latest"],
        excludedModels: ["xai/grok-3-mini"],
        updatedAt: "2026-04-21T12:00:00.000Z",
      },
      modelCatalog: [
        { id: "openai/gpt-4.1", label: "GPT-4.1" },
        { id: "xai/grok-3-mini", label: "Grok 3 Mini" },
        { id: "anthropic/claude-3.7-sonnet", label: "Claude 3.7 Sonnet" },
      ],
    });

    const second = buildOpenCodeSyncPreview({
      preferences: {
        variant: "openagent",
        customPlugins: ["alpha-plugin@latest", "zeta-plugin@latest"],
        excludedModels: ["xai/grok-3-mini"],
        updatedAt: "2026-04-21T13:00:00.000Z",
      },
      modelCatalog,
    });

    expect(second.revision).toBe(first.revision);
    expect(second.hash).toBe(first.hash);
    expect(second.preview).toEqual(first.preview);
  });

  it("keeps version stable when only internal metadata changes", () => {
    const first = buildOpenCodeSyncBundle({
      preferences: {
        variant: "openagent",
        excludedModels: ["xai/grok-3-mini"],
      },
      modelCatalog,
    });

    const second = buildOpenCodeSyncBundle({
      preferences: {
        variant: "openagent",
        excludedModels: ["xai/grok-3-mini"],
        updatedAt: "2026-04-21T15:30:00.000Z",
      },
      modelCatalog,
    });

    expect(second.hash).toBe(first.hash);
    expect(second.revision).toBe(first.revision);
  });

  it("allows same model slugs across providers because full ids are preserved", () => {
    const result = buildOpenCodeSyncBundle({
      preferences: {
        variant: "openagent",
        modelSelectionMode: "include",
        includedModels: ["openai/gpt-4.1", "anthropic/gpt-4.1"],
      },
      modelCatalog: {
        "openai/gpt-4.1": { id: "openai/gpt-4.1", name: "GPT-4.1 OpenAI" },
        "anthropic/gpt-4.1": { id: "anthropic/gpt-4.1", name: "GPT-4.1 Anthropic" },
      },
    });

    expect(result.bundle.generatedArtifacts["opencode.json"].provider["9router"].models).toHaveProperty("openai/gpt-4.1");
    expect(result.bundle.generatedArtifacts["opencode.json"].provider["9router"].models).toHaveProperty("anthropic/gpt-4.1");
  });

  it("keeps hash stable when public artifacts are unchanged by MCP input ordering", () => {
    const first = buildOpenCodeSyncBundle({
      preferences: {
        variant: "openagent",
        mcpServers: [
          { name: "alpha", command: "alpha" },
          { name: "beta", command: "beta" },
        ],
      },
      modelCatalog,
    });

    const second = buildOpenCodeSyncBundle({
      preferences: {
        variant: "openagent",
        mcpServers: [
          { name: "beta", command: "beta" },
          { name: "alpha", command: "alpha" },
        ],
      },
      modelCatalog,
    });

    expect(first.bundle.mcpServers).toEqual([
      { name: "alpha", command: "alpha" },
      { name: "beta", command: "beta" },
    ]);
    expect(second.bundle.mcpServers).toEqual([
      { name: "beta", command: "beta" },
      { name: "alpha", command: "alpha" },
    ]);
    expect(second.hash).toBe(first.hash);
    expect(second.revision).toBe(first.revision);
  });
});
