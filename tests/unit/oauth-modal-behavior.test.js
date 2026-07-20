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
  useId: () => "oauth-modal-test",
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
  callbackUrl = "",
  selectedProxyPoolId = "",
  proxyPools = [{ id: "pool-1", name: "Pool 1" }, { id: "pool-2", name: "Pool 2" }],
} = {}) {
  harness.effects = [];
  harness.stateIndex = 0;
  harness.stateValues = [
    step,
    authData,
    callbackUrl,
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
    vi.spyOn(globalThis.crypto, "randomUUID")
      .mockReturnValueOnce("old-flow")
      .mockReturnValueOnce("new-flow");
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
      if (target.includes("/cancel-poll")) {
        return response({ success: true });
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
      .filter(([url]) => String(url).endsWith("/poll"))
      .map(([, options]) => JSON.parse(options.body).deviceCode);
    const cancelledFlows = globalThis.fetch.mock.calls
      .filter(([url]) => String(url).includes("/cancel-poll"))
      .map(([, options]) => JSON.parse(options.body).flowId);
    const polledFlows = globalThis.fetch.mock.calls
      .filter(([url]) => String(url).endsWith("/poll"))
      .map(([, options]) => JSON.parse(options.body).flowId);
    expect(polledDevices).toEqual(["new-device"]);
    expect(cancelledFlows).toEqual(["old-flow"]);
    expect(polledFlows).toEqual(["new-flow"]);
  });

  it("does not start a new pool flow when device cancellation fails", async () => {
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue("old-flow");
    globalThis.fetch = vi.fn(async (url) => {
      const target = String(url);
      if (target.includes("/device-code")) {
        return response({
          device_code: "old-device",
          expires_in: 60,
          interval: 30,
          verification_uri: "https://auth.example/device",
        });
      }
      if (target.includes("/cancel-poll")) {
        return response({ error: "Cancellation failed" }, false);
      }
      throw new Error(`Unexpected request: ${target}`);
    });
    const tree = renderModal({ provider: "github" });
    const openEffect = harness.effects[1];
    const select = findElement(tree, (node) => node.type?.name === "OAuthProxyPoolSelector");

    openEffect();
    await flushPromises();
    await select.props.onChange({ target: { value: "pool-1" } });
    await flushPromises();

    const deviceCodeRequests = globalThis.fetch.mock.calls
      .map(([url]) => String(url))
      .filter((url) => url.includes("/device-code"));
    expect(deviceCodeRequests).toHaveLength(1);
  });

  it.each(["http", "network"])("does not start a replacement when fixed stop has a %s failure", async (failure) => {
    globalThis.fetch = vi.fn(async (url) => {
      const target = String(url);
      if (target.includes("/stop-proxy")) {
        if (failure === "network") throw new Error("stop network failed");
        return response({ error: "Stop failed" }, false);
      }
      if (target.includes("/authorize")) {
        return response({ authUrl: "https://auth.example", state: "new-state" });
      }
      throw new Error(`Unexpected request: ${target}`);
    });
    const tree = renderModal({ provider: "codex", authData: { state: "old-state" } });
    const select = findElement(tree, (node) => node.type?.name === "OAuthProxyPoolSelector");

    await select.props.onChange({ target: { value: "pool-1" } });
    await flushPromises();

    expect(globalThis.fetch.mock.calls.some(([url]) => String(url).includes("/authorize"))).toBe(false);
  });

  it("does not retry a fixed flow when stop fails", async () => {
    globalThis.fetch = vi.fn(async (url) => {
      const target = String(url);
      if (target.includes("/stop-proxy")) return response({ error: "Stop failed" }, false);
      if (target.includes("/authorize")) return response({ authUrl: "https://auth.example", state: "new-state" });
      throw new Error(`Unexpected request: ${target}`);
    });
    const tree = renderModal({ provider: "codex", step: "error", authData: { state: "old-state" } });
    const retryButton = findElement(tree, (node) => node.props?.children === "Try Again");

    await retryButton.props.onClick();
    await flushPromises();

    expect(globalThis.fetch.mock.calls.some(([url]) => String(url).includes("/authorize"))).toBe(false);
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

    const startedStates = globalThis.fetch.mock.calls
      .filter(([url]) => String(url).includes("/start-proxy"))
      .map(([, options]) => JSON.parse(options.body).state);
    expect(concurrentStopCount).toBe(1);
    expect(startedStates).toEqual(["pool-2-state"]);
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

    const stopCall = globalThis.fetch.mock.calls
      .find(([url]) => String(url).includes("/stop-proxy"));
    expect(JSON.parse(stopCall[1].body).state).toBe("initial-state");
  });

  it("uses server-owned state when exchanging a raw token", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(response({ success: true }));
    const tree = renderModal({
      provider: "codex",
      step: "input",
      authData: { state: "server-state" },
      callbackUrl: "eyJhbGciOiJub25lIn0.payload.signature",
    });
    const connectButton = findElement(tree, (node) => node.props?.children === "Connect");

    await connectButton.props.onClick();

    const exchangeCall = globalThis.fetch.mock.calls.find(([url]) => String(url).endsWith("/exchange"));
    expect(JSON.parse(exchangeCall[1].body).state).toBe("server-state");
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
      .filter(([url]) => String(url).includes("/stop-proxy"))
      .map(([, options]) => JSON.parse(options.body).state)
      .filter((state) => state === "initial-state");
    expect(initialStops).toHaveLength(2);

    pendingStarts[1].resolve(response({ success: true, serverSide: true }));
    await poolChange;
  });
});
