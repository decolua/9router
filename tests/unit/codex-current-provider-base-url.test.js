import { describe, expect, it } from "vitest";
import { getCurrentCodexProviderBaseUrl } from "../../src/app/(dashboard)/dashboard/cli-tools/components/codexConfig.js";

describe("Codex current provider base URL", () => {
  it("uses the base URL from the configured model provider, not an earlier provider", () => {
    const config = `model = "gpt-5"
model_provider = "9router"

[model_providers.omniroute]
base_url = "https://omniroute.example/v1"

[model_providers.9router]
base_url = "http://127.0.0.1:20128/v1"
`;

    expect(getCurrentCodexProviderBaseUrl(config)).toBe("http://127.0.0.1:20128/v1");
  });
});
