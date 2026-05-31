"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import PropTypes from "prop-types";
import { Modal, Button, Input } from "@/shared/components";

const HCAPTCHA_SITEKEY = "c646a2ec-0a3e-415c-affe-c502978ede9c";
const HCAPTCHA_SCRIPT_SRC = "https://js.hcaptcha.com/1/api.js?render=explicit";

let hcaptchaScriptPromise = null;
function loadHCaptchaScript() {
  if (typeof window === "undefined") return Promise.reject(new Error("SSR"));
  if (window.hcaptcha) return Promise.resolve(window.hcaptcha);
  if (hcaptchaScriptPromise) return hcaptchaScriptPromise;
  hcaptchaScriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src^="${HCAPTCHA_SCRIPT_SRC}"]`);
    const onReady = () => {
      if (window.hcaptcha) resolve(window.hcaptcha);
      else reject(new Error("hCaptcha failed to initialize"));
    };
    if (existing) {
      existing.addEventListener("load", onReady, { once: true });
      existing.addEventListener("error", () => reject(new Error("hCaptcha script load error")), { once: true });
      if (window.hcaptcha) onReady();
      return;
    }
    const s = document.createElement("script");
    s.src = HCAPTCHA_SCRIPT_SRC;
    s.async = true;
    s.defer = true;
    s.onload = onReady;
    s.onerror = () => reject(new Error("hCaptcha script load error"));
    document.head.appendChild(s);
  });
  return hcaptchaScriptPromise;
}

function MethodCard({ icon, title, desc, onSelect }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="w-full p-4 text-left border border-border rounded-lg hover:bg-sidebar transition-colors"
    >
      <div className="flex items-start gap-3">
        <span className="material-symbols-outlined text-primary mt-0.5">{icon}</span>
        <div className="flex-1">
          <h3 className="font-semibold mb-1">{title}</h3>
          <p className="text-sm text-text-muted">{desc}</p>
        </div>
      </div>
    </button>
  );
}

MethodCard.propTypes = {
  icon: PropTypes.string.isRequired,
  title: PropTypes.string.isRequired,
  desc: PropTypes.string.isRequired,
  onSelect: PropTypes.func.isRequired,
};


/**
 * Pioneer AI Auth Method Selection Modal.
 *
 * Three login paths funnel into a single long-lived pio_sk_ API key:
 *   1. apikey   — paste an existing pio_sk_... key
 *   2. import   — paste Supabase refresh_token (sb-db-auth-token.refresh_token)
 *   3. password — email + password (single or bulk combo)
 *
 * The key is validated/minted server-side and persisted as the connection's
 * apiKey so all downstream inference paths only need a static header.
 */
export default function PioneerAuthModal({ isOpen, onClose, onSuccess }) {
  const [method, setMethod] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  // apikey
  const [apiKey, setApiKey] = useState("");
  const [apiKeyName, setApiKeyName] = useState("");

  // import
  const [refreshToken, setRefreshToken] = useState("");
  const [importName, setImportName] = useState("");

  // password
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [combo, setCombo] = useState("");
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkResult, setBulkResult] = useState(null);

  // hCaptcha (required by Pioneer for password sign-in only)
  const [captchaToken, setCaptchaToken] = useState("");
  const [captchaError, setCaptchaError] = useState(null);
  const captchaContainerRef = useRef(null);
  const captchaWidgetIdRef = useRef(null);

  const reset = () => {
    setMethod(null);
    setError(null);
    setBulkResult(null);
    setApiKey("");
    setApiKeyName("");
    setRefreshToken("");
    setImportName("");
    setEmail("");
    setPassword("");
    setCombo("");
    setBulkMode(false);
    setCaptchaToken("");
    setCaptchaError(null);
    if (captchaWidgetIdRef.current != null && typeof window !== "undefined" && window.hcaptcha) {
      try { window.hcaptcha.reset(captchaWidgetIdRef.current); } catch { /* ignore */ }
    }
  };

  const resetCaptchaWidget = useCallback(() => {
    setCaptchaToken("");
    if (captchaWidgetIdRef.current != null && typeof window !== "undefined" && window.hcaptcha) {
      try { window.hcaptcha.reset(captchaWidgetIdRef.current); } catch { /* ignore */ }
    }
  }, []);

  // Mount hCaptcha widget when password method opens
  useEffect(() => {
    if (!isOpen || method !== "password") return undefined;
    let cancelled = false;
    loadHCaptchaScript()
      .then((hcaptcha) => {
        if (cancelled || !captchaContainerRef.current) return;
        if (captchaWidgetIdRef.current == null) {
          captchaWidgetIdRef.current = hcaptcha.render(captchaContainerRef.current, {
            sitekey: HCAPTCHA_SITEKEY,
            theme: "light",
            callback: (token) => { setCaptchaToken(token); setCaptchaError(null); },
            "expired-callback": () => setCaptchaToken(""),
            "error-callback": () => setCaptchaError("hCaptcha error. Refresh the modal and try again."),
          });
        } else {
          try { hcaptcha.reset(captchaWidgetIdRef.current); } catch { /* ignore */ }
        }
      })
      .catch((e) => { if (!cancelled) setCaptchaError(e.message || "Failed to load hCaptcha"); });
    return () => { cancelled = true; };
  }, [isOpen, method]);

  // Reset widget id when modal fully closes so next open re-renders cleanly
  useEffect(() => {
    if (!isOpen) {
      captchaWidgetIdRef.current = null;
    }
  }, [isOpen]);

  const handleClose = () => {
    if (submitting) return;
    reset();
    onClose?.();
  };

  const submit = async (path, body) => {
    setSubmitting(true);
    setError(null);
    setBulkResult(null);
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || `Request failed (${res.status})`);
      }
      return data;
    } catch (e) {
      setError(e.message);
      return null;
    } finally {
      setSubmitting(false);
    }
  };

  const handleApiKey = async () => {
    if (!apiKey.trim()) return setError("API key is required");
    if (!apiKey.trim().startsWith("pio_sk_")) {
      return setError("Invalid format. Pioneer keys start with pio_sk_");
    }
    const data = await submit("/api/oauth/pioneer/apikey", {
      apiKey: apiKey.trim(),
      name: apiKeyName.trim() || undefined,
    });
    if (data?.success) {
      reset();
      onSuccess?.(data.connection);
    }
  };

  const handleImport = async () => {
    if (!refreshToken.trim()) return setError("Refresh token is required");
    const data = await submit("/api/oauth/pioneer/import-token", {
      refreshToken: refreshToken.trim(),
      name: importName.trim() || undefined,
    });
    if (data?.success) {
      reset();
      onSuccess?.(data.connection);
    }
  };

  const handlePassword = async () => {
    if (!captchaToken) {
      return setError("Complete the hCaptcha challenge below before signing in.");
    }
    if (bulkMode) {
      if (!combo.trim()) return setError("Paste at least one email:password line");
      const data = await submit("/api/oauth/pioneer/login", { combo, captchaToken });
      // Bulk: each entry consumes one captcha token. Pioneer/Supabase rejects
      // reuse, so we reset the widget after every bulk attempt and let the
      // user re-solve for the next batch.
      resetCaptchaWidget();
      if (data) {
        if (data.added > 0) {
          setBulkResult(data);
          if (data.failed === 0) {
            setTimeout(() => { reset(); onSuccess?.(); }, 800);
          } else {
            onSuccess?.();
          }
        } else {
          setError(data.captchaRequired
            ? "Captcha verification required for each entry. Solve the challenge below and retry."
            : "All entries failed. Check credentials and try again.");
          setBulkResult(data);
        }
      }
      return;
    }
    if (!email.trim() || !password) {
      return setError("Email and password are required");
    }
    const data = await submit("/api/oauth/pioneer/login", {
      email: email.trim(),
      password,
      captchaToken,
    });
    // Single: reset captcha so a retry after error still works (token is single-use).
    resetCaptchaWidget();
    if (data?.success) {
      reset();
      onSuccess?.(data.connection);
    }
  };

  const pickMethod = (id) => () => { setMethod(id); setError(null); };

  return (
    <Modal isOpen={isOpen} title="Connect Pioneer AI" onClose={handleClose} size="lg">
      <div className="flex flex-col gap-4">
        {!method && (
          <div className="space-y-3">
            <p className="text-sm text-text-muted mb-2">
              Pioneer AI by Fastino Labs. Choose how to add your account.
              All paths produce a long-lived <code>pio_sk_</code> API key.
            </p>
            <MethodCard
              icon="key"
              title="API Key (Recommended)"
              desc="Paste an existing pio_sk_ key from Settings → API Keys."
              onSelect={pickMethod("apikey")}
            />
            <MethodCard
              icon="file_upload"
              title="Import Refresh Token"
              desc="Paste sb-db-auth-token.refresh_token from agent.pioneer.ai's localStorage. We mint a fresh API key automatically."
              onSelect={pickMethod("import")}
            />
            <MethodCard
              icon="account_circle"
              title="Email + Password"
              desc="Sign in with email/password. Supports bulk via email:pass lines."
              onSelect={pickMethod("password")}
            />
          </div>
        )}

        {method && (
          <button
            type="button"
            onClick={() => { setMethod(null); setError(null); setBulkResult(null); }}
            className="self-start text-xs text-text-muted hover:text-primary inline-flex items-center gap-1"
            disabled={submitting}
          >
            <span className="material-symbols-outlined text-sm">arrow_back</span>
            Back
          </button>
        )}

        {method === "apikey" && (
          <div className="space-y-3">
            <Input
              label="Pioneer API Key"
              type="password"
              placeholder="pio_sk_..."
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              hint="Get one at agent.pioneer.ai → Settings → API Keys."
              required
            />
            <Input
              label="Display name (optional)"
              placeholder="e.g. Pioneer Main"
              value={apiKeyName}
              onChange={(e) => setApiKeyName(e.target.value)}
            />
            <Button onClick={handleApiKey} loading={submitting} disabled={submitting} icon="add">
              Add Account
            </Button>
          </div>
        )}

        {method === "import" && (
          <div className="space-y-3">
            <div className="text-xs text-text-muted bg-bg border border-border rounded-md p-3 space-y-1">
              <p className="font-medium text-text">How to extract:</p>
              <ol className="list-decimal list-inside space-y-1">
                <li>Login to <code>https://agent.pioneer.ai</code></li>
                <li>Open DevTools (F12) → Console</li>
                <li>Run: <code>JSON.parse(localStorage.getItem(&apos;sb-db-auth-token&apos;)).refresh_token</code></li>
                <li>Copy the result and paste below</li>
              </ol>
            </div>
            <Input
              label="Supabase Refresh Token"
              type="password"
              placeholder="v1.M... (or paste full sb-db-auth-token JSON)"
              value={refreshToken}
              onChange={(e) => setRefreshToken(e.target.value)}
              required
            />
            <Input
              label="Display name (optional)"
              placeholder="e.g. Pioneer Imported"
              value={importName}
              onChange={(e) => setImportName(e.target.value)}
            />
            <Button onClick={handleImport} loading={submitting} disabled={submitting} icon="file_upload">
              Import & Mint Key
            </Button>
          </div>
        )}

        {method === "password" && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => { setBulkMode(false); setError(null); }}
                className={`px-3 py-1.5 text-sm rounded-md border transition-colors ${
                  !bulkMode ? "bg-primary text-white border-primary" : "border-border hover:bg-sidebar"
                }`}
              >
                Single
              </button>
              <button
                type="button"
                onClick={() => { setBulkMode(true); setError(null); }}
                className={`px-3 py-1.5 text-sm rounded-md border transition-colors ${
                  bulkMode ? "bg-primary text-white border-primary" : "border-border hover:bg-sidebar"
                }`}
              >
                Bulk (email:pass per line)
              </button>
            </div>

            {!bulkMode && (
              <>
                <Input
                  label="Email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
                <Input
                  label="Password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </>
            )}

            {bulkMode && (
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium">Combo (email:password per line)</label>
                <textarea
                  className="w-full min-h-[140px] rounded-md border border-border bg-bg p-3 text-sm font-mono"
                  placeholder={"alice@example.com:Secret123\nbob@example.com:Hunter2"}
                  value={combo}
                  onChange={(e) => setCombo(e.target.value)}
                />
                <p className="text-xs text-text-muted">
                  Each line creates one account. Failures are reported per-line; successes are added immediately.
                </p>
              </div>
            )}

            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium">
                hCaptcha verification <span className="text-red-500">*</span>
              </label>
              <div ref={captchaContainerRef} className="min-h-[78px]" />
              <p className="text-xs text-text-muted">
                Pioneer requires hCaptcha for password sign-in. Each token is single-use.
              </p>
              {captchaError && (
                <p className="text-xs text-red-500">{captchaError}</p>
              )}
            </div>

            <Button
              onClick={handlePassword}
              loading={submitting}
              disabled={submitting || !captchaToken}
              icon="login"
            >
              {bulkMode ? "Sign In All & Mint Keys" : "Sign In & Mint Key"}
            </Button>

            {bulkResult && (
              <div className="text-xs bg-bg border border-border rounded-md p-3 space-y-1">
                <p className="font-medium">
                  {bulkResult.added}/{bulkResult.total} added
                  {bulkResult.failed > 0 ? `, ${bulkResult.failed} failed` : ""}
                </p>
                {bulkResult.results?.filter((r) => !r.success).slice(0, 5).map((r, i) => (
                  <p key={i} className="text-red-500 truncate">
                    ✗ {r.email}: {r.error}
                  </p>
                ))}
              </div>
            )}
          </div>
        )}

        {error && (
          <div className="p-3 rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-sm text-red-600 dark:text-red-400">
            {error}
          </div>
        )}
      </div>
    </Modal>
  );
}

PioneerAuthModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onSuccess: PropTypes.func,
};
