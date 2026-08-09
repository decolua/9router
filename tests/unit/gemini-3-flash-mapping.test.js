// Regression test: gemini/gemini-3-flash must resolve to a real upstream model id.
// Previously `gemini-3-flash` was advertised as the default (OPENAI_MODEL) and via
// antigravity, but only `gemini-3-flash-preview` exists in the gemini provider registry,
// so every request to gemini/gemini-3-flash 404'd from Google ("models/gemini-3-flash
// is not found") and the account got lock-banned for 120s each time.
import { test, describe } from "vitest";
import gemini from "../../open-sse/providers/registry/gemini.js";

describe("gemini-3-flash upstream mapping", () => {
  test("gemini-3-flash resolves to a real registered upstream model id", () => {
    const model = gemini.models.find((m) => m.id === "gemini-3-flash");
    const resolvedId = model?.upstreamModelId || model?.id;
    const exists = gemini.models.some((m) => m.id === resolvedId);
    if (!exists) {
      throw new Error(
        `gemini-3-flash resolves to "${resolvedId}" which is NOT a registered gemini model`
      );
    }
    console.log(`gemini-3-flash -> ${resolvedId} (valid: ${exists})`);
  });

  test("registry exposes gemini-3-flash", () => {
    const has = gemini.models.some((m) => m.id === "gemini-3-flash");
    if (!has) throw new Error("gemini registry missing gemini-3-flash");
  });
});
