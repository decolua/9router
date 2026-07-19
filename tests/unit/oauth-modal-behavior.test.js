import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  effects: [],
  stateIndex: 0,
  stateValues: [],
}));

vi.mock("react", () => ({
  useCallback: (callback) => callback,
  useEffect: (effect) => {
    harness.effects.push(effect);
  },
  useRef: (initialValue) => ({ current: initialValue }),
  useState: (initialValue) => {
    const index = harness.stateIndex++;
    const value = index < harness.stateValues.length
      ? harness.stateValues[index]
      : initialValue;
    return [value, vi.fn()];
  },
}));

vi.mock("@/shared/components", () => ({
  Button: function Button() {},
  Input: function Input() {},
  Modal: function Modal() {},
}));

vi.mock("@/shared/hooks/useCopyToClipboard", () => ({
  useCopyToClipboard: () => ({ copied: null, copy: vi.fn() }),
}));

import OAuthModal from "../../src/shared/components/OAuthModal.js";

const originalFetch = globalThis.fetch;

function response(data, ok = true) {
  return { ok, json: async () => data };
}

function flushPromises(turns = 8) {
  return Array.from({ length: turns }).reduce(
    (pending) => pending.then(() => Promise.resolve()),
    Promise.resolve(),
  );
}

function findElement(node, predicate) {
  if (Array.isArray(node)) {
    for (const child of node) {
      const match = findElement(child, predicate);
      if (match) return match;
    }
    return null;
  }
  if (!node || typeof node !== "object") return null;
  if (predicate(node)) return node;
  return findElement(node.props?.children, predicate);
}

function renderModal({
  provider = "claude",
  step = "waiting",
  authData = null,
  selectedProxyPoolId = "",
  proxyPools = [{ id: "pool-1", name: "Pool 1" }, { id: "pool-2", name: "Pool 2" }],
} = {}) {
  harness.effects = [];
  harness.stateIndex = 0;
  harness.stateValues = [
    step,
    authData,
    "",
    step === "error" ? "failed" : null,
    false,
    null,
    false,
    selectedProxyPoolId,
    false,
    "/callback?code=...",
  ];

  return OAuthModal({
    isOpen: true,
    provider,
    providerInfo: { name: provider },
    onSuccess: vi.fn(),
    onClose: vi.fn(),
    proxyPools,
    proxyPoolsReady: true,
  });
}

describe("OAuth modal flow coordination", () => {
  beforeEach(() => {
    globalThis.window = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      location: {
        hostname: "localhost",
        origin: "http://localhost:20127",
        port: "20127",
        protocol: "http:",
      },
      open: vi.fn(() => ({})),
    };
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete globalThis.window;
    globalThis.fetch = originalFetch;
  });

  it("Try Again restarts with selected proxy pool instead of click event", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(response({
      authUrl: "https://auth.example/authorize",
      codeVerifier: "verifier",
      state: "state",
    }));
    const tree = renderModal({ step: "error", selectedProxyPoolId: "pool-1" });
    const retryButton = findElement(tree, (node) => node.props?.children === "Try Again");

    await retryButton.props.onClick({ type: "click", target: {} });

    const authorizeUrl = new URL(globalThis.fetch.mock.calls[0][0]);
    expect(authorizeUrl.searchParams.get("proxyPoolId")).toBe("pool-1");
  });

  it("keeps an old sleeping device poll cancelled after pool restart", async () => {
    vi.useFakeTimers();
    globalThis.fetch = vi.fn(async (url, options) => {
      const target = String(url);
      if (target.includes("/device-code")) {
        const poolId = new URL(target).searchParams.get("proxyPoolId");
        return response({
          device_code: poolId ? "new-device" : "old-device",
          expires_in: 60,
          interval: 1,
          verification_uri: "https://auth.example/device",
        });
      }
      if (target.includes("/poll")) {
        return response({ success: false, error: "authorization_pending" });
      }
      throw new Error(`Unexpected request: ${target} ${options?.body || ""}`);
    });
    const tree = renderModal({ provider: "github" });
    const openEffect = harness.effects[1];
    const select = findElement(tree, (node) => node.type?.name === "OAuthProxyPoolSelector");

    openEffect();
    await flushPromises();
    await select.props.onChange({ target: { value: "pool-1" } });
    await flushPromises();
    await vi.advanceTimersByTimeAsync(1_000);

    const polledDevices = globalThis.fetch.mock.calls
      .filter(([url]) => String(url).includes("/poll"))
      .map(([, options]) => JSON.parse(options.body).deviceCode);
    expect(polledDevices).toEqual(["new-device"]);
  });

  it("serializes rapid pool changes and starts only latest flow", async () => {
    const pendingStops = [];
    globalThis.fetch = vi.fn(async (url, options) => {
      const target = String(url);
      if (target.includes("/stop-proxy")) {
        return await new Promise((resolve) => pendingStops.push({ resolve }));
      }
      if (target.includes("/authorize")) {
        const poolId = new URL(target).searchParams.get("proxyPoolId");
        return response({
          authUrl: `https://auth.example/${poolId}`,
          codeVerifier: `${poolId}-verifier`,
          state: `${poolId}-state`,
        });
      }
      if (target.includes("/start-proxy")) {
        return response({ success: true, serverSide: true });
      }
      throw new Error(`Unexpected request: ${target} ${options?.body || ""}`);
    });
    const tree = renderModal({ provider: "codex", authData: { state: "old-state" } });
    const select = findElement(tree, (node) => node.type?.name === "OAuthProxyPoolSelector");

    const firstChange = select.props.onChange({ target: { value: "pool-1" } });
    const secondChange = select.props.onChange({ target: { value: "pool-2" } });
    await flushPromises();
    const concurrentStopCount = pendingStops.length;

    pendingStops[0].resolve(response({ success: true }));
    await flushPromises();
    pendingStops[1]?.resolve(response({ success: true }));
    await Promise.all([firstChange, secondChange]);

    const startedPools = globalThis.fetch.mock.calls
      .filter(([url]) => String(url).includes("/start-proxy"))
      .map(([, options]) => JSON.parse(options.body).proxyPoolId);
    expect(concurrentStopCount).toBe(1);
    expect(startedPools).toEqual(["pool-2"]);
  });

  it("stops the fixed proxy with state received before React rerenders", async () => {
    globalThis.fetch = vi.fn(async (url, options) => {
      const target = String(url);
      if (target.includes("/authorize")) {
        const poolId = new URL(target).searchParams.get("proxyPoolId") || "initial";
        return response({
          authUrl: `https://auth.example/${poolId}`,
          codeVerifier: `${poolId}-verifier`,
          state: `${poolId}-state`,
        });
      }
      if (target.includes("/start-proxy")) return response({ success: true, serverSide: true });
      if (target.includes("/stop-proxy")) return response({ success: true });
      throw new Error(`Unexpected request: ${target} ${options?.body || ""}`);
    });
    const tree = renderModal({ provider: "codex", authData: null });
    const openEffect = harness.effects[1];
    const select = findElement(tree, (node) => node.type?.name === "OAuthProxyPoolSelector");

    openEffect();
    await flushPromises();
    await select.props.onChange({ target: { value: "pool-1" } });

    const stopUrl = globalThis.fetch.mock.calls
      .map(([url]) => String(url))
      .find((url) => url.includes("/stop-proxy"));
    expect(new URL(stopUrl, window.location.origin).searchParams.get("state")).toBe("initial-state");
  });

  it("cleans a stale fixed session that registers after the first stop", async () => {
    const pendingStarts = [];
    globalThis.fetch = vi.fn(async (url, options) => {
      const target = String(url);
      if (target.includes("/authorize")) {
        const poolId = new URL(target).searchParams.get("proxyPoolId") || "initial";
        return response({
          authUrl: `https://auth.example/${poolId}`,
          codeVerifier: `${poolId}-verifier`,
          state: `${poolId}-state`,
        });
      }
      if (target.includes("/start-proxy")) {
        return await new Promise((resolve) => pendingStarts.push({ resolve }));
      }
      if (target.includes("/stop-proxy")) return response({ success: true });
      throw new Error(`Unexpected request: ${target} ${options?.body || ""}`);
    });
    const tree = renderModal({ provider: "codex", authData: null });
    const openEffect = harness.effects[1];
    const select = findElement(tree, (node) => node.type?.name === "OAuthProxyPoolSelector");

    openEffect();
    await flushPromises();
    const poolChange = select.props.onChange({ target: { value: "pool-1" } });
    await flushPromises();
    pendingStarts[0].resolve(response({ success: true, serverSide: true }));
    await flushPromises();

    const initialStops = globalThis.fetch.mock.calls
      .map(([url]) => new URL(String(url), window.location.origin))
      .filter((url) => url.pathname.endsWith("/stop-proxy") && url.searchParams.get("state") === "initial-state");
    expect(initialStops).toHaveLength(2);

    pendingStarts[1].resolve(response({ success: true, serverSide: true }));
    await poolChange;
  });
});
