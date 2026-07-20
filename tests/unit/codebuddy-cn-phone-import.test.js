import { describe, expect, it, vi } from "vitest";
import { FiveSimClient } from "../../src/lib/oauth/services/fiveSimClient.js";
import {
  CodeBuddyCnPhoneImportManager,
  generateCodeBuddyCnKeyName,
} from "../../src/lib/oauth/services/codebuddyCnPhoneImportManager.js";
import {
  createCodeBuddyCnApiKey,
  runCodeBuddyCnPhoneLogin,
} from "../../src/lib/oauth/services/codebuddyCnPhoneAutomation.js";
import { __test__ as kiroBulkImportTest } from "../../src/lib/oauth/services/kiroBulkImportManager.js";

describe("FiveSimClient", () => {
  it("buys a CodeBuddy Hong Kong activation number with bearer auth", async () => {
    const calls = [];
    const client = new FiveSimClient({
      token: "five-token",
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        if (url.includes("/guest/prices")) {
          return {
            ok: true,
            status: 200,
            async text() {
              return JSON.stringify({
                hongkong: {
                  codebuddy: {
                    virtual54: { cost: 0.13, count: 1 },
                  },
                },
              });
            },
          };
        }
        if (url.includes("/user/profile")) {
          return {
            ok: true,
            status: 200,
            async text() {
              return JSON.stringify({ balance: 100 });
            },
          };
        }
        return {
          ok: true,
          status: 200,
          async text() {
            return JSON.stringify({ id: 42, phone: "+85251234567", product: "codebuddy" });
          },
        };
      },
    });

    const order = await client.buyActivation({
      country: "hongkong",
      operator: "any",
      product: "codebuddy",
    });

    expect(order.id).toBe(42);
    expect(calls[2].url).toBe("https://5sim.net/v1/user/buy/activation/hongkong/virtual54/codebuddy");
    expect(calls[2].init.headers.Authorization).toBe("Bearer five-token");
    expect(calls[2].init.headers.Accept).toBe("application/json");
  });

  it("sends 5sim API requests through the configured HTTP proxy", async () => {
    const calls = [];
    const client = new FiveSimClient({
      token: "five-token",
      proxyUrl: "http://proxy.local:8080",
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return {
          ok: true,
          status: 200,
          async text() {
            return JSON.stringify({ balance: 100 });
          },
        };
      },
    });

    await client.getProfile();

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://5sim.net/v1/user/profile");
    expect(calls[0].init.dispatcher).toBeTruthy();
    expect(calls[0].init.headers.Authorization).toBe("Bearer five-token");
  });

  it("sends 5sim API requests through the configured SOCKS proxy", async () => {
    const calls = [];
    const client = new FiveSimClient({
      token: "five-token",
      proxyUrl: "socks5://user:pa;ss,word@134.209.102.0:10000",
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return {
          ok: true,
          status: 200,
          async text() {
            return JSON.stringify({ balance: 100 });
          },
        };
      },
    });

    await client.getProfile();

    expect(calls).toHaveLength(1);
    expect(calls[0].init.dispatcher).toBeTruthy();
  });

  it("retries transient 5sim profile gateway errors before failing readiness", async () => {
    const calls = [];
    const waits = [];
    const client = new FiveSimClient({
      token: "five-token",
      waitImpl: async (ms) => waits.push(ms),
      fetchImpl: async (url) => {
        calls.push(url);
        if (calls.length === 1) {
          return {
            ok: false,
            status: 444,
            async text() {
              return "502 Bad Gateway";
            },
          };
        }
        return {
          ok: true,
          status: 200,
          async text() {
            return JSON.stringify({ balance: 0.74 });
          },
        };
      },
    });

    const profile = await client.getProfile();

    expect(profile.balance).toBe(0.74);
    expect(calls).toEqual([
      "https://5sim.net/v1/user/profile",
      "https://5sim.net/v1/user/profile",
    ]);
    expect(waits).toEqual([250]);
  });

  it("quotes CodeBuddy account capacity from 5sim balance and live prices", async () => {
    const calls = [];
    const client = new FiveSimClient({
      token: "five-token",
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        if (url.includes("/user/profile")) {
          return {
            ok: true,
            status: 200,
            async text() {
              return JSON.stringify({ balance: 0.74 });
            },
          };
        }
        return {
          ok: true,
          status: 200,
          async text() {
            return JSON.stringify({
              hongkong: {
                codebuddy: {
                  expensive: { cost: 0.25, count: 30 },
                  virtual54: { cost: 0.13, count: 153319 },
                },
              },
            });
          },
        };
      },
    });

    const quote = await client.getActivationQuote({
      country: "hongkong",
      operator: "any",
      product: "codebuddy",
    });

    expect(calls.map((call) => call.url)).toEqual([
      "https://5sim.net/v1/user/profile",
      "https://5sim.net/v1/guest/prices?country=hongkong&product=codebuddy",
    ]);
    expect(quote.balance).toBe(0.74);
    expect(quote.unitCost).toBe(0.13);
    expect(quote.purchasableByBalance).toBe(5);
    expect(quote.availableCount).toBe(153319);
    expect(quote.capacity).toBe(5);
    expect(quote.selectedOffer.operator).toBe("virtual54");
  });

  it("resolves any operator from 5sim prices before buying CodeBuddy numbers", async () => {
    const calls = [];
    const client = new FiveSimClient({
      token: "five-token",
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        if (url.includes("/guest/prices")) {
          return {
            ok: true,
            status: 200,
            async text() {
              return JSON.stringify({
                hongkong: {
                  codebuddy: {
                    virtual54: { cost: 0.13, count: 153319 },
                  },
                },
              });
            },
          };
        }
        if (url.includes("/user/profile")) {
          return {
            ok: true,
            status: 200,
            async text() {
              return JSON.stringify({ balance: 100 });
            },
          };
        }
        return {
          ok: true,
          status: 200,
          async text() {
            return JSON.stringify({ id: 42, phone: "+85251234567", product: "codebuddy", operator: "virtual54" });
          },
        };
      },
    });

    const order = await client.buyActivation({
      country: "hongkong",
      operator: "any",
      product: "codebuddy",
    });

    expect(calls[0].url).toBe("https://5sim.net/v1/guest/prices?country=hongkong&product=codebuddy");
    expect(calls[0].init.headers.Authorization).toBeUndefined();
    expect(calls[1].url).toBe("https://5sim.net/v1/user/profile");
    expect(calls[1].init.headers.Authorization).toBe("Bearer five-token");
    expect(calls[2].url).toBe("https://5sim.net/v1/user/buy/activation/hongkong/virtual54/codebuddy");
    expect(calls[2].init.headers.Authorization).toBe("Bearer five-token");
    expect(order.operator).toBe("virtual54");
  });

  it("tries the next available 5sim operator when the first buy hits a gateway error", async () => {
    const calls = [];
    const client = new FiveSimClient({
      token: "five-token",
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        if (url.includes("/guest/prices")) {
          return {
            ok: true,
            status: 200,
            async text() {
              return JSON.stringify({
                hongkong: {
                  codebuddy: {
                    firstop: { cost: 0.1, count: 10 },
                    secondop: { cost: 0.2, count: 20 },
                  },
                },
              });
            },
          };
        }
        if (url.includes("/user/profile")) {
          return {
            ok: true,
            status: 200,
            async text() {
              return JSON.stringify({ balance: 100 });
            },
          };
        }
        if (url.includes("/firstop/")) {
          return {
            ok: false,
            status: 502,
            async text() {
              return "Bad Gateway";
            },
          };
        }
        return {
          ok: true,
          status: 200,
          async text() {
            return JSON.stringify({ id: 43, phone: "+85257654321", product: "codebuddy", operator: "secondop" });
          },
        };
      },
    });

    const order = await client.buyActivation({
      country: "hongkong",
      operator: "any",
      product: "codebuddy",
    });

    expect(calls.map((call) => call.url)).toContain("https://5sim.net/v1/user/buy/activation/hongkong/firstop/codebuddy");
    expect(calls.map((call) => call.url)).toContain("https://5sim.net/v1/user/buy/activation/hongkong/secondop/codebuddy");
    expect(order.operator).toBe("secondop");
  });

  it("retries transient guest price failures before selecting an available operator", async () => {
    const calls = [];
    let priceAttempts = 0;
    const client = new FiveSimClient({
      token: "five-token",
      waitImpl: async () => {},
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        if (url.includes("/guest/prices")) {
          priceAttempts += 1;
          if (priceAttempts < 3) {
            return {
              ok: false,
              status: 444,
              async text() {
                return "502 Bad Gateway";
              },
            };
          }
          return {
            ok: true,
            status: 200,
            async text() {
              return JSON.stringify({ hongkong: { codebuddy: { virtual54: { cost: 0.13, count: 10 } } } });
            },
          };
        }
        if (url.includes("/user/profile")) {
          return {
            ok: true,
            status: 200,
            async text() {
              return JSON.stringify({ balance: 100 });
            },
          };
        }
        return {
          ok: true,
          status: 200,
          async text() {
            return JSON.stringify({ id: 44, phone: "+85250000000", operator: "virtual54" });
          },
        };
      },
    });

    const order = await client.buyActivation({ country: "hongkong", operator: "any", product: "codebuddy" });

    expect(priceAttempts).toBe(3);
    expect(calls.at(-1).url).toContain("/hongkong/virtual54/codebuddy");
    expect(order.id).toBe(44);
  });

  it("falls back to one authenticated buy when guest price discovery stays unavailable", async () => {
    const calls = [];
    const client = new FiveSimClient({
      token: "five-token",
      waitImpl: async () => {},
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        if (url.includes("/guest/prices")) {
          return {
            ok: false,
            status: 444,
            async text() {
              return "502 Bad Gateway";
            },
          };
        }
        if (url.includes("/user/profile")) {
          return {
            ok: true,
            status: 200,
            async text() {
              return JSON.stringify({ balance: 100 });
            },
          };
        }
        return {
          ok: true,
          status: 200,
          async text() {
            return JSON.stringify({ id: 45, phone: "+85251111111", operator: "virtual54" });
          },
        };
      },
    });

    const order = await client.buyActivation({ country: "hongkong", operator: "any", product: "codebuddy" });

    expect(calls.filter((call) => call.url.includes("/guest/prices"))).toHaveLength(3);
    expect(calls.at(-1).url).toContain("/user/buy/activation/hongkong/any/codebuddy");
    expect(order.id).toBe(45);
  });

  it("stops before buying when 5sim has no available CodeBuddy stock", async () => {
    const calls = [];
    const client = new FiveSimClient({
      token: "five-token",
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return {
          ok: true,
          status: 200,
          async text() {
            return JSON.stringify({ hongkong: { codebuddy: { virtual54: { cost: 0.13, count: 0 } } } });
          },
        };
      },
    });

    await expect(client.buyActivation({
      country: "hongkong",
      operator: "any",
      product: "codebuddy",
    })).rejects.toThrow("No available 5sim phone numbers for codebuddy in hongkong using any operator");

    expect(calls).toHaveLength(1);
  });

  it("stops before buying when 5sim balance is too low", async () => {
    const calls = [];
    const client = new FiveSimClient({
      token: "five-token",
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        if (url.includes("/guest/prices")) {
          return {
            ok: true,
            status: 200,
            async text() {
              return JSON.stringify({ hongkong: { codebuddy: { virtual54: { cost: 0.13, count: 10 } } } });
            },
          };
        }
        return {
          ok: true,
          status: 200,
          async text() {
            return JSON.stringify({ balance: 0.01 });
          },
        };
      },
    });

    await expect(client.buyActivation({
      country: "hongkong",
      operator: "any",
      product: "codebuddy",
    })).rejects.toThrow("5sim balance 0.01 is lower than 0.13 required for codebuddy in hongkong (virtual54)");

    expect(calls).toHaveLength(2);
  });

  it("extracts OTP code from activation order checks", async () => {
    const client = new FiveSimClient({
      token: "five-token",
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        async json() {
          return {
            id: 42,
            sms: [{ code: "864209", text: "CodeBuddy code 864209" }],
          };
        },
      }),
    });

    const result = await client.checkOrder(42);

    expect(result.code).toBe("864209");
  });

  it("retries transient 5sim check gateway errors five times before the next poll", async () => {
    const calls = [];
    const client = new FiveSimClient({
      token: "five-token",
      waitImpl: vi.fn(async () => {}),
      fetchImpl: async (url) => {
        calls.push(url);
        if (calls.length <= 5) {
          return {
            ok: false,
            status: 444,
            async text() {
              return "502 Bad Gateway";
            },
          };
        }
        return {
          ok: true,
          status: 200,
          async text() {
            return JSON.stringify({
              id: 42,
              sms: [{ code: "864209", text: "CodeBuddy code 864209" }],
            });
          },
        };
      },
    });

    const result = await client.waitForCode(42, { timeoutMs: 10_000, pollIntervalMs: 1 });

    expect(result.code).toBe("864209");
    expect(calls).toHaveLength(6);
  });
});

describe("CodeBuddy CN phone import", () => {
  it("enters the direct CodeBuddy CN phone login flow without iframe", async () => {
    const actions = [];
    const visibleSelectors = {
      page: new Set([
        "text=手机号",
        "input[type='checkbox']",
        ".kc-country-selector",
        ".kc-country-option:has-text('+852')",
        "#phoneNumber",
        "input[type='button']",
        "#code",
        "#kc-login",
      ]),
    };
    const makeScope = (name) => ({
      locator(selector) {
        const visible = visibleSelectors[name].has(selector);
        return {
          first() { return this; },
          async isVisible() { return visible; },
          async click() { actions.push({ type: "click", scope: name, selector }); },
          async check() { actions.push({ type: "check", scope: name, selector }); },
          async fill(value) { actions.push({ type: "fill", scope: name, selector, value }); },
        };
      },
    });
    const page = {
      ...makeScope("page"),
      async goto(url) { actions.push({ type: "goto", url }); },
      async waitForLoadState() {},
      async waitForTimeout() {},
      async waitForFunction() { return true; },
    };

    const result = await runCodeBuddyCnPhoneLogin({
      page,
      phone: "+85251234567",
      codeProvider: async () => ({ code: "654321" }),
    });

    expect(result.phone).toBe("+85251234567");
    expect(actions).toContainEqual({
      type: "goto",
      url: "https://www.codebuddy.cn/login/?platform=admin&state=0",
    });
    expect(actions).toContainEqual({ type: "check", scope: "page", selector: "input[type='checkbox']" });
    expect(actions).toContainEqual({ type: "click", scope: "page", selector: ".kc-country-option:has-text('+852')" });
    expect(actions).toContainEqual({ type: "fill", scope: "page", selector: "#phoneNumber", value: "51234567" });
    expect(actions).toContainEqual({ type: "fill", scope: "page", selector: "#code", value: "654321" });
  });

  it("fills a Chinese phone login form when the phone field is in the outer dialog frame", async () => {
    const actions = [];
    const visibleSelectors = {
      page: new Set(["button.btn-login"]),
      outer: new Set([
        "text=手机号",
        "input[type='checkbox']",
        "input[placeholder*='手机号码']",
        "button:has-text('获取验证码')",
        "input[placeholder*='验证码']",
        "button:has-text('登录')",
      ]),
      empty: new Set(),
    };
    const makeScope = (name) => ({
      locator(selector) {
        const visible = visibleSelectors[name].has(selector);
        return {
          first() { return this; },
          async isVisible() { return visible; },
          async click() { actions.push({ type: "click", scope: name, selector }); },
          async check() { actions.push({ type: "check", scope: name, selector }); },
          async fill(value) { actions.push({ type: "fill", scope: name, selector, value }); },
        };
      },
    });
    const emptyScope = makeScope("empty");
    const outerScope = {
      ...makeScope("outer"),
      frameLocator(selector) {
        actions.push({ type: "frame", scope: "outer", selector });
        return emptyScope;
      },
    };
    const page = {
      ...makeScope("page"),
      async goto(url) { actions.push({ type: "goto", url }); },
      async waitForTimeout() {},
      async waitForFunction() { return true; },
      frameLocator(selector) {
        actions.push({ type: "frame", scope: "page", selector });
        return outerScope;
      },
    };

    const result = await runCodeBuddyCnPhoneLogin({
      page,
      phone: "+85251234567",
      codeProvider: async () => ({ code: "654321" }),
    });

    expect(result.phone).toBe("+85251234567");
    expect(actions).toContainEqual({
      type: "fill",
      scope: "outer",
      selector: "input[placeholder*='手机号码']",
      value: "+85251234567",
    });
    expect(actions).toContainEqual({
      type: "fill",
      scope: "outer",
      selector: "input[placeholder*='验证码']",
      value: "654321",
    });
  });

  it("continues when the CodeBuddy login dialog already shows the phone form without a method tab", async () => {
    const actions = [];
    const visibleSelectors = {
      page: new Set(["button.btn-login"]),
      outer: new Set([
        "input[type='checkbox']",
        "input[placeholder*='手机号码']",
        "button:has-text('获取验证码')",
        "input[placeholder*='验证码']",
        "button:has-text('登录')",
      ]),
      empty: new Set(),
    };
    const makeScope = (name) => ({
      locator(selector) {
        const visible = visibleSelectors[name].has(selector);
        return {
          first() { return this; },
          async isVisible() { return visible; },
          async click() { actions.push({ type: "click", scope: name, selector }); },
          async check() { actions.push({ type: "check", scope: name, selector }); },
          async fill(value) { actions.push({ type: "fill", scope: name, selector, value }); },
        };
      },
    });
    const emptyScope = makeScope("empty");
    const outerScope = {
      ...makeScope("outer"),
      frameLocator(selector) {
        actions.push({ type: "frame", scope: "outer", selector });
        return emptyScope;
      },
    };
    const page = {
      ...makeScope("page"),
      async goto(url) { actions.push({ type: "goto", url }); },
      async waitForTimeout() {},
      async waitForFunction() { return true; },
      frameLocator(selector) {
        actions.push({ type: "frame", scope: "page", selector });
        return outerScope;
      },
    };

    const result = await runCodeBuddyCnPhoneLogin({
      page,
      phone: "+85253751581",
      codeProvider: async () => ({ code: "654321" }),
    });

    expect(result.phone).toBe("+85253751581");
    expect(actions).not.toContainEqual({ type: "click", scope: "outer", selector: "div.cursor-pointer" });
    expect(actions).toContainEqual({
      type: "fill",
      scope: "outer",
      selector: "input[placeholder*='手机号码']",
      value: "+85253751581",
    });
  });

  it("generates natural CN-style key names instead of router automation tags", () => {
    const names = Array.from({ length: 20 }, () => generateCodeBuddyCnKeyName());

    expect(names.every((name) => /^[a-z]+-[a-z]+-[0-9]{4}$/.test(name))).toBe(true);
    expect(names.some((name) => name.includes("china") || name.includes("hoshi"))).toBe(true);
    expect(names.every((name) => !/router|automation|9router/i.test(name))).toBe(true);
  });

  it("saves a generated CodeBuddy CN API key connection", async () => {
    const saved = [];
    const fiveSimFactoryOptions = [];
    const manager = new CodeBuddyCnPhoneImportManager({
      browserLauncher: async () => ({
        async newContext() {
          return {
            async newPage() {
              return {};
            },
            async close() {},
          };
        },
        async close() {},
      }),
      fiveSimClientFactory: (options) => {
        fiveSimFactoryOptions.push(options);
        return {
          buyActivation: vi.fn(async () => ({ id: 7, phone: "+85251234567" })),
          waitForCode: vi.fn(async () => ({ code: "123456" })),
          finishOrder: vi.fn(async () => ({ ok: true })),
          cancelOrder: vi.fn(async () => ({ ok: true })),
        };
      },
      phoneLoginFn: vi.fn(async () => ({
        phone: "+85251234567",
        webEmail: "phone:+85251234567",
      })),
      createApiKeyFn: vi.fn(async () => ({
        key: "ck_cn_generated",
        id: "key-id-1",
        name: "china-hoshi-1234",
        expiresAt: "2027-01-01T00:00:00.000Z",
      })),
      saveConnection: async ({ apiKey, keyMeta, label, phone }) => {
        saved.push({ apiKey, keyMeta, label, phone });
        return { connection: { id: "conn-cn-1" } };
      },
    });

    const started = await manager.startJob({
      fiveSimToken: "five-token",
      count: 1,
      concurrency: 1,
      proxyUrl: "http://worker-proxy.local:8080",
    });

    await new Promise((resolve, reject) => {
      const startedAt = Date.now();
      const tick = () => {
        const job = manager.getJob(started.jobId);
        if (job?.status === "completed") return resolve(job);
        if (Date.now() - startedAt > 3000) return reject(new Error("Timed out"));
        setTimeout(tick, 20);
      };
      tick();
    });

    expect(saved).toHaveLength(1);
    expect(saved[0].apiKey).toBe("ck_cn_generated");
    expect(saved[0].keyMeta.name).toBe("china-hoshi-1234");
    expect(saved[0].phone).toBe("+85251234567");
    expect(fiveSimFactoryOptions).toContainEqual({
      token: "five-token",
      proxyUrl: "http://worker-proxy.local:8080",
    });
  });

  it("retries with a fresh 5sim number when the first OTP does not arrive", async () => {
    const saved = [];
    const pages = [];
    const context = {
      async newPage() {
        const page = { id: `page-${pages.length + 1}`, close: vi.fn(async () => {}) };
        pages.push(page);
        return page;
      },
      async close() {},
    };
    const buyActivation = vi.fn()
      .mockResolvedValueOnce({ id: 7, phone: "+85251111111" })
      .mockResolvedValueOnce({ id: 8, phone: "+85252222222" });
    const waitForCode = vi.fn()
      .mockRejectedValueOnce(new Error("Timed out waiting for 5sim OTP code"))
      .mockResolvedValueOnce({ code: "123456" });
    const cancelOrder = vi.fn(async () => ({ ok: true }));
    const finishOrder = vi.fn(async () => ({ ok: true }));
    const phoneLoginFn = vi.fn(async ({ phone, codeProvider }) => {
      await codeProvider();
      return { phone, webEmail: `phone:${phone}` };
    });
    const manager = new CodeBuddyCnPhoneImportManager({
      browserLauncher: async () => ({
        async newContext() {
          return context;
        },
        async close() {},
      }),
      fiveSimClientFactory: () => ({
        buyActivation,
        waitForCode,
        finishOrder,
        cancelOrder,
      }),
      phoneLoginFn,
      createApiKeyFn: vi.fn(async () => ({
        key: "ck_cn_generated",
        id: "key-id-1",
        name: "china-hoshi-5678",
      })),
      saveConnection: async ({ apiKey, phone }) => {
        saved.push({ apiKey, phone });
        return { connection: { id: "conn-cn-1" } };
      },
    });

    const started = await manager.startJob({
      fiveSimToken: "five-token",
      count: 1,
      concurrency: 1,
    });

    const finished = await new Promise((resolve, reject) => {
      const startedAt = Date.now();
      const tick = () => {
        const job = manager.getJob(started.jobId);
        if (job && ["completed", "failed", "needs_manual", "cancelled"].includes(job.status)) return resolve(job);
        if (Date.now() - startedAt > 3000) return reject(new Error("Timed out"));
        setTimeout(tick, 20);
      };
      tick();
    });

    expect(finished.status).toBe("completed");
    expect(saved).toEqual([{ apiKey: "ck_cn_generated", phone: "+85252222222" }]);
    expect(buyActivation).toHaveBeenCalledTimes(2);
    expect(waitForCode).toHaveBeenCalledTimes(2);
    expect(cancelOrder).toHaveBeenCalledWith(7);
    expect(finishOrder).toHaveBeenCalledWith(8);
    expect(pages).toHaveLength(2);
    expect(pages[0].close).toHaveBeenCalled();
  });

  it("normalizes numeric upstream HTTP failures to failed account status", async () => {
    const manager = new CodeBuddyCnPhoneImportManager({
      browserLauncher: async () => ({
        async newContext() {
          return {
            async newPage() {
              return {};
            },
            async close() {},
          };
        },
        async close() {},
      }),
      fiveSimClientFactory: () => ({
        buyActivation: vi.fn(async () => ({ id: 7, phone: "+85251234567" })),
        waitForCode: vi.fn(async () => {
          const error = new Error("5sim HTTP 444 for /user/check/7: 502 Bad Gateway");
          error.status = 444;
          throw error;
        }),
        finishOrder: vi.fn(async () => ({ ok: true })),
        cancelOrder: vi.fn(async () => ({ ok: true })),
      }),
      phoneLoginFn: vi.fn(async ({ codeProvider }) => {
        await codeProvider();
        return { phone: "+85251234567" };
      }),
      createApiKeyFn: vi.fn(async () => ({ key: "ck_cn_generated" })),
      saveConnection: vi.fn(async () => ({ connection: { id: "conn-cn-1" } })),
    });

    const started = await manager.startJob({
      fiveSimToken: "five-token",
      count: 1,
      concurrency: 1,
    });

    const finished = await new Promise((resolve, reject) => {
      const startedAt = Date.now();
      const tick = () => {
        const job = manager.getJob(started.jobId);
        if (job?.status === "failed") return resolve(job);
        if (Date.now() - startedAt > 3000) return reject(new Error("Timed out"));
        setTimeout(tick, 20);
      };
      tick();
    });

    expect(finished.accounts[0].status).toBe("failed");
    expect(finished.summary.failed).toBe(1);
  });

  it("creates API keys through the CodeBuddy CN same-origin browser path", async () => {
    const calls = [];
    const page = {
      async goto(url) {
        calls.push({ type: "goto", url });
      },
      async waitForTimeout() {},
      async waitForFunction() {
        return true;
      },
      async evaluate(_fn, args) {
        calls.push({ type: "evaluate", args });
        return {
          ok: true,
          status: 200,
          payload: {
            code: 0,
            data: {
              key: "ck_generated_secret",
              key_id: "ck_generated",
              expires_at: "2027-06-23T03:06:21.546560914+08:00",
              item: {
                key_id: "ck_generated",
                name: args.name,
                created_at: "2026-06-23T03:06:21.546560914+08:00",
              },
            },
          },
          text: "",
        };
      },
    };

    const key = await createCodeBuddyCnApiKey(page);

    expect(calls[0]).toEqual({
      type: "goto",
      url: "https://www.codebuddy.cn/profile/keys",
    });
    expect(calls[1].args.endpoint).toBe("/console/api/client/v1/api-keys");
    expect(calls[1].args.endpointUrl).toBe("https://www.codebuddy.cn/console/api/client/v1/api-keys");
    expect(key.key).toBe("ck_generated_secret");
    expect(key.id).toBe("ck_generated");
  });

  it("reports CodeBuddy CN API key HTTP failures with endpoint context", async () => {
    const page = {
      async goto() {},
      async waitForTimeout() {},
      async waitForFunction() {
        return true;
      },
      async evaluate(_fn, args) {
        return {
          ok: false,
          status: 502,
          payload: { msg: "Bad Gateway" },
          text: "{\"msg\":\"Bad Gateway\"}",
          request: {
            endpoint: args.endpointUrl,
            body: "{}",
          },
          page: {
            href: "https://www.codebuddy.cn/profile/keys",
            origin: "https://www.codebuddy.cn",
          },
        };
      },
    };

    await expect(createCodeBuddyCnApiKey(page)).rejects.toThrow(
      "CodeBuddy CN API key request failed (502) at https://www.codebuddy.cn/console/api/client/v1/api-keys: Bad Gateway"
    );
  });

  it("marks finished jobs failed when every account failed", () => {
    const { resolveFinishedJobStatus } = kiroBulkImportTest;

    expect(resolveFinishedJobStatus([{ status: "failed" }])).toBe("failed");
    expect(resolveFinishedJobStatus([{ status: "failed" }, { status: "success" }])).toBe("completed");
    expect(resolveFinishedJobStatus([{ status: "needs_manual" }, { status: "failed" }])).toBe("needs_manual");
  });
});
