import { beforeEach, describe, expect, it, vi } from "vitest";
import crypto from "crypto";

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: vi.fn(),
}));

import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";
import { PROVIDERS } from "../../open-sse/config/providers.js";
import { getModelsByProviderId, PROVIDER_ID_TO_ALIAS } from "../../open-sse/config/providerModels.js";
import { parseModel } from "../../open-sse/services/model.js";
import { getExecutor, hasSpecializedExecutor } from "../../open-sse/executors/index.js";
import {
  __test__ as autoclawExecutorInternals,
  AutoClawExecutor,
} from "../../open-sse/executors/autoclaw.js";
import {
  refreshAutoClawToken,
} from "../../open-sse/services/tokenRefresh/providers.js";
import { getUsageForProvider } from "../../open-sse/services/usage.js";

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("AutoClaw provider registry", () => {
  it("registers AutoClaw with alias, forced streaming, and model catalog", () => {
    expect(PROVIDERS.autoclaw.forceStream).toBe(true);
    expect(PROVIDER_ID_TO_ALIAS.autoclaw).toBe("ac");
    expect(parseModel("ac/glm-5.2")).toMatchObject({
      provider: "autoclaw",
      model: "glm-5.2",
    });
    expect(getModelsByProviderId("autoclaw").map((model) => model.id)).toEqual([
      "glm-5.2",
      "glm-5-turbo",
      "deepseek-v4-pro",
      "deepseek-v4",
      "auto",
    ]);
  });

  it("uses a specialized AutoClaw executor", () => {
    expect(hasSpecializedExecutor("autoclaw")).toBe(true);
    expect(getExecutor("autoclaw")).toBeInstanceOf(AutoClawExecutor);
  });
});

describe("AutoClaw executor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("maps public model ids to AutoClaw X-Request-Model upstream ids", () => {
    expect(autoclawExecutorInternals.resolveAutoClawUpstreamModel("glm-5.2")).toBe("openrouter_glm-5.2");
    expect(autoclawExecutorInternals.resolveAutoClawUpstreamModel("glm-5-turbo")).toBe("zai_glm-5-turbo");
    expect(autoclawExecutorInternals.resolveAutoClawUpstreamModel("deepseek-v4-pro")).toBe("zai_auto");
    expect(autoclawExecutorInternals.resolveAutoClawUpstreamModel("auto")).toBe("zai_auto");
  });

  it("builds signed AutoClaw headers and sends auth through X-Authorization", () => {
    const executor = new AutoClawExecutor();
    const headers = executor.buildHeaders({ accessToken: "Bearer access-token" }, true, {
      timestamp: "1780000000",
      requestId: "req-1",
      traceId: "trace-1",
      model: "glm-5.2",
    });

    const expectedSign = crypto
      .createHash("md5")
      .update("100003&1780000000&38d2391985e2369a5fb8227d8e6cd5e5")
      .digest("hex");

    expect(headers).toMatchObject({
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      "X-Authorization": "Bearer access-token",
      "X-Request-Id": "req-1",
      "X-Request-Model": "openrouter_glm-5.2",
      "X-Auth-Appid": "100003",
      "X-Auth-Timestamp": "1780000000",
      "X-Auth-Sign": expectedSign,
      "X-Product": "autoclaw",
      "X-Version": "1.10.0",
      "X-Tm": "web",
      "X-Trace-Id": "trace-1",
    });
    expect(headers.Authorization).toBeUndefined();
  });

  it("forces upstream request body to stream even for non-streaming clients", () => {
    const executor = new AutoClawExecutor();
    const headers = executor.buildHeaders({ accessToken: "access-token" }, false, {
      timestamp: "1780000000",
      requestId: "req-1",
      traceId: "trace-1",
      model: "glm-5-turbo",
    });
    const transformed = executor.transformRequest("glm-5-turbo", {
      model: "glm-5-turbo",
      stream: false,
      messages: [{ role: "user", content: "hello" }],
    });

    expect(transformed).toMatchObject({
      model: "glm-5-turbo",
      stream: true,
    });
    expect(headers.Accept).toBe("text/event-stream");
  });
});

describe("AutoClaw token refresh", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("refreshes using device_id and strips Bearer from refresh token body", async () => {
    proxyAwareFetch.mockResolvedValueOnce(jsonResponse({
      code: 0,
      data: {
        access_token: "new-access",
        refresh_token: "new-refresh",
      },
    }));

    const refreshed = await refreshAutoClawToken("Bearer old-refresh", {
      deviceId: "device-1",
    });

    expect(proxyAwareFetch).toHaveBeenCalledTimes(1);
    expect(proxyAwareFetch.mock.calls[0][0]).toBe("https://autoglm-api.autoglm.ai/userapi/v1/refresh");
    expect(JSON.parse(proxyAwareFetch.mock.calls[0][1].body)).toMatchObject({
      source_id: "web",
      device_id: "device-1",
      refresh_token: "old-refresh",
    });
    expect(refreshed).toMatchObject({
      accessToken: "new-access",
      refreshToken: "new-refresh",
      expiresIn: 24 * 60 * 60,
      providerSpecificData: {
        deviceId: "device-1",
      },
    });
  });
});

describe("AutoClaw usage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches wallet balance as points", async () => {
    proxyAwareFetch.mockResolvedValueOnce(jsonResponse({
      code: 0,
      data: {
        total_balance: 1997,
      },
    }));

    const usage = await getUsageForProvider({
      provider: "autoclaw",
      accessToken: "Bearer access-token",
      providerSpecificData: {},
    });

    expect(proxyAwareFetch).toHaveBeenCalledWith(
      "https://autoglm-api.autoglm.ai/agent-assetmgr/api/v2/wallets?biz_app_id=autoclaw",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          authorization: "Bearer access-token",
          "x-product": "autoclaw",
        }),
      }),
      null,
    );
    expect(usage.quotas.points).toMatchObject({
      total: 1997,
      remaining: 1997,
      used: 0,
      unit: "points",
    });
  });
});
