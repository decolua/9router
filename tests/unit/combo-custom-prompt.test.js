import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { injectCustomPrompt } from "../../open-sse/rtk/customPrompt.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { ROLE } from "../../open-sse/translator/schema/roles.js";

let tempDir;
const originalDataDir = process.env.DATA_DIR;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-combo-prompt-"));
  process.env.DATA_DIR = tempDir;
  delete global._dbAdapter;
  vi.resetModules();
});

afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("combo custom system prompt", () => {
  it("stores, updates, and retrieves customPrompt in combo repo", async () => {
    const { createCombo, getComboByName, updateCombo, getCombos } = await import("../../src/lib/db/repos/combosRepo.js");

    const created = await createCombo({
      name: "coding-combo",
      models: ["openai/gpt-4o", "anthropic/claude-3-5-sonnet"],
      customPrompt: "  You are a senior TypeScript architect.  ",
    });

    expect(created.customPrompt).toBe("You are a senior TypeScript architect.");

    const fetched = await getComboByName("coding-combo");
    expect(fetched).not.toBeNull();
    expect(fetched.customPrompt).toBe("You are a senior TypeScript architect.");

    // Update combo custom prompt
    const updated = await updateCombo(created.id, {
      customPrompt: "Updated prompt instructions",
    });
    expect(updated.customPrompt).toBe("Updated prompt instructions");

    // Clear custom prompt to empty/null
    const cleared = await updateCombo(created.id, {
      customPrompt: "   ",
    });
    expect(cleared.customPrompt).toBeNull();
  });

  it("exports and imports combos with customPrompt", async () => {
    const { createCombo } = await import("../../src/lib/db/repos/combosRepo.js");
    const { exportDb, importDb } = await import("../../src/lib/db/index.js");

    await createCombo({
      name: "export-test-combo",
      models: ["p1/m1"],
      customPrompt: "Export prompt text",
    });

    const exported = await exportDb();
    const comboExport = exported.combos.find((c) => c.name === "export-test-combo");
    expect(comboExport).toBeDefined();
    expect(comboExport.customPrompt).toBe("Export prompt text");

    // Clean and re-import
    comboExport.name = "imported-test-combo";
    comboExport.id = "custom-id-999";
    await importDb({ combos: [comboExport] });

    const { getComboByName } = await import("../../src/lib/db/repos/combosRepo.js");
    const imported = await getComboByName("imported-test-combo");
    expect(imported).toBeDefined();
    expect(imported.customPrompt).toBe("Export prompt text");
  });

  it("resolves effective prompt correctly with combo override and default fallback", () => {
    const resolveEffectivePrompt = (comboCustomPrompt, globalSettings) => {
      const effectiveCustomPrompt = comboCustomPrompt !== null
        ? comboCustomPrompt
        : (globalSettings.customPrompt || "");
      const effectiveCustomPromptEnabled = comboCustomPrompt !== null
        ? Boolean(comboCustomPrompt && comboCustomPrompt.trim())
        : !!globalSettings.customPromptEnabled;
      return { effectiveCustomPrompt, effectiveCustomPromptEnabled };
    };

    // Scenario 1: Combo has prompt, global has none
    const res1 = resolveEffectivePrompt("Combo specific prompt", {
      customPromptEnabled: false,
      customPrompt: "",
    });
    expect(res1.effectiveCustomPromptEnabled).toBe(true);
    expect(res1.effectiveCustomPrompt).toBe("Combo specific prompt");

    // Scenario 2: Combo has prompt, global has different prompt enabled
    const res2 = resolveEffectivePrompt("Combo override", {
      customPromptEnabled: true,
      customPrompt: "Global prompt",
    });
    expect(res2.effectiveCustomPromptEnabled).toBe(true);
    expect(res2.effectiveCustomPrompt).toBe("Combo override");

    // Scenario 3: Combo prompt is null (fallback to enabled global prompt)
    const res3 = resolveEffectivePrompt(null, {
      customPromptEnabled: true,
      customPrompt: "Global prompt fallback",
    });
    expect(res3.effectiveCustomPromptEnabled).toBe(true);
    expect(res3.effectiveCustomPrompt).toBe("Global prompt fallback");

    // Scenario 4: Combo prompt is null, global is disabled
    const res4 = resolveEffectivePrompt(null, {
      customPromptEnabled: false,
      customPrompt: "",
    });
    expect(res4.effectiveCustomPromptEnabled).toBe(false);
    expect(res4.effectiveCustomPrompt).toBe("");
  });

  it("injects combo custom prompt into request body messages", () => {
    const body = {
      messages: [{ role: ROLE.USER, content: "Explain quantum computing" }],
    };
    const comboPrompt = "Be brief and technical.";

    const injected = injectCustomPrompt(body, FORMATS.OPENAI, comboPrompt);
    expect(injected).toBe(true);
    expect(body.messages[0]).toEqual({
      role: ROLE.SYSTEM,
      content: "Be brief and technical.",
    });
  });
});
