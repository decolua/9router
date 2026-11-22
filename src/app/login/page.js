"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import { Card, Button, Input } from "@/shared/components";

function AuthBrandPanel() {
  const steps = [
    ["01", "Choose a credential", "Instance password or a scoped API key."],
    ["02", "Verify access", "SSO options appear when configured."],
    ["03", "Route requests", "Manage providers and model access."],
  ];

  return (
    <aside className="relative hidden min-h-screen flex-col justify-between overflow-hidden border-r-2 border-[#191817] bg-[#eee4d2] p-8 lg:flex xl:p-12">
      <div className="flex items-center gap-3">
        <span className="flex size-11 shrink-0 items-center justify-center border-2 border-[#191817] bg-[#ff7657] p-1 shadow-[3px_3px_0_#191817]">
          <Image src="/providers/9router-logo.png" alt="9Router" width={36} height={36} className="size-full object-contain" priority unoptimized />
        </span>
        <span>
          <span className="block text-lg font-black tracking-tight text-[#191817]">9Router</span>
          <span className="block font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-[#514c43]">Gateway control plane</span>
        </span>
      </div>

      <div className="relative z-10 max-w-xl py-10">
        <span className="inline-flex border-2 border-[#191817] bg-[#c8ee68] px-3 py-1 font-mono text-[11px] font-black uppercase tracking-[0.14em] shadow-[3px_3px_0_#191817]">
          Instance access / 01
        </span>
        <h2 className="mt-6 max-w-xl text-4xl font-black leading-[0.98] tracking-[-0.05em] text-[#191817] xl:text-6xl">
          One doorway.<br />Every model route.
        </h2>
        <p className="mt-5 max-w-lg text-base font-medium leading-relaxed text-[#514c43]">
          Sign in to manage provider connections, API keys, and the routes your clients use.
        </p>
      </div>

      <ol className="relative z-10 grid gap-2 xl:grid-cols-3">
        {steps.map(([number, title, detail], index) => (
          <li key={number} className={`min-h-28 border-2 border-[#191817] p-3 shadow-[3px_3px_0_#191817] ${index === 0 ? "bg-[#ff7657]" : index === 1 ? "bg-[#fff1bf]" : "bg-[#83d8e8]"}`}>
            <span className="font-mono text-[10px] font-black tracking-[0.14em]">{number}</span>
            <strong className="mt-2 block text-sm font-black leading-tight">{title}</strong>
            <span className="mt-1 block text-xs leading-snug text-[#39352f]">{detail}</span>
          </li>
        ))}
      </ol>
      <div aria-hidden="true" className="absolute -bottom-20 -right-16 size-56 rotate-12 border-2 border-[#191817] bg-[#c6b5ff] opacity-70" />
    </aside>
  );
}

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [resetHint, setResetHint] = useState("");
  const [retryAfter, setRetryAfter] = useState(0);
  const [loading, setLoading] = useState(false);
  const [hasPassword, setHasPassword] = useState(null);
  const [authMode, setAuthMode] = useState("password");
  const [ssoType, setSsoType] = useState("oidc");
  const [oidcConfigured, setOidcConfigured] = useState(false);
  const [oidcLoginLabel, setOidcLoginLabel] = useState("Sign in with OIDC");
  const [samlConfigured, setSamlConfigured] = useState(false);
  const [samlLoginLabel, setSamlLoginLabel] = useState("Sign in with SAML SSO");
  const [mustChange, setMustChange] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [loginMethod, setLoginMethod] = useState("password");
  const [apiKey, setApiKey] = useState("");
  const [noAccess, setNoAccess] = useState(false);

  // A key that signed in but holds no permission would bounce between /login and
  // the dashboard, so it stays here and can sign out instead.
  const handleSignOut = async () => {
    setLoading(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // The cookie may already be gone; the reload below settles the state.
    }
    window.location.assign("/login");
  };

  // Countdown for rate-limit
  useEffect(() => {
    if (retryAfter <= 0) return;
    const id = setInterval(() => setRetryAfter((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(id);
  }, [retryAfter]);

  useEffect(() => {
    async function checkAuth() {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      const baseUrl = typeof window !== "undefined" ? window.location.origin : "";

      try {
        const res = await fetch(`${baseUrl}/api/auth/status`, {
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        if (res.ok) {
          const data = await res.json();
          if (data.authenticated === true || data.requireLogin === false) {
            if (data.role === "apikey" && !data.homePath) {
              setNoAccess(true);
              setHasPassword(!!data.hasPassword);
              return;
            }
            window.location.assign(data.homePath || "/dashboard");
            return;
          }
          setHasPassword(!!data.hasPassword);
          setAuthMode(data.authMode || "password");
          setSsoType(data.ssoType || "oidc");
          setOidcConfigured(data.oidcConfigured === true);
          setOidcLoginLabel(data.oidcLoginLabel || "Sign in with OIDC");
          setSamlConfigured(data.samlConfigured === true);
          setSamlLoginLabel(data.samlLoginLabel || "Sign in with SAML SSO");
        } else {
          // Safe fallback on non-OK response to avoid infinite loading state.
          setHasPassword(true);
        }
      } catch (err) {
        clearTimeout(timeoutId);
        setHasPassword(true);
      }
    }
    checkAuth();
  }, []);

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    setResetHint("");

    try {
      const payload = loginMethod === "apikey" ? { apiKey } : { password };
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.mustChangePassword) {
          setMustChange(true);
          return;
        }
        if (typeof window !== "undefined") {
          sessionStorage.setItem("9router:justLoggedIn", "true");
        }
        if (data.role === "apikey" && !data.homePath) {
          setNoAccess(true);
          setHasPassword(true);
          return;
        }
        window.location.assign(data.homePath || "/dashboard");
      } else {
        const data = await res.json();
        setError(data.error || (loginMethod === "apikey" ? "Invalid API Key" : "Invalid password"));
        if (data.resetHint) setResetHint(data.resetHint);
        if (data.retryAfter) setRetryAfter(Number(data.retryAfter));
      }
    } catch (err) {
      setError("An error occurred. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  // Force a new password before entering the dashboard (default + remote).
  const handleSetNewPassword = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: password, newPassword }),
      });
      if (res.ok) {
        if (typeof window !== "undefined") {
          sessionStorage.setItem("9router:justLoggedIn", "true");
        }
        window.location.assign("/dashboard");
      } else {
        const data = await res.json();
        setError(data.error || "Failed to set password");
      }
    } catch (err) {
      setError("An error occurred. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleOidcLogin = () => {
    window.location.href = "/api/auth/oidc/start";
  };

  const handleSamlLogin = () => {
    window.location.href = "/api/auth/saml/start";
  };

  const isSsoEnabled = ["sso", "oidc", "saml", "both"].includes(authMode);
  const activeSsoType = ssoType || (authMode === "saml" ? "saml" : "oidc");

  const samlAvailable = isSsoEnabled && activeSsoType === "saml" && samlConfigured;
  const oidcAvailable = isSsoEnabled && activeSsoType === "oidc" && oidcConfigured;
  const ssoAvailable = samlAvailable || oidcAvailable;

  const passwordAvailable = authMode === "password" || authMode === "both" || !ssoAvailable;

  // Show loading state while checking password
  if (hasPassword === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg p-4">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          <p className="text-text-muted mt-4">Loading...</p>
        </div>
      </div>
    );
  }

  if (noAccess) {
    return (
      <div className="min-h-screen grid overflow-hidden bg-bg lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
        <div className="landing-grid absolute inset-0 pointer-events-none" aria-hidden="true" />
        <AuthBrandPanel />
        <main className="relative z-10 flex min-h-screen items-center justify-center p-4 sm:p-8">
        <div className="relative z-10 w-full max-w-lg">
          <div className="mb-6">
            <p className="font-mono text-[11px] font-black uppercase tracking-[0.14em] text-primary">Access scope / limited</p>
            <h2 className="mt-3 text-2xl font-black tracking-tight text-text-main">Dashboard access is not enabled</h2>
            <p className="mt-2 text-sm leading-relaxed text-text-muted">This key authenticated successfully, but it does not include dashboard permissions.</p>
          </div>
          <Card padding="md" className="sm:p-8">
            <div className="flex flex-col gap-4">
              <p className="text-sm leading-relaxed text-text-muted">
                Ask the instance owner to grant the required permission to this key, or switch to an administrator credential.
              </p>
              <Button type="button" variant="primary" className="w-full" loading={loading} onClick={handleSignOut}>
                Sign out and switch account
              </Button>
            </div>
          </Card>
        </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen grid overflow-hidden bg-bg lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
      {/* Faint grid background */}
      <div className="landing-grid absolute inset-0 pointer-events-none" aria-hidden="true" />
      <AuthBrandPanel />
      <main className="relative z-10 flex min-h-screen items-center justify-center p-4 sm:p-8">
      <div className="relative z-10 w-full max-w-xl">
        <div className="mb-6">
          <p className="font-mono text-[11px] font-black uppercase tracking-[0.14em] text-primary">9Router / access portal</p>
          <h2 className="mt-3 text-3xl font-black tracking-tight text-text-main">Sign in to this instance</h2>
          <p className="mt-2 text-sm leading-relaxed text-text-muted">
            {samlAvailable
              ? "Continue with the configured SAML identity provider."
              : oidcAvailable
              ? "Continue with the configured OIDC identity provider."
              : "Choose a credential to open the dashboard and manage your routes."}
          </p>
        </div>

        <Card padding="md" className="sm:p-8">
          {mustChange ? (
            <form onSubmit={handleSetNewPassword} className="flex flex-col gap-4">
              <p className="text-sm text-warning text-center">
                Set a new password before accessing the dashboard remotely.
              </p>
              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium">New password</label>
                <Input
                  type="password"
                  placeholder="Enter new password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                  autoFocus
                />
                {error && <p className="text-xs text-red-500">{error}</p>}
              </div>
              <Button type="submit" variant="primary" className="w-full" loading={loading} disabled={!newPassword}>
                Set password
              </Button>
            </form>
          ) : (
          <div className="flex flex-col gap-4">
            {samlAvailable && (
              <Button type="button" variant="primary" className="w-full" onClick={handleSamlLogin}>
                {samlLoginLabel}
              </Button>
            )}

            {oidcAvailable && (
              <Button type="button" variant="primary" className="w-full" onClick={handleOidcLogin}>
                {oidcLoginLabel}
              </Button>
            )}

            {ssoAvailable && passwordAvailable && <div className="h-px bg-border/60" />}

            {passwordAvailable ? (
              <form onSubmit={handleLogin} className="flex flex-col gap-4">
                {isSsoEnabled && !ssoAvailable && (
                  <p className="text-xs text-warning text-center">
                    {activeSsoType === "saml" ? "SAML SSO" : "OIDC"} login is enabled, but configuration is incomplete. Password login is still available for recovery.
                  </p>
                )}

                {authMode === "both" && ssoAvailable && (
                  <p className="text-xs text-text-muted text-center">
                    Password and {activeSsoType === "saml" ? "SAML SSO" : "OIDC"} login are both enabled.
                  </p>
                )}

                {/* Login Method Toggle */}
                <div className="flex rounded-lg border border-border bg-bg-subtle p-1 mb-1">
                  <button
                    type="button"
                    onClick={() => { setLoginMethod("password"); setError(""); }}
                    className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-colors ${loginMethod === "password" ? "bg-primary text-white shadow-xs" : "text-text-muted hover:text-text-main"}`}
                  >
                    Password
                  </button>
                  <button
                    type="button"
                    onClick={() => { setLoginMethod("apikey"); setError(""); }}
                    className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-colors ${loginMethod === "apikey" ? "bg-primary text-white shadow-xs" : "text-text-muted hover:text-text-main"}`}
                  >
                    API key
                  </button>
                </div>

                {loginMethod === "password" ? (
                  <div className="flex flex-col gap-2">
                    <label className="text-sm font-bold">Instance password</label>
                    <Input
                      type="password"
                      placeholder="Enter the instance password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      autoFocus={!oidcAvailable}
                    />
                    {error && <p className="text-xs text-red-500">{error}</p>}
                    {retryAfter > 0 && (
                      <p className="text-xs text-warning">
                        Locked. Retry in <span className="font-mono">{retryAfter}s</span>.
                      </p>
                    )}
                    {resetHint && (
                      <p className="text-xs text-text-muted">
                        Forgot password? Open <code className="bg-sidebar px-1 rounded">9router</code> CLI on the host → <b>Settings</b> → <b>Reset Password to Default</b>.
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    <label className="text-sm font-bold">Access key</label>
                    <Input
                      type="password"
                      placeholder="Paste an assigned API key"
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      required
                      autoFocus
                    />
                    {error && <p className="text-xs text-red-500">{error}</p>}
                    <p className="text-xs text-text-muted">
                      This key opens only the dashboard areas its permissions allow.
                    </p>
                  </div>
                )}

                <Button
                  type="submit"
                  variant="primary"
                  className="w-full"
                  loading={loading}
                  disabled={retryAfter > 0}
                >
                  {retryAfter > 0 ? `Wait ${retryAfter}s` : loginMethod === "apikey" ? "Continue with API key" : "Enter dashboard"}
                </Button>

                {loginMethod === "password" && (
                  <p className="mt-2 border-t-2 border-border-subtle pt-3 text-xs leading-relaxed text-text-muted">
                    Use the password configured for this instance. If you have lost access, an administrator can reset it on the host.
                  </p>
                )}
              </form>
            ) : (
              error && <p className="text-xs text-red-500">{error}</p>
            )}
          </div>
          )}
        </Card>
      </div>
      </main>
    </div>
  );
}
