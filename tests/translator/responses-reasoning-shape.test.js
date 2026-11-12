import { describe, expect, it } from "vitest";
import { translateRequest } from "../../open-sse/translator/index.js";

describe("Responses reasoning wire format", () => {
  for (const source of ["openai", "openai-responses"]) {
    it(`uses reasoning.effort for ${source} requests to compatible Responses endpoints`, () => {
      const body = source === "openai"
        ? { messages: [{ role: "user", content: "Hello" }], reasoning_effort: "high" }
        : { input: [{ role: "user", content: "Hello" }], reasoning: { effort: "high" } };
      const translated = translateRequest(source, "openai-responses", "muse-spark-1.3", body, true, null, "openai-compatible-custom");
      expect(translated.reasoning).toMatchObject({ effort: "high" });
      expect(translated).not.toHaveProperty("reasoning_effort");
    });
  }
});
