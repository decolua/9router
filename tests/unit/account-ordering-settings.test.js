import { beforeEach, describe, expect, it, vi } from "vitest";
const configure = vi.hoisted(() => vi.fn());
const save = vi.hoisted(() => vi.fn(async body => body));
vi.mock("@/lib/localDb", () => ({ getSettings: async () => ({}), updateSettings: save }));
vi.mock("@/lib/network/outboundProxy", () => ({ applyOutboundProxyEnv: vi.fn() }));
vi.mock("open-sse/services/combo.js", () => ({ resetComboRotation: vi.fn() }));
vi.mock("@/shared/services/accountQuotaWindows", () => ({ configureAccountQuotaWindows: configure }));
vi.mock("@/shared/services/accountQuotaWindows.js", () => ({ configureAccountQuotaWindows: configure }));
const { PATCH } = await import("../../src/app/api/settings/route.js");
const request = body => new Request("http://localhost/api/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
beforeEach(() => vi.clearAllMocks());

describe("account strategy settings HTTP boundary", () => {
  it.each([null, [], { providerStrategies: { codex: { fallbackStrategy: "invalid" } } }, { providerStrategies: { claude: { stickyRoundRobinLimit: 0 } } }])("rejects invalid settings without writing: %j", async body => {
    expect((await PATCH(request(body))).status).toBe(400);
    expect(save).not.toHaveBeenCalled();
  });
  it("accepts supported modes and preserves proxy override fields", async () => {
    const body = { providerStrategies: { claude: { fallbackStrategy: "session-reset-desc", proxyPoolId: "pool", rotateStrategy: "round-robin" } } };
    expect((await PATCH(request(body))).status).toBe(200);
    expect(save).toHaveBeenCalledWith(body);
    expect(configure).toHaveBeenCalledWith(body);
  });
});
