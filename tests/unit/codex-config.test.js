import { describe, expect, it } from "vitest";

import { migrateCodexFeatureFlags } from "../../src/shared/utils/codexConfig.js";

describe("Codex config migration", () => {
  it("renames deprecated codex_hooks feature flag to hooks", () => {
    const config = {
      model: "cx/gpt-5.3-codex",
      features: {
        codex_hooks: true,
      },
    };

    migrateCodexFeatureFlags(config);

    expect(config.features).toEqual({ hooks: true });
  });

  it("keeps an existing hooks value and removes the deprecated key", () => {
    const config = {
      features: {
        codex_hooks: true,
        hooks: false,
      },
    };

    migrateCodexFeatureFlags(config);

    expect(config.features).toEqual({ hooks: false });
  });

  it("leaves configs without deprecated feature flags untouched", () => {
    const config = {
      model_provider: "9router",
      features: {
        hooks: true,
      },
    };

    const result = migrateCodexFeatureFlags(config);

    expect(result).toBe(config);
    expect(config.features).toEqual({ hooks: true });
  });
});
