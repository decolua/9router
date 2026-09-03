import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  effects: [],
  stateIndex: 0,
  stateSetters: [],
}));

vi.mock("react", () => ({
  useCallback: (callback) => callback,
  useEffect: (effect) => { harness.effects.push(effect); },
  useRef: (initialValue) => ({ current: initialValue }),
  useState: (initialValue) => {
    const index = harness.stateIndex++;
    const value = typeof initialValue === "function" ? initialValue() : initialValue;
    const setter = vi.fn();
    harness.stateSetters[index] = setter;
    return [value, setter];
  },
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "codex" }),
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/shared/components", () => {
  const component = function Component() {};
  return {
    Card: component,
    Button: component,
    Badge: component,
    Input: component,
    Modal: component,
    CardSkeleton: component,
    OAuthModal: component,
    KiroOAuthWrapper: component,
    CursorAuthModal: component,
    IFlowCookieModal: component,
    GitLabAuthModal: component,
    Toggle: component,
    Select: component,
    EditConnectionModal: component,
    NoAuthProxyCard: component,
    ConfirmModal: component,
  };
});

vi.mock("@/shared/hooks/useCopyToClipboard", () => ({
  useCopyToClipboard: () => ({ copied: null, copy: vi.fn() }),
}));
vi.mock("@/shared/hooks/useModelCaps", () => ({
  useModelCaps: () => ({ getCaps: () => ({}) }),
}));
vi.mock("@/i18n/runtime", () => ({ translate: (value) => value }));
vi.mock("../../src/app/(dashboard)/dashboard/providers/[id]/ModelRow.js", () => ({ default: function ModelRow() {} }));
vi.mock("../../src/app/(dashboard)/dashboard/providers/[id]/PassthroughModelsSection.js", () => ({ default: function PassthroughModelsSection() {} }));
vi.mock("../../src/app/(dashboard)/dashboard/providers/[id]/CompatibleModelsSection.js", () => ({ default: function CompatibleModelsSection() {} }));
vi.mock("../../src/app/(dashboard)/dashboard/providers/[id]/ConnectionRow.js", () => ({ default: function ConnectionRow() {} }));
vi.mock("../../src/app/(dashboard)/dashboard/providers/[id]/AddApiKeyModal.js", () => ({ default: function AddApiKeyModal() {} }));
vi.mock("../../src/app/(dashboard)/dashboard/providers/[id]/EditCompatibleNodeModal.js", () => ({ default: function EditCompatibleNodeModal() {} }));
vi.mock("../../src/app/(dashboard)/dashboard/providers/[id]/AddCustomModelModal.js", () => ({ default: function AddCustomModelModal() {} }));
vi.mock("../../src/app/(dashboard)/dashboard/providers/[id]/BulkImportCodexModal.js", () => ({ default: function BulkImportCodexModal() {} }));

import ProviderDetailPage from "../../src/app/(dashboard)/dashboard/providers/[id]/page.js";

function response(data, ok = true) {
  return { ok, json: async () => data };
}

function flushPromises(turns = 12) {
  return Array.from({ length: turns }).reduce(
    (pending) => pending.then(() => Promise.resolve()),
    Promise.resolve(),
  );
}

describe("OAuth proxy pool discovery", () => {
  beforeEach(() => {
    harness.effects = [];
    harness.stateIndex = 0;
    harness.stateSetters = [];
  });

  it("resets readiness before later discovery and keeps failure closed", async () => {
    let proxyAttempt = 0;
    let finishFailedDiscovery;
    globalThis.fetch = vi.fn(async (url) => {
      const target = String(url);
      if (target === "/api/providers") return response({ connections: [] });
      if (target === "/api/provider-nodes") return response({ nodes: [] });
      if (target === "/api/settings") return response({});
      if (target === "/api/models/alias") return response({ aliases: {} });
      if (target === "/api/models/custom") return response({ models: [] });
      if (target.startsWith("/api/models/disabled")) return response({ ids: [] });
      if (target === "/api/proxy-pools?isActive=true") {
        proxyAttempt += 1;
        if (proxyAttempt === 1) return response({ proxyPools: [{ id: "pool-1" }] });
        return await new Promise((resolve) => { finishFailedDiscovery = resolve; });
      }
      throw new Error(`Unexpected request: ${target}`);
    });
    ProviderDetailPage();
    const loadPage = harness.effects[1];
    const setProxyPoolsReady = harness.stateSetters[4];

    loadPage();
    await flushPromises();
    expect(setProxyPoolsReady).toHaveBeenLastCalledWith(true);
    setProxyPoolsReady.mockClear();

    loadPage();
    await flushPromises(2);
    expect(setProxyPoolsReady).toHaveBeenCalledWith(false);

    finishFailedDiscovery(response({}, false));
    await flushPromises();
    expect(setProxyPoolsReady).not.toHaveBeenCalledWith(true);
  });
});
