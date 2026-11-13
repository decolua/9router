import { describe, it, expect } from "vitest";
import { TOKEN_SAVER_MODULES } from "@/shared/constants/tokenSaver.js";
import { validateTokenSaverInput, tokenSaverFromColumn, resolveTokenSaverFlags } from "@/shared/utils/tokenSaver.js";

const flags = { rtkEnabled: true, headroomEnabled: false, cavemanEnabled: true, ponytailEnabled: false };
const policy = { overrideEnabled: true, enabled: true, ...flags };

describe("per-key token saver policy", () => {
  it("inherits globals for missing or inactive overrides, regardless of saved master", () => {
    for (const value of [null, undefined, { ...policy, overrideEnabled: false, enabled: false }]) {
      expect(resolveTokenSaverFlags(flags, value)).toEqual(flags);
      const changed = { ...flags, rtkEnabled: false };
      expect(resolveTokenSaverFlags(changed, value)).toEqual(changed);
    }
  });

  it.each(Array.from({ length: 16 }, (_, n) => n))("replaces globals independently for combination %i", (n) => {
    const modules = Object.fromEntries(TOKEN_SAVER_MODULES.map(({ field }, i) => [field, Boolean(n & (1 << i))]));
    const globals = Object.fromEntries(Object.entries(modules).map(([key, value]) => [key, !value]));
    expect(resolveTokenSaverFlags(globals, { ...policy, ...modules })).toEqual(modules);
  });

  it("master OFF disables only scoped modules without mutating selections or globals", () => {
    const saved = Object.freeze({ ...policy, enabled: false });
    const globals = Object.freeze({ ...flags, customPromptEnabled: true, pxpipeEnabled: true, cavemanLevel: "ultra" });
    expect(resolveTokenSaverFlags(globals, saved)).toEqual(Object.fromEntries(TOKEN_SAVER_MODULES.map(({ field }) => [field, false])));
    expect(saved.rtkEnabled).toBe(true);
    expect(globals.customPromptEnabled).toBe(true);
    expect(resolveTokenSaverFlags(globals, { ...saved, enabled: true })).toEqual(flags);
  });

  it("accepts complete boolean policies and explicit reset", () => {
    expect(validateTokenSaverInput(policy)).toEqual({ ok: true, value: policy });
    expect(validateTokenSaverInput(null)).toEqual({ ok: true, value: null });
    expect(tokenSaverFromColumn(JSON.stringify(policy))).toEqual(policy);
  });

  it.each([undefined, [], true, "false", {}, { ...policy, enabled: "false" }, { ...policy, pxpipeEnabled: true }, { ...policy, enabled: {} }])("rejects malformed policy %j", (input) => {
    expect(validateTokenSaverInput(input).ok).toBe(false);
  });

  it.each([null, undefined, "", "{", "[]", "{}", '{"overrideEnabled":true}'])("inherits on invalid stored policy %j", (raw) => {
    expect(tokenSaverFromColumn(raw)).toBeNull();
  });
});
