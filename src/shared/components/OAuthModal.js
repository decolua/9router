"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import PropTypes from "prop-types";
import { Modal, Button, Input } from "@/shared/components";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import { isPermittedOAuthOpenerOrigin } from "@/lib/oauth/callbackOrigins";
import { sanitizeOAuthError } from "open-sse/utils/oauthError.js";
import OAuthProxyPoolSelector from "./OAuthProxyPoolSelector";

/**
 * OAuth Modal Component
 * - Localhost: Auto callback via popup message
 * - Remote: Manual paste callback URL
 */
export default function OAuthModal({ isOpen, provider, providerInfo, onSuccess, onClose, oauthMeta, idcConfig, proxyPools = [], proxyPoolsReady = true }) {
  const [step, setStep] = useState("waiting"); // waiting | input | success | error
  const [authData, setAuthData] = useState(null);
  const [callbackUrl, setCallbackUrl] = useState("");
  const [error, setError] = useState(null);
  const [isDeviceCode, setIsDeviceCode] = useState(false);
  const [deviceData, setDeviceData] = useState(null);
  const [polling, setPolling] = useState(false);
  const [selectedProxyPoolId, setSelectedProxyPoolId] = useState("");
  const popupRef = useRef(null);
  const flowGenerationRef = useRef(0);
  const openedRef = useRef(false);
  const proxyStopPromiseRef = useRef(Promise.resolve());
  const poolChangePromiseRef = useRef(Promise.resolve());
  const fixedProxyStateRef = useRef(null);
  const devicePollFlowRef = useRef(null);
  const { copied, copy } = useCopyToClipboard();

  // State for client-only values to avoid hydration mismatch
  const [isLocalhost, setIsLocalhost] = useState(false);
  const [placeholderUrl, setPlaceholderUrl] = useState("/callback?code=...");
  const callbackProcessedRef = useRef(false);

  const stopFixedProxy = useCallback((stateOverride = null) => {
    if (provider !== "codex" && provider !== "xai") return Promise.resolve();
    const state = stateOverride || fixedProxyStateRef.current || authData?.state;
    const pending = fetch(`/api/oauth/${provider}/stop-proxy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state }),
    }).then(async (response) => {
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.error || "Failed to stop OAuth callback server");
        }
        if (!state || fixedProxyStateRef.current === state) fixedProxyStateRef.current = null;
        return response;
      });
    proxyStopPromiseRef.current = pending;
    return pending;
  }, [authData?.state, provider]);

  const cancelDevicePoll = useCallback(() => {
    const flowId = devicePollFlowRef.current;
    if (!flowId) return Promise.resolve();
    return fetch(`/api/oauth/${provider}/cancel-poll`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ flowId }),
    }).then(async (response) => {
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "Failed to cancel device authorization");
      }
      if (devicePollFlowRef.current === flowId) devicePollFlowRef.current = null;
    });
  }, [provider]);

  // Detect if running on localhost (client-side only)
  useEffect(() => {
    if (typeof window !== "undefined") {
      /* eslint-disable react-hooks/set-state-in-effect -- client-only values intentionally update after hydration */
      setIsLocalhost(
        window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
      );
      setPlaceholderUrl(`${window.location.origin}/callback?code=...`);
      /* eslint-enable react-hooks/set-state-in-effect */
    }
  }, []);

  // Define all useCallback hooks BEFORE the useEffects that reference them

  // Exchange tokens
  const exchangeTokens = useCallback(async (code, state) => {
    if (!authData) return;
    try {
      const res = await fetch(`/api/oauth/${provider}/exchange`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code,
          state: state || authData.state,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setStep("success");
      onSuccess?.();
    } catch (err) {
      setError(err.message);
      setStep("error");
    }
  }, [authData, provider, onSuccess]);

  const completeXaiManualCode = useCallback(async (code) => {
    if (!authData?.state) return;
    try {
      const res = await fetch("/api/oauth/xai/manual-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, state: authData.state }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setStep("success");
      onSuccess?.();
    } catch (err) {
      setError(err.message);
      setStep("error");
    }
  }, [authData, onSuccess]);

  // Poll for device code token
  const startPolling = useCallback(async (deviceCode, codeVerifier, interval, extraData, deadlineMs, proxyPoolId, generation, flowId) => {
    if (generation !== flowGenerationRef.current) return;
    setPolling(true);
    // Honor the upstream's expires_in when supplied (qoder sets 300s) so we
    // don't time out earlier than the device code itself. Default 120s
    // matches the prior behavior for providers that don't surface a value.
    const startedAt = Date.now();
    const deadline = startedAt + (Number.isFinite(deadlineMs) && deadlineMs > 0 ? deadlineMs : 120_000);

    while (Date.now() < deadline) {
      if (generation !== flowGenerationRef.current) return;

      await new Promise((r) => setTimeout(r, interval * 1000));

      if (generation !== flowGenerationRef.current) return;

      try {
        const res = await fetch(`/api/oauth/${provider}/poll`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ deviceCode, codeVerifier, extraData, proxyPoolId, flowId }),
        });

        const data = await res.json();
        if (generation !== flowGenerationRef.current) return;

        if (data.success) {
          if (devicePollFlowRef.current === flowId) devicePollFlowRef.current = null;
          setStep("success");
          setPolling(false);
          onSuccess?.();
          return;
        }

        if (data.error === "expired_token" || data.error === "access_denied") {
          throw new Error(sanitizeOAuthError(data.errorDescription || data.error));
        }

        if (data.error === "slow_down") {
          interval = Math.min(interval + 5, 30);
        }
      } catch (err) {
        if (generation !== flowGenerationRef.current) return;
        if (devicePollFlowRef.current === flowId) devicePollFlowRef.current = null;
        setError(err.message);
        setStep("error");
        setPolling(false);
        return;
      }
    }

    if (generation !== flowGenerationRef.current) return;
    if (devicePollFlowRef.current === flowId) devicePollFlowRef.current = null;
    setError("Authorization timeout");
    setStep("error");
    setPolling(false);
  }, [provider, onSuccess]);

  // Start OAuth flow
  const startOAuthFlow = useCallback(async (proxyPoolId = selectedProxyPoolId, generation = ++flowGenerationRef.current) => {
    if (!provider) return;
    const isStale = () => generation !== flowGenerationRef.current;
    try {
      await proxyStopPromiseRef.current;
      if (isStale()) return;
      setError(null);

      // Device code flow providers (must match oauth providers with flowType: "device_code")
      const deviceCodeProviders = [
        "github",
        "qwen",
        "kiro",
        "kimi",
        "kimi-coding",
        "kilocode",
        "codebuddy-cn",
        "qoder",
        "grok-cli",
      ];
      if (deviceCodeProviders.includes(provider)) {
        setIsDeviceCode(true);
        setStep("waiting");

        const deviceCodeUrl = new URL(`/api/oauth/${provider}/device-code`, window.location.origin);
        if (proxyPoolId) {
          deviceCodeUrl.searchParams.set("proxyPoolId", proxyPoolId);
        }
        if (provider === "kiro" && idcConfig?.startUrl) {
          deviceCodeUrl.searchParams.set("start_url", idcConfig.startUrl);
          if (idcConfig.region) {
            deviceCodeUrl.searchParams.set("region", idcConfig.region);
          }
          deviceCodeUrl.searchParams.set("auth_method", "idc");
        }
        const res = await fetch(deviceCodeUrl.toString());
        const data = await res.json();
        if (isStale()) return;
        if (!res.ok) throw new Error(data.error);

        setDeviceData(data);

        // Auto-open verification URL in new tab
        const verifyUrl = data.verification_uri_complete || data.verification_uri;
        if (verifyUrl) window.open(verifyUrl, "_blank", "noopener,noreferrer");

        // Pass extraData for Kiro (contains _clientId, _clientSecret) and
        // Qoder (contains _qoderMachineId / _qoderNonce — needed so mapTokens
        // can persist the machine id alongside the token).
        const extraData = provider === "kiro"
          ? {
              _clientId: data._clientId,
              _clientSecret: data._clientSecret,
              _region: data._region,
              _authMethod: data._authMethod,
              _startUrl: data._startUrl,
            }
          : provider === "qoder"
          ? {
              _qoderNonce: data._qoderNonce,
              _qoderMachineId: data._qoderMachineId,
              _qoderVerifier: data.codeVerifier,
            }
          : (provider === "kimi" || provider === "kimi-coding")
          ? { _kimiDeviceId: data._kimiDeviceId }
          : null;
        const flowId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        devicePollFlowRef.current = flowId;
        startPolling(
          data.device_code,
          data.codeVerifier,
          data.interval || 5,
          extraData,
          // Use the upstream's expires_in if present so we don't time out
          // before the device code itself (qoder gives 300s).
          Number.isFinite(data.expires_in) && data.expires_in > 0
            ? data.expires_in * 1000
            : undefined,
          proxyPoolId,
          generation,
          flowId,
        );
        return;
      }

      // Authorization code flow - build redirect URI (some providers require fixed ports)
      const appPort = window.location.port || (window.location.protocol === "https:" ? "443" : "80");
      let redirectUri;
      if (provider === "codex") {
        redirectUri = "http://localhost:1455/auth/callback";
      } else if (provider === "xai") {
        redirectUri = "http://127.0.0.1:56121/callback";
      } else {
        redirectUri = `http://localhost:${appPort}/callback`;
      }

      // Build authorize URL first to get codeVerifier/state for codex server-side mode
      const authorizeUrl = new URL(`/api/oauth/${provider}/authorize`, window.location.origin);
      authorizeUrl.searchParams.set("redirect_uri", redirectUri);
      if (proxyPoolId) {
        authorizeUrl.searchParams.set("proxyPoolId", proxyPoolId);
      }
      if (oauthMeta) {
        Object.entries(oauthMeta).forEach(([k, v]) => { if (v) authorizeUrl.searchParams.set(k, v); });
      }
      const res = await fetch(authorizeUrl.toString());
      const data = await res.json();
      if (isStale()) return;
      if (!res.ok) throw new Error(data.error);
      if (provider === "codex" || provider === "xai") fixedProxyStateRef.current = data.state;
      setAuthData({ ...data, redirectUri, codexServerSide: false, xaiServerSide: false });

      // Codex: start proxy with server-side session (auto-exchange) + fallback to channels
      let codexProxyActive = false;
      let codexServerSide = false;
      if (provider === "codex") {
        try {
          const proxyRes = await fetch(`/api/oauth/codex/start-proxy`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ appPort, state: data.state }),
          });
          const proxyData = await proxyRes.json();
          if (isStale()) {
            await stopFixedProxy(data.state);
            return;
          }
          codexProxyActive = proxyData.success;
          codexServerSide = !!proxyData.serverSide;
        } catch {
          codexProxyActive = false;
        }
      }

      // xAI: same fixed-port server-side proxy pattern as codex (port 56121)
      let xaiProxyActive = false;
      let xaiServerSide = false;
      if (provider === "xai") {
        try {
          const proxyRes = await fetch(`/api/oauth/xai/start-proxy`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ appPort, state: data.state }),
          });
          const proxyData = await proxyRes.json();
          if (isStale()) {
            await stopFixedProxy(data.state);
            return;
          }
          xaiProxyActive = proxyData.success;
          xaiServerSide = !!proxyData.serverSide;
          if (!xaiProxyActive && proxyData.reason === "port_busy") {
            throw new Error("Port 56121 in use; close the conflicting process and retry");
          }
        } catch (e) {
          if (e?.message) throw e;
          xaiProxyActive = false;
        }
      }

      if (isStale()) return;
      setAuthData({ ...data, redirectUri, codexServerSide, xaiServerSide });

      // Guard: device_code providers return authUrl:null from /authorize. Never window.open(null)
      // (browsers coerce it to the relative path ".../null").
      if (!data.authUrl) {
        if (data.flowType === "device_code") {
          throw new Error(
            `Provider ${provider} uses device-code login but is not wired in the OAuth modal device-code list`
          );
        }
        throw new Error("No authorization URL returned from OAuth provider");
      }

      if (provider === "codex" && codexProxyActive) {
        // Proxy active: callback will be handled server-side (auto-exchange) or via channels (fallback)
        setStep("waiting");
        popupRef.current = window.open(data.authUrl, "oauth_popup", "width=600,height=700");
        if (!popupRef.current) {
          setStep("input");
        }
      } else if (provider === "xai" && xaiProxyActive) {
        setStep("waiting");
        popupRef.current = window.open(data.authUrl, "oauth_popup", "width=600,height=700");
        if (!popupRef.current) {
          setStep("input");
        }
      } else if (!isLocalhost || provider === "codex" || provider === "xai") {
        // Non-localhost or proxy failed: manual input mode
        setStep("input");
        window.open(data.authUrl, "_blank");
      } else {
        // Localhost (non-Codex/xAI): Open popup and wait for message
        setStep("waiting");
        popupRef.current = window.open(data.authUrl, "oauth_popup", "width=600,height=700");
        if (!popupRef.current) {
          setStep("input");
        }
      }
    } catch (err) {
      if (isStale()) return;
      setError(err.message);
      setStep("error");
    }
  }, [provider, isLocalhost, startPolling, oauthMeta, idcConfig, selectedProxyPoolId, stopFixedProxy]);

  // Reset state and start OAuth when modal opens
  useEffect(() => {
    if (isOpen && provider) {
      if (!proxyPoolsReady) return;
      // Guard against StrictMode/effect re-runs auto-opening multiple tabs.
      if (openedRef.current) return;
      openedRef.current = true;
      setAuthData(null);
      setCallbackUrl("");
      setError(null);
      setIsDeviceCode(false);
      setDeviceData(null);
      setPolling(false);
      setSelectedProxyPoolId("");
      startOAuthFlow("");
    } else if (!isOpen) {
      // Abort polling and cleanup proxy when modal closes
      flowGenerationRef.current += 1;
      openedRef.current = false;
      cancelDevicePoll().catch(() => {});
      stopFixedProxy().catch(() => {});
    }
  }, [isOpen, provider, startOAuthFlow, proxyPools, proxyPoolsReady, cancelDevicePoll, stopFixedProxy]);

  const restartOAuthFlow = (proxyPoolId) => {
    const generation = ++flowGenerationRef.current;
    setSelectedProxyPoolId(proxyPoolId);
    setPolling(false);

    const transition = poolChangePromiseRef.current
      .catch(() => {})
      .then(async () => {
        try {
          await cancelDevicePoll();
          await stopFixedProxy();
          if (generation !== flowGenerationRef.current) return;
          setAuthData(null);
          setCallbackUrl("");
          setError(null);
          setIsDeviceCode(false);
          setDeviceData(null);
          await startOAuthFlow(proxyPoolId, generation);
        } catch (err) {
          if (generation !== flowGenerationRef.current) return;
          setPolling(false);
          setError(err.message);
          setStep("error");
        }
      });
    poolChangePromiseRef.current = transition;
    return transition;
  };

  const handleProxyPoolChange = (event) => restartOAuthFlow(event.target.value);

  // Fixed-port server-side mode: poll status (proxy auto-exchanges + saves DB)
  useEffect(() => {
    const pollProvider = authData?.codexServerSide ? "codex" : authData?.xaiServerSide ? "xai" : null;
    if (!pollProvider || !authData?.state) return;
    if (callbackProcessedRef.current) return;
    let cancelled = false;
    const POLL_INTERVAL_MS = 1500;
    const MAX_ATTEMPTS = 200; // ~5 minutes
    let attempts = 0;

    const tick = async () => {
      if (cancelled || callbackProcessedRef.current) return;
      attempts += 1;
      try {
        const res = await fetch(`/api/oauth/${pollProvider}/poll-status`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ state: authData.state }),
        });
        const data = await res.json();
        if (cancelled || callbackProcessedRef.current) return;
        if (data.status === "done") {
          callbackProcessedRef.current = true;
          setStep("success");
          onSuccess?.();
          return;
        }
        if (data.status === "error") {
          callbackProcessedRef.current = true;
          setError(data.error || "Authentication failed");
          setStep("error");
          return;
        }
      } catch {
        // Network error, keep polling
      }
      if (attempts >= MAX_ATTEMPTS) {
        callbackProcessedRef.current = true;
        setError("Authentication timeout");
        setStep("error");
        return;
      }
      setTimeout(tick, POLL_INTERVAL_MS);
    };
    setTimeout(tick, POLL_INTERVAL_MS);
    return () => { cancelled = true; };
  }, [authData, onSuccess]);

  // Listen for OAuth callback via multiple methods
  useEffect(() => {
    if (!authData) return;
    callbackProcessedRef.current = false; // Reset when authData changes

    // Handler for callback data - only process once
    const handleCallback = async (data) => {
      if (callbackProcessedRef.current) return; // Already processed

      const { code, token, state, error: callbackError, errorDescription } = data;

      const stateRequired = !["cline", "clinepass", "kimchi"].includes(provider);
      if (stateRequired && (!state || state !== authData.state)) {
        callbackProcessedRef.current = true;
        setError("OAuth state mismatch; restart sign-in");
        setStep("error");
        return;
      }

      if (callbackError) {
        callbackProcessedRef.current = true;
        setError(sanitizeOAuthError(errorDescription || callbackError));
        setStep("error");
        return;
      }

      if (token || code) {
        callbackProcessedRef.current = true;
        await exchangeTokens(token || code, state);
      }
    };

    const handleMessage = (event) => {
      if (event.source !== popupRef.current) return;
      if (!isPermittedOAuthOpenerOrigin(event.origin, window.location.origin)) return;
      
      if (event.data?.type === "oauth_callback") {
        handleCallback(event.data.data);
      }
    };
    window.addEventListener("message", handleMessage);

    return () => {
      window.removeEventListener("message", handleMessage);
    };
  }, [authData, exchangeTokens, provider]);

  // Handle manual URL input
  const handleManualSubmit = async () => {
    try {
      setError(null);

      const input = callbackUrl.trim();

      // Detect raw JWT access token (starts with eyJ) — skip URL parsing
      if (input.startsWith("eyJ") && input.includes(".")) {
        await exchangeTokens(input, null);
        return;
      }

      if (provider === "xai" && input && !input.includes("://") && !input.includes("?") && !input.includes("code=")) {
        await completeXaiManualCode(input);
        return;
      }

      if (provider === "kimchi" && input && !input.includes("://") && !input.includes("?")) {
        await exchangeTokens(input, null);
        return;
      }

      let url;
      try {
        url = new URL(input);
      } catch {
        throw new Error("Invalid callback URL");
      }
      const code = url.searchParams.get("code");
      const token = url.searchParams.get("token");
      const state = url.searchParams.get("state");
      const errorParam = url.searchParams.get("error");

      const stateRequired = !["cline", "clinepass", "kimchi"].includes(provider);
      if (stateRequired && (!state || state !== authData?.state)) {
        throw new Error("OAuth state mismatch; restart sign-in");
      }

      if (errorParam) {
        throw new Error(sanitizeOAuthError(url.searchParams.get("error_description") || errorParam));
      }

      if (!code && !token) {
        throw new Error(
          provider === "xai"
            ? "Paste the callback URL or copied xAI code"
            : provider === "kimchi"
              ? "No Kimchi token found in URL"
              : "No authorization code found in URL"
        );
      }

      await exchangeTokens(token || code, state);
    } catch (err) {
      setError(err.message);
      setStep("error");
    }
  };

  // Clear session on modal close + cleanup proxy
  const handleClose = useCallback(() => {
    flowGenerationRef.current += 1;
    cancelDevicePoll().catch(() => {});
    stopFixedProxy().catch(() => {});
    onClose();
  }, [cancelDevicePoll, onClose, stopFixedProxy]);

  if (!provider || !providerInfo) return null;
  const isXaiProvider = provider === "xai";
  const isKimchiProvider = provider === "kimchi";
  const deviceLoginUrl = deviceData?.verification_uri_complete || deviceData?.verification_uri || "";
  const modalTitle = isXaiProvider ? "Connect Grok Build OAuth" : `Connect ${providerInfo.name}`;
  const manualPlaceholder = isXaiProvider
    ? "http://127.0.0.1:56121/callback?code=... or copied code"
    : isKimchiProvider
      ? `${placeholderUrl.replace("code=...", "token=...")} or copied token`
      : placeholderUrl;

  return (
    <Modal isOpen={isOpen} title={modalTitle} onClose={handleClose} size="lg">
      <div className="flex flex-col gap-4">
        <OAuthProxyPoolSelector
          value={selectedProxyPoolId}
          onChange={handleProxyPoolChange}
          proxyPools={proxyPools}
          proxyPoolsReady={proxyPoolsReady}
          visible={step === "waiting" || step === "input"}
        />

        {/* Waiting + Manual Input combined (non-device-code) */}
        {(step === "waiting" || step === "input") && !isDeviceCode && (
          <>
            {/* Option A: Auto via popup */}
            <div className="flex flex-col gap-2 px-3 py-2 border border-border rounded-lg bg-sidebar/50">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-base text-primary animate-spin">
                  progress_activity
                </span>
                <span className="text-sm">
                  {isXaiProvider ? "Waiting for Grok Build OAuth…" : "Waiting for popup authorization…"}
                </span>
              </div>
              {authData?.authUrl && (
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input value={authData.authUrl} readOnly className="min-w-0 flex-1 font-mono text-xs" />
                  <Button variant="secondary" icon={copied === "auth_url" ? "check" : "content_copy"} onClick={() => copy(authData.authUrl, "auth_url")}>
                    Copy
                  </Button>
                  <Button variant="ghost" icon="open_in_new" onClick={() => window.open(authData.authUrl, "_blank", "noopener,noreferrer")}>
                    Open
                  </Button>
                </div>
              )}
            </div>

            {/* Divider */}
            <div className="flex items-center gap-3 my-1">
              <div className="flex-1 h-px bg-border" />
              <span className="text-xs text-text-muted uppercase tracking-wider">Paste callback URL manually</span>
              <div className="flex-1 h-px bg-border" />
            </div>

            {/* Option B: Manual paste */}
            <div>
              <p className="text-sm font-medium mb-2">
                Paste the {provider === "xai" ? "callback URL or copied code" : isKimchiProvider ? "callback URL or copied token" : "callback URL"} here
              </p>
              <p className="text-xs text-text-muted mb-2">
                {provider === "xai"
                  ? "If xAI shows a code instead of redirecting, paste that code here."
                  : isKimchiProvider
                    ? "After authorization, copy the full callback URL or token from your browser."
                  : "After authorization, copy the full URL from your browser."}
              </p>
              <Input
                value={callbackUrl}
                onChange={(e) => setCallbackUrl(e.target.value)}
                placeholder={manualPlaceholder}
                className="font-mono text-xs"
              />
            </div>

            <div className="flex gap-2">
              <Button onClick={handleManualSubmit} fullWidth disabled={!callbackUrl}>
                Connect
              </Button>
              <Button onClick={handleClose} variant="ghost" fullWidth>
                Cancel
              </Button>
            </div>
          </>
        )}

        {/* Device Code Flow - Waiting */}
        {step === "waiting" && isDeviceCode && deviceData && (
          <>
            <div className="text-center py-4">
              <p className="text-sm text-text-muted mb-4">
                Visit the login URL below and authorize:
              </p>
              <div className="bg-sidebar p-4 rounded-lg mb-4">
                <p className="text-xs text-text-muted mb-1">Login URL</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-sm break-all">{deviceLoginUrl}</code>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={copied === "login_url" ? "check" : "content_copy"}
                    onClick={() => copy(deviceLoginUrl, "login_url")}
                    disabled={!deviceLoginUrl}
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    icon="open_in_new"
                    onClick={() => window.open(deviceLoginUrl, "_blank", "noopener,noreferrer")}
                    disabled={!deviceLoginUrl}
                  >
                    Open
                  </Button>
                </div>
              </div>
              <div className="bg-primary/10 p-4 rounded-lg">
                <p className="text-xs text-text-muted mb-1">Your Code</p>
                <div className="flex items-center justify-center gap-2">
                  <p className="text-2xl font-mono font-bold text-primary">{deviceData.user_code}</p>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={copied === "user_code" ? "check" : "content_copy"}
                    onClick={() => copy(deviceData.user_code, "user_code")}
                  />
                </div>
              </div>
            </div>
            {polling && (
              <div className="flex items-center justify-center gap-2 text-sm text-text-muted">
                <span className="material-symbols-outlined animate-spin">progress_activity</span>
                Waiting for authorization...
              </div>
            )}
          </>
        )}

        {/* Success Step */}
        {step === "success" && (
          <div className="text-center py-6">
            <div className="size-16 mx-auto mb-4 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
              <span className="material-symbols-outlined text-3xl text-green-600">check_circle</span>
            </div>
            <h3 className="text-lg font-semibold mb-2">Connected Successfully!</h3>
            <p className="text-sm text-text-muted mb-4">
              Your {providerInfo.name} account has been connected.
            </p>
            <Button onClick={handleClose} fullWidth>
              Done
            </Button>
          </div>
        )}

        {/* Error Step */}
        {step === "error" && (
          <div className="text-center py-6">
            <div className="size-16 mx-auto mb-4 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
              <span className="material-symbols-outlined text-3xl text-red-600">error</span>
            </div>
            <h3 className="text-lg font-semibold mb-2">Connection Failed</h3>
            <p className="text-sm text-red-600 mb-4">{error}</p>
            <div className="flex gap-2">
              <Button onClick={() => restartOAuthFlow(selectedProxyPoolId)} variant="secondary" fullWidth>
                Try Again
              </Button>
              <Button onClick={handleClose} variant="ghost" fullWidth>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

OAuthModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  provider: PropTypes.string,
  providerInfo: PropTypes.shape({ name: PropTypes.string }),
  onSuccess: PropTypes.func,
  onClose: PropTypes.func.isRequired,
  /** Extra metadata passed to /authorize and /exchange (e.g. gitlab clientId/baseUrl) */
  oauthMeta: PropTypes.object,
  /** Optional Kiro IDC config for AWS IAM Identity Center device flow */
  idcConfig: PropTypes.shape({
    startUrl: PropTypes.string,
    region: PropTypes.string,
  }),
  proxyPools: PropTypes.arrayOf(PropTypes.shape({
    id: PropTypes.string,
    name: PropTypes.string,
    isActive: PropTypes.bool,
  })),
  proxyPoolsReady: PropTypes.bool,
};
