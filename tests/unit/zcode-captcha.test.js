import { describe, expect, it, vi } from "vitest";
import { CaptchaManager } from "../../src/lib/zcode/captcha-manager.js";
import { isCaptchaError } from "../../src/lib/zcode/captcha-service.js";

describe("ZCode captcha handling", () => {
  it.each([3007, 3012])("recognizes ZCode risk-control code %s", async (code) => {
    const response = new Response(JSON.stringify({ code, msg: "request has been blocked due to unusual activity" }), { status: 405 });
    await expect(isCaptchaError(response)).resolves.toBe(true);
  });

  it("caches and invalidates verification parameters", () => {
    vi.useFakeTimers();
    const manager = new CaptchaManager();
    manager.submit("verify-param");
    expect(manager.cachedVerifyParam).toBe("verify-param");
    manager.invalidate();
    expect(manager.cachedVerifyParam).toBeNull();
    vi.useRealTimers();
  });

  it("resolves a captured pending verification", async () => {
    const manager = new CaptchaManager();
    manager.openPage = vi.fn(async () => {});
    const pending = manager.getVerifyParam();
    manager.submit("verify-param");
    await expect(pending).resolves.toBe("verify-param");
    expect(manager.pending).toBeNull();
  });
});