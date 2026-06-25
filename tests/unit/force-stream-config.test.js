// Guards forceStream moved from chatCore hardcode → PROVIDERS schema (#5).
import { describe, it, expect } from "vitest";

const FORCED = ["openai", "codex", "commandcode"];

describe("forceStream provider config", () => {
  it("only openai/codex/commandcode force streaming", async () => {
    const { PROVIDERS } = await import("../../open-sse/config/providers.js");
    for (const id of FORCED) {
      expect(PROVIDERS[id]?.forceStream, `${id} forced`).toBe(true);
    }
    // a sample of others must NOT force
    for (const id of ["deepseek", "claude", "gemini", "openrouter"]) {
      expect(PROVIDERS[id]?.forceStream, `${id} not forced`).not.toBe(true);
    }
  });
});
