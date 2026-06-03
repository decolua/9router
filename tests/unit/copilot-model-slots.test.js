import { describe, expect, it } from "vitest";
import { MITM_TOOLS } from "../../src/shared/constants/cliTools.js";

// Guards the Copilot MITM slots. Verified via live MITM passthrough capture of the
// GitHub Copilot CLI: it sends wire modelIds "gpt-5-mini" (default), "gpt-5.4-nano"
// (Auto mode, light tasks) and "claude-haiku-4.5". Without a mappable slot,
// getMappedModel (src/mitm/server.js) returns null and the /chat/completions call is
// passed through to GitHub Copilot instead of the configured provider — and since
// gpt-5-mini is the default, the primary turn leaks (same class as the Kiro "auto" bug).
describe("Copilot MITM model slots", () => {
  const copilot = MITM_TOOLS.copilot;

  it("exposes the copilot mitm tool", () => {
    expect(copilot).toBeTruthy();
    expect(copilot.configType).toBe("mitm");
    expect(Array.isArray(copilot.defaultModels)).toBe(true);
  });

  // Each modelId the Copilot CLI actually sends on the wire must have a mappable slot.
  it.each(["gpt-5-mini", "gpt-5.4-nano", "claude-haiku-4.5"])(
    "offers a mappable slot for wire modelId '%s'",
    (id) => {
      const slot = copilot.defaultModels.find((m) => m.id === id);
      expect(slot).toBeTruthy();
      expect(slot.alias).toBe(id);
    }
  );
});
