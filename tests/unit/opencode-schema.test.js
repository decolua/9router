import { describe, expect, it } from "vitest";

import {
  createDefaultOpenCodePreferences,
  normalizeOpenCodePreferences,
  sanitizeSensitiveConfig,
  sanitizeOpenCodePreferencesForResponse,
  validateOpenCodePreferences,
} from "../../src/lib/opencodeSync/schema.js";

describe("createDefaultOpenCodePreferences", () => {
  it("returns canonical defaults", () => {
    expect(createDefaultOpenCodePreferences()).toMatchObject({
      variant: "openagent",
      customTemplate: null,
      modelSelectionMode: "exclude",
      includedModels: [],
      excludedModels: [],
      customPlugins: [],
      mcpServers: [],
      envVars: [],
    });
  });
});

describe("normalizeOpenCodePreferences", () => {
  it("fills defaults for a new user", () => {
    const prefs = normalizeOpenCodePreferences(undefined);

    expect(prefs.variant).toBe("openagent");
    expect(prefs.customTemplate).toBeNull();
    expect(prefs.modelSelectionMode).toBe("exclude");
    expect(prefs.includedModels).toEqual([]);
    expect(prefs.excludedModels).toEqual([]);
    expect(prefs.customPlugins).toEqual([]);
    expect(prefs.mcpServers).toEqual([]);
    expect(prefs.envVars).toEqual([]);
  });

  it("defaults missing model selection mode to exclude for persisted records", () => {
    const prefs = normalizeOpenCodePreferences({
      includedModels: ["openai/gpt-4.1-free"],
    });

    expect(prefs.modelSelectionMode).toBe("exclude");
    expect(prefs.includedModels).toEqual(["openai/gpt-4.1-free"]);
  });

  it("drops duplicate plugin and env-var keys deterministically", () => {
    const prefs = normalizeOpenCodePreferences({
      customPlugins: ["foo@latest", "foo@latest", "bar@latest"],
      envVars: [
        { key: "OPENAI_API_KEY", value: "a", secret: true },
        { key: "OPENAI_API_KEY", value: "b", secret: true },
      ],
    });

    expect(prefs.customPlugins).toEqual(["foo@latest", "bar@latest"]);
    expect(prefs.envVars).toEqual([
      { key: "OPENAI_API_KEY", value: "b", secret: true },
    ]);
  });

  it("normalizes MCP server command arrays and trims remote URLs", () => {
    const prefs = normalizeOpenCodePreferences({
      mcpServers: [
        { name: " Filesystem ", type: "local", command: [" npx ", " ", "@scope/server-fs "] },
        { name: "Remote", type: "remote", url: " https://example.test/mcp  " },
      ],
    });

    expect(prefs.mcpServers).toEqual([
      { name: "Filesystem", type: "local", command: ["npx", "@scope/server-fs"] },
      { name: "Remote", type: "remote", url: "https://example.test/mcp" },
    ]);
  });
});

describe("validateOpenCodePreferences", () => {
  it("rejects invalid variant/template combinations", () => {
    expect(() =>
      validateOpenCodePreferences({ variant: "slim", customTemplate: "minimal" })
    ).toThrow(/custom template/i);
  });

  it("rejects duplicate MCP names and invalid server shapes", () => {
    expect(() =>
      validateOpenCodePreferences({
        mcpServers: [
          { name: "Filesystem", type: "local", command: "npx" },
          { name: " filesystem ", type: "remote", url: "https://example.test/mcp" },
        ],
      })
    ).toThrow(/duplicate mcp server name/i);

    expect(() =>
      validateOpenCodePreferences({
        mcpServers: [{ name: "Remote", type: "remote", url: "ftp://example.test/mcp" }],
      })
    ).toThrow(/invalid mcp server url/i);

    expect(() =>
      validateOpenCodePreferences({
        mcpServers: [{ name: "Local", type: "local", command: [] }],
      })
    ).toThrow(/requires a command/i);
  });
});

describe("sanitizeOpenCodePreferencesForResponse", () => {
  it("masks secret env var values", () => {
    expect(
      sanitizeOpenCodePreferencesForResponse({
        envVars: [
          { key: "OPENAI_API_KEY", value: "secret", secret: true },
          { key: "DEBUG", value: "1", secret: false },
        ],
      }).envVars
    ).toEqual([
      { key: "DEBUG", value: "1", secret: false },
      { key: "OPENAI_API_KEY", value: "********", secret: true },
    ]);
  });

  it("redacts nested sensitive fields beyond env vars", () => {
    const sanitized = sanitizeOpenCodePreferencesForResponse({
      envVars: [{ key: "OPENAI_API_KEY", value: "secret", secret: true }],
      advancedOverrides: {
        custom: {
          headers: {
            Authorization: "Bearer raw-token",
          },
        },
      },
    });

    expect(sanitized.advancedOverrides.custom.headers.Authorization).toBe("********");
    expect(sanitized.envVars[0].value).toBe("********");
  });
});

describe("sanitizeSensitiveConfig", () => {
  it("redacts secret-like keys recursively", () => {
    expect(
      sanitizeSensitiveConfig({
        apiKey: "top-secret",
        nested: {
          accessToken: "abc",
          safe: "ok",
        },
        entries: [{ secret: true, value: "hidden" }],
      })
    ).toEqual({
      apiKey: "********",
      nested: {
        accessToken: "********",
        safe: "ok",
      },
      entries: [{ secret: true, value: "********" }],
    });
  });

  it("preserves non-secret token count fields", () => {
    expect(
      sanitizeSensitiveConfig({
        maxTokens: 2048,
        tokenLimit: 4096,
        tokenizer: "cl100k",
      })
    ).toEqual({
      maxTokens: 2048,
      tokenLimit: 4096,
      tokenizer: "cl100k",
    });
  });
});
