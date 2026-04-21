import { describe, expect, it } from "vitest";

import {
  createDefaultOpenCodePreferences,
  normalizeOpenCodePreferences,
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
});

describe("validateOpenCodePreferences", () => {
  it("rejects invalid variant/template combinations", () => {
    expect(() =>
      validateOpenCodePreferences({ variant: "slim", customTemplate: "minimal" })
    ).toThrow(/custom template/i);
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
});
