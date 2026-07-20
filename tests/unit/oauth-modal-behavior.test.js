import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  effects: [],
  refs: [],
  refIndex: 0,
  stateIndex: 0,
  stateSetters: [],
  stateValues: [],
}));

vi.mock("react", () => ({
  useCallback: (callback) => callback,
  useEffect: (effect) => {
    harness.effects.push(effect);
  },
  useRef: (initialValue) => {
    const index = harness.refIndex++;
    if (!harness.refs[index]) harness.refs[index] = { current: initialValue };
    return harness.refs[index];
  },
  useId: () => "oauth-modal-test",
  useState: (initialValue) => {
    const index = harness.stateIndex++;
    const value = index < harness.stateValues.length
      ? harness.stateValues[index]
      : initialValue;
    const setter = vi.fn();
    harness.stateSetters[index] = setter;
    return [value, setter];
  },
}));

vi.mock("@/shared/components", () => ({
  Button: function Button() {},
  Input: function Input() {},
  Modal: function Modal() {},
  OAuthModal: function OAuthModal() {},
}));

vi.mock("@/shared/hooks/useCopyToClipboard", () => ({
  useCopyToClipboard: () => ({ copied: null, copy: vi.fn() }),
}));

import OAuthModal from "../../src/shared/components/OAuthModal.js";
import KiroSocialOAuthModal from "../../src/shared/components/KiroSocialOAuthModal.js";
import KiroOAuthWrapper from "../../src/shared/components/KiroOAuthWrapper.js";
import GitLabAuthModal from "../../src/shared/components/GitLabAuthModal.js";

const originalFetch = globalThis.fetch;
const credentialError = "exchange failed at https://user:password@provider.test/callback?code=SECRET-CODE&refresh_token=SECRET-REFRESH";
const credentialParts = ["user", "password", "SECRET-CODE", "SECRET-REFRESH"];

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
  isLocalhost = false,
  proxyPools = [{ id: "pool-1", name: "Pool 1" }, { id: "pool-2", name: "Pool 2" }],
  isOpen = true,
  onSuccess = vi.fn(),
  onClose = vi.fn(),
  preserveRefs = false,
  omitProxyPoolsReady = false,
} = {}) {
  harness.effects = [];
  if (!preserveRefs) harness.refs = [];
  harness.refIndex = 0;
  harness.stateIndex = 0;
  harness.stateSetters = [];
  harness.stateValues = [
    step,
    authData,
    callbackUrl,
    step === "error" ? "failed" : null,
    false,
    null,
    false,
    selectedProxyPoolId,
    isLocalhost,
    "/callback?code=...",
  ];

  const props = {
    isOpen,
    provider,
    providerInfo: { name: provider },
    onSuccess,
    onClose,
    proxyPools,
  };
  if (!omitProxyPoolsReady) props.proxyPoolsReady = true;
  return OAuthModal(props);
}

function renderKiroModal({
  step = "loading",
  authData = null,
  callbackUrl = "",
  omitProxyPoolsReady = false,
  onClose = vi.fn(),
} = {}) {
  harness.effects = [];
  harness.refs = [];
  harness.refIndex = 0;
  harness.stateIndex = 0;
  harness.stateSetters = [];
  harness.stateValues = [step, "https://auth.example", authData, callbackUrl, null, ""];
  const props = {
    isOpen: true,
    provider: "google",
    onSuccess: vi.fn(),
    onClose,
    proxyPools: [{ id: "pool-1", name: "Pool 1" }],
  };
  if (!omitProxyPoolsReady) props.proxyPoolsReady = true;
  const tree = KiroSocialOAuthModal(props);
  if (authData) {
    harness.refs[1].current = 1;
    harness.refs[2].current = 1;
  }
  return tree;
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

  it("fails closed when OAuth modal pool readiness is omitted", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(response({
      authUrl: "https://auth.example/authorize",
      state: "state",
    }));
    renderModal({ omitProxyPoolsReady: true });

    harness.effects[1]();
    await flushPromises();

    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("fails closed when Kiro social modal pool readiness is omitted", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(response({
      authUrl: "https://auth.example/authorize",
      state: "state",
    }));
    renderKiroModal({ omitProxyPoolsReady: true });

    harness.effects[1]();
    await flushPromises();

    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("defaults Kiro wrapper pool readiness to false", () => {
    harness.effects = [];
    harness.refs = [];
    harness.refIndex = 0;
    harness.stateIndex = 0;
    harness.stateValues = ["builder-id", null, null];

    const tree = KiroOAuthWrapper({
      isOpen: true,
      providerInfo: { name: "Kiro" },
      onClose: vi.fn(),
    });

    expect(tree.props.proxyPoolsReady).toBe(false);
  });

  it("defaults GitLab wrapper pool readiness to false", () => {
    harness.effects = [];
    harness.refs = [];
    harness.refIndex = 0;
    harness.stateIndex = 0;
    harness.stateValues = [
      "oauth",
      "https://gitlab.com",
      "client-id",
      "",
      "",
      false,
      null,
      true,
      { baseUrl: "https://gitlab.com", clientId: "client-id" },
    ];

    const tree = GitLabAuthModal({
      isOpen: true,
      providerInfo: { name: "GitLab" },
      onClose: vi.fn(),
    });

    expect(tree.props.proxyPoolsReady).toBe(false);
  });

  it("sanitizes popup callback errors before displaying them", async () => {
    const popup = {};
    renderModal({ authData: { state: "callback-state" }, isLocalhost: true });
    harness.refs[0].current = popup;
    harness.effects.at(-1)();
    const messageHandler = window.addEventListener.mock.calls.find(([type]) => type === "message")[1];

    messageHandler({
      source: popup,
      origin: window.location.origin,
      data: {
        type: "oauth_callback",
        data: {
          state: "callback-state",
          error: "provider_error",
          errorDescription: credentialError,
        },
      },
    });
    await flushPromises();

    const message = harness.stateSetters[3].mock.calls.at(-1)[0];
    expect(message).toMatch(/restart sign-in|try again/i);
    for (const part of credentialParts) expect(message).not.toContain(part);
  });

  it("sanitizes manual callback errors before displaying them", async () => {
    const callbackUrl = `http://localhost:20127/callback?state=callback-state&error=provider_error&error_description=${encodeURIComponent(credentialError)}`;
    const tree = renderModal({
      step: "input",
      authData: { state: "callback-state" },
      callbackUrl,
    });
    const connectButton = findElement(tree, (node) => node.props?.children === "Connect");

    await connectButton.props.onClick();

    const message = harness.stateSetters[3].mock.calls.at(-1)[0];
    expect(message).toMatch(/restart sign-in|try again/i);
    for (const part of credentialParts) expect(message).not.toContain(part);
  });

  it("sanitizes authorize API errors before displaying them", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(response({ error: credentialError }, false));
    renderModal();

    harness.effects[1]();
    await flushPromises();

    const message = harness.stateSetters[3].mock.calls.at(-1)[0];
    expect(message).toMatch(/restart sign-in|try again/i);
    for (const part of credentialParts) expect(message).not.toContain(part);
  });

  it("sanitizes token exchange API errors before displaying them", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(response({ error: credentialError }, false));
    const tree = renderModal({
      step: "input",
      authData: { state: "callback-state" },
      callbackUrl: "http://localhost:20127/callback?state=callback-state&code=code",
    });
    const connectButton = findElement(tree, (node) => node.props?.children === "Connect");

    await connectButton.props.onClick();

    const message = harness.stateSetters[3].mock.calls.at(-1)[0];
    expect(message).toMatch(/restart sign-in|try again/i);
    for (const part of credentialParts) expect(message).not.toContain(part);
  });

  it("sanitizes Kiro callback errors before displaying them", async () => {
    const callbackUrl = `kiro://kiro.kiroAgent/authenticate-success?state=callback-state&error=provider_error&error_description=${encodeURIComponent(credentialError)}`;
    const tree = renderKiroModal({
      step: "input",
      authData: { state: "callback-state" },
      callbackUrl,
    });
    const connectButton = findElement(tree, (node) => node.props?.children === "Connect");

    await connectButton.props.onClick();

    const message = harness.stateSetters[4].mock.calls.at(-1)[0];
    expect(message).toMatch(/restart sign-in|try again/i);
    for (const part of credentialParts) expect(message).not.toContain(part);
  });

  it("sanitizes Kiro exchange API errors before displaying them", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(response({ error: credentialError }, false));
    const tree = renderKiroModal({
      step: "input",
      authData: { state: "callback-state" },
      callbackUrl: "kiro://kiro.kiroAgent/authenticate-success?state=callback-state&code=code",
    });
    const connectButton = findElement(tree, (node) => node.props?.children === "Connect");

    await connectButton.props.onClick();

    const message = harness.stateSetters[4].mock.calls.at(-1)[0];
    expect(message).toMatch(/restart sign-in|try again/i);
    for (const part of credentialParts) expect(message).not.toContain(part);
  });

  it("uses automatic callback UX on IPv6 loopback", async () => {
    globalThis.window.location = {
      hostname: "[::1]",
      origin: "http://[::1]:20127",
      port: "20127",
      protocol: "http:",
    };
    globalThis.fetch = vi.fn().mockResolvedValue(response({
      authUrl: "https://auth.example/authorize",
      state: "ipv6-state",
    }));
    renderModal();

    harness.effects[0]();
    expect(harness.stateSetters[8]).toHaveBeenCalledWith(true);

    globalThis.window.open.mockClear();
    renderModal({ isLocalhost: true });
    harness.effects[1]();
    await flushPromises();

    expect(globalThis.window.open).toHaveBeenCalledWith(
      "https://auth.example/authorize",
      "oauth_popup",
      "width=600,height=700",
    );
    expect(globalThis.window.open).not.toHaveBeenCalledWith("https://auth.example/authorize", "_blank");
  });

  it("keeps an old sleeping device poll cancelled after pool restart", async () => {
    vi.useFakeTimers();
    globalThis.fetch = vi.fn(async (url, options) => {
      const target = String(url);
      if (target.includes("/device-code")) {
        const poolId = new URL(target).searchParams.get("proxyPoolId");
        return response({
          flowId: poolId ? "new-flow" : "old-flow",
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

    const pollBodies = globalThis.fetch.mock.calls
      .filter(([url]) => String(url).endsWith("/poll"))
      .map(([, options]) => JSON.parse(options.body));
    const cancelledFlows = globalThis.fetch.mock.calls
      .filter(([url]) => String(url).includes("/cancel-poll"))
      .map(([, options]) => JSON.parse(options.body).flowId);
    expect(cancelledFlows).toEqual(["old-flow"]);
    expect(pollBodies).toEqual([{ flowId: "new-flow" }]);
  });

  it("does not start a new pool flow when device cancellation fails", async () => {
    globalThis.fetch = vi.fn(async (url) => {
      const target = String(url);
      if (target.includes("/device-code")) {
        return response({
          flowId: "old-flow",
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

  it("awaits one device cancellation before closing", async () => {
    let finishCancellation;
    const onClose = vi.fn();
    globalThis.fetch = vi.fn(async (url) => {
      const target = String(url);
      if (target.includes("/device-code")) {
        return response({
          flowId: "device-flow",
          expires_in: 60,
          interval: 30,
          verification_uri: "https://auth.example/device",
        });
      }
      if (target.includes("/cancel-poll")) {
        return await new Promise((resolve) => { finishCancellation = resolve; });
      }
      throw new Error(`Unexpected request: ${target}`);
    });
    const tree = renderModal({ provider: "github", onClose });

    harness.effects[1]();
    await flushPromises();
    const firstClose = tree.props.onClose();
    const secondClose = tree.props.onClose();
    await flushPromises();

    expect(globalThis.fetch.mock.calls.filter(([url]) => String(url).includes("/cancel-poll"))).toHaveLength(1);
    expect(onClose).not.toHaveBeenCalled();

    finishCancellation(response({ success: true }));
    await Promise.all([firstClose, secondClose]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("cancels dynamic authorization and rejects stale popup completion on close", async () => {
    const popup = {};
    const onClose = vi.fn();
    globalThis.fetch = vi.fn(async (url) => {
      const target = String(url);
      if (target.endsWith("/cancel")) return response({ success: true });
      if (target.endsWith("/exchange")) return response({ success: true });
      throw new Error(`Unexpected request: ${target}`);
    });
    const tree = renderModal({
      authData: { state: "dynamic-state" },
      isLocalhost: true,
      onClose,
    });
    harness.refs[0].current = popup;
    harness.effects.at(-1)();
    const messageHandler = window.addEventListener.mock.calls.find(([type]) => type === "message")[1];

    await tree.props.onClose();
    messageHandler({
      source: popup,
      origin: window.location.origin,
      data: {
        type: "oauth_callback",
        data: { state: "dynamic-state", code: "late-code" },
      },
    });
    await flushPromises();

    const cancelCalls = globalThis.fetch.mock.calls.filter(([url]) => String(url).endsWith("/cancel"));
    expect(cancelCalls).toHaveLength(1);
    expect(JSON.parse(cancelCalls[0][1].body)).toEqual({ state: "dynamic-state" });
    expect(globalThis.fetch.mock.calls.some(([url]) => String(url).endsWith("/exchange"))).toBe(false);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("cancels Kiro social authorization before closing", async () => {
    const onClose = vi.fn();
    globalThis.fetch = vi.fn().mockResolvedValue(response({ success: true }));
    const tree = renderKiroModal({
      step: "input",
      authData: { state: "social-close-state" },
      onClose,
    });

    await tree.props.onClose();

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/oauth/google/cancel",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ state: "social-close-state", kind: "kiro-social" }),
      }),
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("cancels Kiro social authorization before changing pools", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(response({ success: true }));
    const tree = renderKiroModal({
      step: "input",
      authData: { state: "social-pool-state" },
    });
    const select = findElement(tree, (node) => node.type?.name === "OAuthProxyPoolSelector");

    await select.props.onChange({ target: { value: "pool-1" } });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/oauth/google/cancel",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ state: "social-pool-state", kind: "kiro-social" }),
      }),
    );
  });

  it("stops device polling on a non-2xx JSON response", async () => {
    vi.useFakeTimers();
    globalThis.fetch = vi.fn(async (url) => {
      const target = String(url);
      if (target.includes("/device-code")) {
        return response({
          flowId: "device-flow",
          expires_in: 60,
          interval: 1,
          verification_uri: "https://auth.example/device",
        });
      }
      if (target.endsWith("/poll")) return response({ error: "server_failure" }, false);
      throw new Error(`Unexpected request: ${target}`);
    });
    renderModal({ provider: "github" });

    harness.effects[1]();
    await flushPromises();
    await vi.advanceTimersByTimeAsync(1_000);

    expect(harness.stateSetters[0]).toHaveBeenCalledWith("error");
    expect(harness.stateSetters[6]).toHaveBeenCalledWith(false);
    expect(globalThis.fetch.mock.calls.filter(([url]) => String(url).endsWith("/poll"))).toHaveLength(1);
  });

  it("surfaces fixed close failure without closing", async () => {
    const onClose = vi.fn();
    globalThis.fetch = vi.fn(async (url) => {
      if (String(url).includes("/stop-proxy")) return response({ error: "Stop failed" }, false);
      throw new Error(`Unexpected request: ${url}`);
    });
    const tree = renderModal({ provider: "codex", authData: { state: "old-state" }, onClose });

    await tree.props.onClose();
    await flushPromises();

    expect(onClose).not.toHaveBeenCalled();
    expect(harness.stateSetters[3]).toHaveBeenCalledWith(
      "OAuth token exchange failed. Restart sign-in and try again.",
    );
    expect(harness.stateSetters[0]).toHaveBeenCalledWith("error");
  });

  it("reopens after one settled fixed close without a duplicate stop failure", async () => {
    const onClose = vi.fn();
    let stopCalls = 0;
    globalThis.fetch = vi.fn(async (url) => {
      const target = String(url);
      if (target.includes("/stop-proxy")) {
        stopCalls += 1;
        return stopCalls === 1
          ? response({ success: true })
          : response({ error: "Session already stopped" }, false);
      }
      if (target.includes("/authorize")) {
        return response({ authUrl: "https://auth.example", state: "new-state" });
      }
      if (target.includes("/start-proxy")) return response({ success: true, serverSide: true });
      throw new Error(`Unexpected request: ${target}`);
    });
    const openTree = renderModal({ provider: "codex", authData: { state: "old-state" }, onClose });

    await openTree.props.onClose();
    const closedTree = renderModal({
      provider: "codex",
      authData: { state: "old-state" },
      isOpen: false,
      onClose,
      preserveRefs: true,
    });
    expect(closedTree).toBeTruthy();
    harness.effects[1]();
    await flushPromises();

    renderModal({ provider: "codex", authData: null, onClose, preserveRefs: true });
    harness.effects[1]();
    await flushPromises();

    expect(stopCalls).toBe(1);
    expect(globalThis.fetch.mock.calls.some(([url]) => String(url).includes("/authorize"))).toBe(true);
  });

  it("surfaces non-2xx fixed status polling responses", async () => {
    vi.useFakeTimers();
    const onSuccess = vi.fn();
    globalThis.fetch = vi.fn().mockResolvedValue(response({ error: "Status unavailable" }, false));
    renderModal({
      provider: "codex",
      authData: { state: "fixed-state", codexServerSide: true },
      onSuccess,
    });

    harness.effects[2]();
    await vi.advanceTimersByTimeAsync(1_500);

    expect(onSuccess).not.toHaveBeenCalled();
    expect(harness.stateSetters[3]).toHaveBeenCalledWith(
      "OAuth token exchange failed. Restart sign-in and try again.",
    );
    expect(harness.stateSetters[0]).toHaveBeenCalledWith("error");
  });

  it("retries terminal acknowledgement without polling or completing twice", async () => {
    vi.useFakeTimers();
    const onSuccess = vi.fn();
    let acknowledgementAttempts = 0;
    globalThis.fetch = vi.fn(async (url) => {
      const target = String(url);
      if (target.endsWith("/poll-status")) {
        return response({ status: "done", connectionId: "connection-1" });
      }
      if (target.endsWith("/ack-status")) {
        acknowledgementAttempts += 1;
        return acknowledgementAttempts === 1
          ? response({ error: "Acknowledgement unavailable" }, false)
          : response({ success: true });
      }
      throw new Error(`Unexpected request: ${target}`);
    });
    renderModal({
      provider: "codex",
      authData: { state: "fixed-state", codexServerSide: true },
      onSuccess,
    });

    harness.effects[2]();
    await vi.advanceTimersByTimeAsync(1_500);
    expect(onSuccess).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_500);

    expect(globalThis.fetch.mock.calls.filter(([url]) => String(url).endsWith("/poll-status"))).toHaveLength(1);
    expect(globalThis.fetch.mock.calls.filter(([url]) => String(url).endsWith("/ack-status"))).toHaveLength(2);
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(harness.stateSetters[0]).toHaveBeenCalledWith("success");
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
