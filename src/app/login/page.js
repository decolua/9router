"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import { Card, Button, Input, Spinner } from "@/shared/components";

function AuthBrandPanel() {
  const checkpoints = [
    ["01", "Credential", "Password, API key, or configured SSO."],
    ["02", "Permission check", "The key's assigned scope is enforced."],
    ["03", "Dashboard", "Open the areas this account may use."],
  ];

  return (
    <aside className="relative hidden min-h-screen flex-col justify-between overflow-hidden border-r-2 border-[#191817] bg-[#191817] p-8 text-[#fffdf8] lg:flex xl:p-12">
      <div className="flex items-center gap-3">
        <span className="flex size-12 shrink-0 items-center justify-center border-2 border-[#fffdf8] bg-[#ff7657] p-1 shadow-[3px_3px_0_#fffdf8]">
          <Image src="/providers/9router-logo.png" alt="9Router" width={36} height={36} className="size-full object-contain" priority unoptimized />
        </span>
        <span>
          <span className="block text-lg font-black tracking-tight">9Router</span>
          <span className="block font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-[#c8ee68]">Gateway control plane</span>
        </span>
      </div>

      <div className="relative z-10 max-w-xl py-10">
        <p className="font-mono text-xs font-black uppercase tracking-[0.14em] text-[#c8ee68]">Instance access</p>
        <p className="mt-5 max-w-xl text-4xl font-black leading-[0.96] tracking-[-0.05em] text-[#fffdf8] xl:text-6xl">
          One gate.<br /><span className="text-[#ff7657]">Your routes.</span>
        </p>
        <p className="mt-5 max-w-lg text-base font-medium leading-relaxed text-[#eee4d2]">
          Sign in to manage provider connections, API keys, and the model routes this instance serves.
        </p>
      </div>

      <div className="relative z-10 border-2 border-[#191817] bg-[#eee4d2] p-4 text-[#191817] shadow-[5px_5px_0_#ff7657]">
        <p className="mb-3 border-b-2 border-[#191817] pb-2 font-mono text-[10px] font-black uppercase tracking-[0.14em]">Access sequence</p>
        <ol className="grid gap-2 sm:grid-cols-3">
          {checkpoints.map(([number, title, detail]) => (
            <li key={number} className="min-h-24 border-2 border-[#191817] bg-[#fffdf8] p-3">
              <span className="font-mono text-[10px] font-black">{number}</span>
              <strong className="mt-2 block text-sm font-black leading-tight">{title}</strong>
              <span className="mt-1 block text-xs leading-snug text-[#514c43]">{detail}</span>
            </li>
          ))}
        </ol>
        <p className="mt-3 text-xs font-semibold leading-relaxed text-[#39352f]">Only sign-in methods enabled for this instance are shown.</p>
      </div>

      <div aria-hidden="true" className="absolute -right-10 top-1/3 size-28 rotate-45 border-2 border-[#ff7657]" />
    </aside>
  );
}

function AuthMobileBrand() {
  return (
    <div className="mb-8 flex items-center gap-3 lg:hidden">
      <span className="flex size-11 shrink-0 items-center justify-center border-2 border-[#191817] bg-[#ff7657] p-1 shadow-[3px_3px_0_#191817]">
        <Image src="/providers/9router-logo.png" alt="9Router" width={36} height={36} className="size-full object-contain" priority unoptimized />
      </span>
      <span>
        <span className="block text-lg font-black tracking-tight text-[#191817]">9Router</span>
        <span className="block font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-[#514c43]">Gateway control plane</span>
      </span>
    </div>
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
          <Spinner size="lg" className="text-primary" decorative />
          <p className="text-text-muted mt-4">Loading...</p>
        </div>
      </div>
    );
  }

  if (noAccess) {
    return (
      <div className="min-h-screen grid overflow-hidden bg-[#f7f1e4] lg:grid-cols-[minmax(0,0.86fr)_minmax(0,1.14fr)]">
        <AuthBrandPanel />
        <main className="relative z-10 flex min-h-screen items-center justify-center bg-[#f7f1e4] p-5 sm:p-8 xl:p-12">
        <div className="w-full max-w-xl">
          <AuthMobileBrand />
          <header className="mb-6">
            <p className="font-mono text-[11px] font-black uppercase tracking-[0.14em] text-[#a73725]">Access / limited</p>
            <h1 className="mt-3 text-3xl font-black tracking-tight text-[#191817] sm:text-4xl">This key stops here.</h1>
            <p className="mt-3 max-w-lg text-sm leading-relaxed text-[#514c43]">The credential is valid, but it does not include permission to open a dashboard page.</p>
          </header>
          <Card padding="md" className="border-2 border-[#191817] bg-[#fffdf8] text-[#191817] shadow-[6px_6px_0_#191817] sm:p-8">
            <div className="flex flex-col gap-5">
              <div className="border-2 border-[#191817] bg-[#fff1bf] p-4 text-sm leading-relaxed text-[#191817]">
                Ask the instance owner to grant a dashboard permission to this key, or sign out and use an administrator credential.
              </div>
              <Button type="button" variant="primary" size="lg" className="min-h-12 w-full border-2 border-[#191817] bg-[#ff7657] text-[#191817] shadow-[4px_4px_0_#191817] hover:bg-[#ff8867] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#191817]" loading={loading} onClick={handleSignOut}>
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
    <div className="min-h-screen grid overflow-hidden bg-[#f7f1e4] lg:grid-cols-[minmax(0,0.86fr)_minmax(0,1.14fr)]">
      <AuthBrandPanel />
      <main className="relative z-10 flex min-h-screen items-center justify-center bg-[#f7f1e4] p-5 sm:p-8 xl:p-12">
      <div className="w-full max-w-xl">
        <AuthMobileBrand />
        <header className="mb-6">
          <p className="font-mono text-[11px] font-black uppercase tracking-[0.14em] text-[#a73725]">Credential checkpoint</p>
          <h1 className="mt-3 text-3xl font-black tracking-tight text-[#191817] sm:text-4xl">{mustChange ? "Set a new password." : "Sign in to this instance."}</h1>
          <p className="mt-3 max-w-lg text-sm leading-relaxed text-[#514c43]">
            {mustChange
              ? "Update the instance password before entering the dashboard."
              : samlAvailable
              ? "Continue with the configured SAML identity provider."
              : oidcAvailable
              ? "Continue with the configured OIDC identity provider."
              : "Choose a credential to open the dashboard and manage your routes."}
          </p>
        </header>

        <Card padding="md" className="border-2 border-[#191817] bg-[#fffdf8] text-[#191817] shadow-[6px_6px_0_#191817] sm:p-8">
          {mustChange ? (
            <form onSubmit={handleSetNewPassword} className="flex flex-col gap-4">
              <p className="border-2 border-[#191817] bg-[#fff1bf] px-3 py-2 text-sm font-semibold leading-relaxed text-[#191817]">
                Set a new password before accessing the dashboard remotely.
              </p>
              <div className="flex flex-col gap-2">
                <label htmlFor="new-password" className="text-sm font-bold">New password</label>
                <Input
                  id="new-password"
                  type="password"
                  placeholder="Enter new password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                  autoFocus
                />
                {error && <p role="alert" className="border-2 border-[#191817] bg-[#ffe0e1] px-3 py-2 text-xs font-semibold text-[#8e1621]">{error}</p>}
              </div>
              <Button type="submit" variant="primary" size="lg" className="min-h-12 w-full border-2 border-[#191817] bg-[#ff7657] text-[#191817] shadow-[4px_4px_0_#191817] hover:bg-[#ff8867] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#191817]" loading={loading} disabled={!newPassword}>
                Set password
              </Button>
            </form>
          ) : (
          <div className="flex flex-col gap-4">
            {samlAvailable && (
              <Button type="button" variant="secondary" size="lg" className="min-h-12 w-full border-2 border-[#191817] text-[#191817] shadow-[3px_3px_0_#191817] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#191817]" onClick={handleSamlLogin}>
                {samlLoginLabel}
              </Button>
            )}

            {oidcAvailable && (
              <Button type="button" variant="secondary" size="lg" className="min-h-12 w-full border-2 border-[#191817] text-[#191817] shadow-[3px_3px_0_#191817] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#191817]" onClick={handleOidcLogin}>
                {oidcLoginLabel}
              </Button>
            )}

            {ssoAvailable && passwordAvailable && (
              <div className="flex items-center gap-3 py-1" aria-hidden="true">
                <span className="h-0 flex-1 border-t-2 border-[#191817]" />
                <span className="font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-[#514c43]">Or use a password</span>
                <span className="h-0 flex-1 border-t-2 border-[#191817]" />
              </div>
            )}

            {passwordAvailable ? (
              <form onSubmit={handleLogin} className="flex flex-col gap-4">
                {isSsoEnabled && !ssoAvailable && (
                  <p role="status" className="border-2 border-[#191817] bg-[#fff1bf] px-3 py-2 text-xs font-semibold leading-relaxed text-[#191817]">
                    {activeSsoType === "saml" ? "SAML SSO" : "OIDC"} login is enabled, but configuration is incomplete. Password login is still available for recovery.
                  </p>
                )}

                {authMode === "both" && ssoAvailable && (
                  <p className="text-xs font-medium leading-relaxed text-[#514c43]">
                    Password and {activeSsoType === "saml" ? "SAML SSO" : "OIDC"} login are both enabled.
                  </p>
                )}

                {/* Login Method Toggle */}
                <div role="group" aria-label="Sign-in method" className="mb-1 grid grid-cols-2 gap-1 border-2 border-[#191817] bg-[#eee4d2] p-1">
                  <button
                    type="button"
                    aria-pressed={loginMethod === "password"}
                    onClick={() => { setLoginMethod("password"); setError(""); }}
                    className={`min-h-11 border-2 border-[#191817] px-3 text-sm font-bold transition-colors focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#191817] ${loginMethod === "password" ? "bg-[#191817] text-[#fffdf8] shadow-[2px_2px_0_#ff7657]" : "bg-[#fffdf8] text-[#191817] hover:bg-[#fff1bf]"}`}
                  >
                    Password
                  </button>
                  <button
                    type="button"
                    aria-pressed={loginMethod === "apikey"}
                    onClick={() => { setLoginMethod("apikey"); setError(""); }}
                    className={`min-h-11 border-2 border-[#191817] px-3 text-sm font-bold transition-colors focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#191817] ${loginMethod === "apikey" ? "bg-[#191817] text-[#fffdf8] shadow-[2px_2px_0_#ff7657]" : "bg-[#fffdf8] text-[#191817] hover:bg-[#fff1bf]"}`}
                  >
                    API key
                  </button>
                </div>

                {loginMethod === "password" ? (
                  <div className="flex flex-col gap-2">
                    <label htmlFor="instance-password" className="text-sm font-bold text-[#191817]">Instance password</label>
                    <Input
                      id="instance-password"
                      type="password"
                      placeholder="Enter the instance password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      autoFocus={!oidcAvailable}
                    />
                    {error && <p role="alert" className="border-2 border-[#191817] bg-[#ffe0e1] px-3 py-2 text-xs font-semibold text-[#8e1621]">{error}</p>}
                    {retryAfter > 0 && (
                      <p role="status" className="border-2 border-[#191817] bg-[#fff1bf] px-3 py-2 text-xs font-semibold text-[#191817]">
                        Locked. Retry in <span className="font-mono">{retryAfter}s</span>.
                      </p>
                    )}
                    {resetHint && (
                      <p className="border-t-2 border-[#191817] pt-3 text-xs leading-relaxed text-[#514c43]">
                        Forgot password? Open the <code className="border border-[#191817] bg-[#fff1bf] px-1 font-bold text-[#191817]">9router</code> CLI on the host, then choose <b>Settings</b> and <b>Reset Password to Default</b>.
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    <label htmlFor="api-access-key" className="text-sm font-bold text-[#191817]">Access key</label>
                    <Input
                      id="api-access-key"
                      type="password"
                      placeholder="Paste an assigned API key"
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      required
                      autoFocus
                    />
                    {error && <p role="alert" className="border-2 border-[#191817] bg-[#ffe0e1] px-3 py-2 text-xs font-semibold text-[#8e1621]">{error}</p>}
                    <p className="text-xs leading-relaxed text-[#514c43]">
                      This key opens only the dashboard areas its permissions allow.
                    </p>
                  </div>
                )}

                <Button
                  type="submit"
                  variant="primary"
                  size="lg"
                  className="min-h-12 w-full border-2 border-[#191817] bg-[#ff7657] text-[#191817] shadow-[4px_4px_0_#191817] hover:bg-[#ff8867] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#191817]"
                  loading={loading}
                  disabled={retryAfter > 0}
                >
                  {retryAfter > 0 ? `Wait ${retryAfter}s` : loginMethod === "apikey" ? "Continue with API key" : "Enter dashboard"}
                </Button>

                {loginMethod === "password" && (
                  <p className="mt-2 border-t-2 border-[#191817] pt-3 text-xs leading-relaxed text-[#514c43]">
                    Use the password configured for this instance. If you have lost access, an administrator can reset it on the host.
                  </p>
                )}
              </form>
            ) : (
              error && <p role="alert" className="border-2 border-[#191817] bg-[#ffe0e1] px-3 py-2 text-xs font-semibold text-[#8e1621]">{error}</p>
            )}
          </div>
          )}
        </Card>
      </div>
      </main>
    </div>
  );
}
