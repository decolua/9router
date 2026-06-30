import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The Claude auto-mode classifier compat toggle controls how 9router
 * TRANSLATES the response from the upstream combo. It must NOT
 * override the model chosen by the user's combo (auto-xhigh,
 * auto-high, auto-medium) — those combos are the user's chosen way to
 * reach a Claude-class upstream and expanding them is handled by
 * `getComboModels`. Re-introducing a hard-coded model override would
 * force-route every classifier through one model, which is the wrong
 * default for users on different combos.
 */
describe("chat.js does not override the user-chosen auto combo model", () => {
  const src = readFileSync(
    join(process.cwd(), "..", "src/sse/handlers/chat.js"),
    "utf8",
  );

  it("keeps modelStr as the original body.model field", () => {
    const assignment = src.match(/const modelStr = body\.model;/);
    expect(assignment).toBeTruthy();
  });

  it("does not hard-code a specific model for classifier routing", () => {
    expect(src).not.toMatch(/modelStr\s*=\s*["']cx\/gpt-5\.4["']/);
    expect(src).not.toMatch(/modelStr\s*=\s*["']cx\/gpt-5\.4-high["']/);
    expect(src).not.toMatch(/modelStr\s*=\s*["']cc\/claude/);
  });
});
