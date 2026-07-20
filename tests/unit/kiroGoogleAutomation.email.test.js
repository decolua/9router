import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  EMAIL_INPUT_SELECTOR,
  PASSWORD_INPUT_SELECTOR,
  runGoogleAccountAutomation,
  __test__,
} from "../../src/lib/oauth/services/kiroGoogleAutomation.js";

const { waitForFirstVisibleLocator, fillInputResilient, parseSelectorList } = __test__;

function makeMockLocator({ count = 1, visible = true, value = "" } = {}) {
  const state = { value };
  return {
    count: vi.fn(async () => count),
    isVisible: vi.fn(async () => visible),
    fill: vi.fn(async (v) => { state.value = v; }),
    type: vi.fn(async (v) => { state.value = v; }),
    click: vi.fn(async () => {}),
    inputValue: vi.fn(async () => state.value),
    first: function () { return this; },
    __state: state,
  };
}

function makeMockPage({ scopeLocators = {}, frames = [] } = {}) {
  const scope = {
    locator: vi.fn((sel) => scopeLocators[sel] || makeMockLocator({ count: 0 })),
  };
  return {
    locator: scope.locator,
    frames: () => frames,
    mainFrame: () => null,
  };
}

describe("EMAIL_INPUT_SELECTOR coverage", () => {
  it("includes the original variants (regression)", () => {
    expect(EMAIL_INPUT_SELECTOR).toContain('input[type="email"]');
    expect(EMAIL_INPUT_SELECTOR).toContain('input[autocomplete="username"]');
  });

  it("covers Google's stable identifier (input#identifierId)", () => {
    expect(EMAIL_INPUT_SELECTOR).toContain('#identifierId');
  });

  it("covers Google's mobile/legacy form (input[name='identifier'])", () => {
    expect(EMAIL_INPUT_SELECTOR).toMatch(/name="identifier"|name='identifier'/);
  });

  it("covers Google's classic 'Email' name attribute", () => {
    expect(EMAIL_INPUT_SELECTOR).toMatch(/name="Email"|name='Email'/);
  });

  it("covers aria-label variants in English and Indonesian", () => {
    expect(EMAIL_INPUT_SELECTOR).toContain('aria-label');
    const lower = EMAIL_INPUT_SELECTOR.toLowerCase();
    expect(lower).toContain('email');
  });
});

describe("PASSWORD_INPUT_SELECTOR coverage", () => {
  it("includes the original input[type='password']", () => {
    expect(PASSWORD_INPUT_SELECTOR).toContain('input[type="password"]');
  });

  it("covers Google's classic 'Passwd' name attribute", () => {
    expect(PASSWORD_INPUT_SELECTOR).toMatch(/name="Passwd"|name='Passwd'/);
  });

  it("covers aria-label variants for password fields", () => {
    expect(PASSWORD_INPUT_SELECTOR).toContain('aria-label');
  });
});

describe("Google login provider-gate selectors", () => {
  it("does not match generic Google marketing/header links", () => {
    expect(__test__.GOOGLE_LOGIN_BUTTON_SELECTORS).not.toContain('a:has-text("Google")');
    expect(__test__.GOOGLE_LOGIN_BUTTON_SELECTORS).not.toContain('button:has-text("Google")');
    expect(__test__.GOOGLE_LOGIN_BUTTON_SELECTORS).not.toContain('span:has-text("Google")');
    expect(__test__.GOOGLE_LOGIN_BUTTON_SELECTORS).not.toContain('[aria-label*="Google"]');
  });
});

describe("waitForFirstVisibleLocator", () => {
  it("returns the locator when an element is immediately visible", async () => {
    const loc = makeMockLocator({ count: 1, visible: true });
    const page = makeMockPage({ scopeLocators: { "input.x": loc } });

    const result = await waitForFirstVisibleLocator(page, "input.x", { timeout: 1000, pollInterval: 50 });
    expect(result).toBe(loc);
  });

  it("polls until an element becomes visible after delay", async () => {
    let pollCount = 0;
    const lateLocator = {
      count: vi.fn(async () => { pollCount += 1; return pollCount >= 3 ? 1 : 0; }),
      isVisible: vi.fn(async () => true),
      first: function () { return this; },
    };
    const page = makeMockPage({ scopeLocators: { "input.late": lateLocator } });

    const result = await waitForFirstVisibleLocator(page, "input.late", { timeout: 2000, pollInterval: 30 });
    expect(result).toBe(lateLocator);
    expect(pollCount).toBeGreaterThanOrEqual(3);
  });

  it("returns null when timeout exceeds before element appears", async () => {
    const neverLocator = {
      count: vi.fn(async () => 0),
      first: function () { return this; },
    };
    const page = makeMockPage({ scopeLocators: { "input.never": neverLocator } });

    const start = Date.now();
    const result = await waitForFirstVisibleLocator(page, "input.never", { timeout: 200, pollInterval: 50 });
    const elapsed = Date.now() - start;

    expect(result).toBeNull();
    expect(elapsed).toBeGreaterThanOrEqual(180);
    expect(elapsed).toBeLessThan(800);
  });

  it("returns null when count > 0 but isVisible stays false", async () => {
    const hiddenLocator = makeMockLocator({ count: 1, visible: false });
    const page = makeMockPage({ scopeLocators: { "input.hidden": hiddenLocator } });

    const result = await waitForFirstVisibleLocator(page, "input.hidden", { timeout: 200, pollInterval: 50 });
    expect(result).toBeNull();
  });
});

describe("fillInputResilient", () => {
  it("uses fill() and accepts when inputValue matches", async () => {
    const loc = makeMockLocator({ count: 1, visible: true });

    const ok = await fillInputResilient(loc, "user@example.com");
    expect(ok).toBe(true);
    expect(loc.fill).toHaveBeenCalledWith("user@example.com", expect.any(Object));
    expect(loc.type).not.toHaveBeenCalled();
  });

  it("falls back to type() when fill() did not actually set the value (React-controlled input)", async () => {
    const broken = makeMockLocator({ count: 1, visible: true });
    let typedValue = "";
    broken.fill = vi.fn(async () => { /* swallow without updating value */ });
    broken.type = vi.fn(async (v) => { typedValue = v; });
    broken.inputValue = vi.fn(async () => typedValue);

    const ok = await fillInputResilient(broken, "u@x.com");
    expect(ok).toBe(true);
    expect(broken.fill).toHaveBeenCalled();
    expect(broken.click).toHaveBeenCalled();
    expect(broken.type).toHaveBeenCalledWith("u@x.com", expect.any(Object));
    expect(typedValue).toBe("u@x.com");
  });

  it("returns false when both fill() and type() fail to set value", async () => {
    const stubborn = makeMockLocator({ count: 1, visible: true });
    stubborn.fill = vi.fn(async () => {});
    stubborn.type = vi.fn(async () => {});
    stubborn.inputValue = vi.fn(async () => "");

    const ok = await fillInputResilient(stubborn, "x@y.com");
    expect(ok).toBe(false);
  });
});

describe("parseSelectorList (regression-aid: ensures selector list is comma-joinable)", () => {
  it("splits comma-separated selectors back into individual matchers", () => {
    const list = parseSelectorList(EMAIL_INPUT_SELECTOR);
    expect(list.length).toBeGreaterThanOrEqual(5);
    expect(list).toContain('input[type="email"]');
  });
});

describe("runGoogleAccountAutomation proxy failures", () => {
  it("returns failed_proxy for Chromium tunnel failures before login handling", async () => {
    const onStep = vi.fn();
    const page = {
      goto: vi.fn(async () => {
        throw new Error("page.goto: net::ERR_TUNNEL_CONNECTION_FAILED at https://accounts.google.com/o/oauth2/v2/auth");
      }),
      waitForTimeout: vi.fn(),
    };

    const result = await runGoogleAccountAutomation({
      page,
      authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      email: "user@example.com",
      password: "secret",
      successPromise: new Promise(() => {}),
      shortTimeoutMs: 10,
      serviceLabel: "Antigravity",
      onStep,
    });

    expect(result.status).toBe("failed_proxy");
    expect(result.error).toContain("Proxy tunnel failed");
    expect(onStep).toHaveBeenCalledWith("proxy_tunnel_failed", expect.any(String));
    expect(page.waitForTimeout).not.toHaveBeenCalled();
  });
});
