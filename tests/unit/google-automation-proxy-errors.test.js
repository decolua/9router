import { describe, expect, it, vi } from "vitest";
import { runGoogleAccountAutomation } from "../../src/lib/oauth/services/kiroGoogleAutomation.js";

describe("Google account automation proxy errors", () => {
  it("classifies invalid proxy credentials from page.goto", async () => {
    const steps = [];
    const page = {
      goto: vi.fn(async () => {
        throw new Error("page.goto: net::ERR_INVALID_AUTH_CREDENTIALS at https://www.codebuddy.ai/login?platform=CLI&state=state-1");
      }),
      waitForTimeout: vi.fn(async () => {}),
    };

    const result = await runGoogleAccountAutomation({
      page,
      authUrl: "https://www.codebuddy.ai/login?platform=CLI&state=state-1",
      email: "user@example.com",
      password: "pw",
      successPromise: new Promise(() => {}),
      serviceLabel: "CodeBuddy",
      onStep: (step, message) => steps.push({ step, message }),
    });

    expect(result).toEqual({
      status: "failed_proxy",
      step: "proxy_auth_failed",
      error: "Proxy authentication failed while opening CodeBuddy OAuth. Check the selected automation proxy username/password, proxy pool, or outbound automation proxy setting. If the password contains special characters, URL-encode them.",
    });
    expect(steps).toContainEqual({
      step: "proxy_auth_failed",
      message: "Proxy authentication failed while opening CodeBuddy OAuth",
    });
  });
});
