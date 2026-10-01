import { describe, it, expect, beforeEach, vi } from "vitest";
import { XiaomiMimoExecutor, __test__ } from "../../open-sse/executors/xiaomi-mimo.js";
import { getExecutor } from "../../open-sse/executors/index.js";
import * as mimoAccount from "../../open-sse/shared/mimoAccount.js";

const { bareModel, COOKIE_KEY } = __test__;

const OPENAI_T = { runtimeTransport: { format: "openai", baseUrl: "https://api.xiaomimimo.com/v1/chat/completions" } };
const CLAUDE_T = { runtimeTransport: { format: "claude", baseUrl: "https://api.xiaomimimo.com/anthropic/v1/messages" } };

describe("xiaomi-mimo executor", () => {
  let ex;
  beforeEach(() => {
    ex = new XiaomiMimoExecutor();
  });

  it("is registered for xiaomi-mimo", () => {
    expect(getExecutor("xiaomi-mimo")).toBeInstanceOf(XiaomiMimoExecutor);
  });

  it("keeps the sourceFormat-matched endpoint for cloud models", () => {
    expect(ex.buildUrl("mimo-v2.5-pro", true, 0, CLAUDE_T)).toBe(CLAUDE_T.runtimeTransport.baseUrl);
    expect(ex.buildUrl("mimo-v2.5-pro", true, 0, OPENAI_T)).toBe(OPENAI_T.runtimeTransport.baseUrl);
  });

  it("routes v2.6 models to account route when desktop credentials are present", () => {
    // No region → SGP default
    const expected = "https://mimo-server-sgp.xiaomimimo.com/api/route/chat/completions";
    const credsWithToken = { providerSpecificData: { mimoPassToken: "token123" } };
    const credsWithCookie = { [COOKIE_KEY]: "serviceToken=abc" };

    expect(ex.buildUrl("mimo-v2.6-flash", true, 0, credsWithToken)).toBe(expected);
    expect(ex.buildUrl("mimo-v2.6-pro", true, 0, credsWithCookie)).toBe(expected);
    expect(ex.buildUrl("xiaomi/mimo-v2.6-flash", true, 0, credsWithToken)).toBe(expected);
  });

  it("routes v2.6 models to cloud API when no desktop credentials are present", () => {
    expect(ex.buildUrl("mimo-v2.6-flash", true, 0, OPENAI_T)).toBe(OPENAI_T.runtimeTransport.baseUrl);
    expect(ex.buildUrl("mimo-v2.6-pro", true, 0, CLAUDE_T)).toBe(CLAUDE_T.runtimeTransport.baseUrl);
  });

  it("resolves the account-service cluster per connection region", () => {
    const cn = "https://mimo-server-cn.xiaomimimo.com/api/route/chat/completions";
    const sgp = "https://mimo-server-sgp.xiaomimimo.com/api/route/chat/completions";
    const ams = "https://mimo-server-ams.xiaomimimo.com/api/route/chat/completions";
    const ru = "https://mimo-server-ru.xiaomimimo.com/api/route/chat/completions";
    const inRegion = "https://mimo-server-in.xiaomimimo.com/api/route/chat/completions";
    // default (no region) falls back to SGP (the international cluster)
    expect(ex.buildUrl("mimo-v2.6-flash", true, 0, { providerSpecificData: { mimoPassToken: "t" } })).toBe(sgp);
    expect(ex.buildUrl("mimo-v2.6-pro", true, 0, { providerSpecificData: { region: "cn", mimoPassToken: "t" } })).toBe(cn);
    expect(ex.buildUrl("mimo-v2.6-pro", true, 0, { providerSpecificData: { region: "sgp", mimoPassToken: "t" } })).toBe(sgp);
    expect(ex.buildUrl("mimo-v2.6-flash", true, 0, { providerSpecificData: { region: "SGP", mimoPassToken: "t" } })).toBe(sgp);
    expect(ex.buildUrl("mimo-v2.6-pro", true, 0, { providerSpecificData: { region: "ams", mimoPassToken: "t" } })).toBe(ams);
    expect(ex.buildUrl("mimo-v2.6-pro", true, 0, { providerSpecificData: { region: "ru", mimoPassToken: "t" } })).toBe(ru);
    expect(ex.buildUrl("mimo-v2.6-pro", true, 0, { providerSpecificData: { region: "in", mimoPassToken: "t" } })).toBe(inRegion);
    // unknown region falls back to SGP
    expect(ex.buildUrl("mimo-v2.6-pro", true, 0, { providerSpecificData: { region: "eu", mimoPassToken: "t" } })).toBe(sgp);
  });

  it("authenticates v2.6 calls with account cookie when on account route", () => {
    const headers = ex.buildHeaders(
      { [COOKIE_KEY]: "serviceToken=abc", accessToken: "sk-x" },
      true,
      "u",
      "mimo-v2.6-flash",
    );
    expect(headers.Cookie).toBe("serviceToken=abc");
    expect(headers.Authorization).toBeUndefined();
  });

  it("authenticates cloud calls with the bearer key", () => {
    const headers = ex.buildHeaders({ accessToken: "sk-x" }, true, "u", "mimo-v2.5-pro");
    expect(headers.Authorization).toBe("Bearer sk-x");
    expect(headers.Cookie).toBeUndefined();
  });

  it("preserves content-part arrays for multimodal inputs", () => {
    const parts = [{ type: "image_url", image_url: { url: "data:image/png;base64,xyz" } }, { type: "text", text: "hi" }];
    const out = ex.transformRequest(
      "mimo-v2.6-pro",
      { messages: [{ role: "user", content: parts }] },
      true,
      { providerSpecificData: { mimoPassToken: "token" } },
    );
    expect(out.messages[0].content).toEqual(parts);
  });

  it("bridges reasoning_effort to official output_config.effort", () => {
    const creds = { providerSpecificData: { mimoPassToken: "token" } };
    const body = {
      messages: [{ role: "user", content: "solve" }],
      reasoning_effort: "high",
    };
    const out = ex.transformRequest("mimo-v2.6-pro", body, true, creds);
    expect(out.reasoning_effort).toBeUndefined();
    expect(out.output_config).toEqual({ effort: "high" });
  });

  it("normalizes xhigh reasoning_effort to high in output_config.effort", () => {
    const creds = { providerSpecificData: { mimoPassToken: "token" } };
    const body = {
      messages: [{ role: "user", content: "complex" }],
      reasoning_effort: "xhigh",
    };
    const out = ex.transformRequest("mimo-v2.6-pro", body, true, creds);
    expect(out.reasoning_effort).toBeUndefined();
    expect(out.output_config).toEqual({ effort: "high" });
  });

  it("applies defaults without overriding explicit values", () => {
    const creds = { providerSpecificData: { mimoPassToken: "token" } };
    const body = { messages: [{ role: "user", content: "hi" }], temperature: 0.2 };
    const out = ex.transformRequest("mimo-v2.6-pro", body, true, creds);
    expect(out.temperature).toBe(0.2);
    expect(out.top_p).toBe(0.95);
  });

  it("leaves cloud bodies free of account defaults", () => {
    const out = ex.transformRequest("mimo-v2.5-pro", { messages: [{ role: "user", content: "hi" }] }, true, {});
    expect(out.output_config).toBeUndefined();
    expect(out.temperature).toBeUndefined();
  });

  it("strips a provider/model prefix when testing model ids", () => {
    expect(bareModel("xiaomi/mimo-v2.6-pro")).toBe("mimo-v2.6-pro");
    expect(bareModel("mimo-v2.6-flash")).toBe("mimo-v2.6-flash");
  });
});
