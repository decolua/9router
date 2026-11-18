import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("ZCode browser runtime", () => {
  it("uses a dedicated persistent CloakBrowser context", () => {
    const source = readFileSync(new URL("../../src/lib/zcode/browser.js", import.meta.url), "utf8");
    expect(source).toContain('loadRuntimeDep("cloakbrowser")');
    expect(source).toContain("launchPersistentContext");
    expect(source).toContain("userDataDir: PROFILE_DIR");
  });

  it("bridges captcha completion directly into the server process", () => {
    const manager = readFileSync(new URL("../../src/lib/zcode/captcha-manager.js", import.meta.url), "utf8");
    const page = readFileSync(new URL("../../public/zcode/captcha.html", import.meta.url), "utf8");
    expect(manager).toContain('exposeFunction("__zcodePost"');
    expect(page).toContain('window.__zcodePost');
  });
});