import { describe, it, expect } from "vitest";

import { PROVIDERS } from "../../open-sse/config/providers.js";
import { PROVIDER_MODELS } from "../../open-sse/config/providerModels.js";
import { hasSpecializedExecutor, getExecutor } from "../../open-sse/executors/index.js";
import { resolveProviderAlias } from "../../open-sse/services/model.js";

describe("Freebuff provider registration", () => {
  it("registers provider config, fb alias, models, and specialized executor", () => {
    expect(PROVIDERS.freebuff.baseUrl).toBe("https://www.codebuff.com/api/v1/chat/completions");
    expect(PROVIDERS.freebuff.format).toBe("openai");
    expect(PROVIDER_MODELS.fb.map((m) => m.id)).toEqual([
      "deepseek/deepseek-v4-pro",
      "moonshotai/kimi-k2.6",
      "deepseek/deepseek-v4-flash",
      "minimax/minimax-m2.7",
    ]);
    expect(resolveProviderAlias("fb")).toBe("freebuff");
    expect(hasSpecializedExecutor("freebuff")).toBe(true);
    expect(hasSpecializedExecutor("fb")).toBe(true);
    expect(getExecutor("freebuff").provider).toBe("freebuff");
  });
});
