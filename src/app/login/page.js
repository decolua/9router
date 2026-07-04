"use client";

import { useState, useEffect } from "react";
import { Card, Button, Input } from "@/shared/components";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { getClientOrgSlug, orgScopedPath } from "@/lib/org/clientOrgPath.js";

function orgAuthHeaders(extra = {}, orgSlug = "") {
  const slug = getClientOrgSlug() || String(orgSlug || "").trim().toLowerCase();
  const headers = { ...extra };
  if (slug) headers["x-ebr-org-slug"] = slug;
  return headers;
}

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [orgSlug, setOrgSlug] = useState(() => getClientOrgSlug() || "");
  const [error, setError] = useState("");
  const [resetHint, setResetHint] = useState("");
  const [retryAfter, setRetryAfter] = useState(0);
  const [loading, setLoading] = useState(false);
  const [authMode, setAuthMode] = useState("password");
  const [oidcConfigured, setOidcConfigured] = useState(false);
  const [oidcLoginLabel, setOidcLoginLabel] = useState("Sign in with OIDC");
  const [signupMode, setSignupMode] = useState("invite");
  const [saas, setSaas] = useState(false);
  const [orgName, setOrgName] = useState("");
  const [ready, setReady] = useState(false);
  const [mfaToken, setMfaToken] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [showMfa, setShowMfa] = useState(false);
  const [showForgot, setShowForgot] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotMessage, setForgotMessage] = useState("");
  const router = useRouter();

  useEffect(() => {
    if (retryAfter <= 0) return;
    const id = setInterval(() => setRetryAfter((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(id);
  }, [retryAfter]);

  useEffect(() => {
    async function checkAuth() {
      try {
        const res = await fetch(orgScopedPath("/api/auth/status"), {
          cache: "no-store",
          headers: orgAuthHeaders({}, orgSlug),
        });
        if (res.ok) {
          const data = await res.json();
          if (data.requireLogin === false || data.currentUser) {
            router.push(orgScopedPath("/dashboard"));
            router.refresh();
            return;
          }
          setAuthMode(data.authMode || "password");
          setOidcConfigured(data.oidcConfigured === true);
          setOidcLoginLabel(data.oidcLoginLabel || "Sign in with OIDC");
          setSignupMode(data.signupMode || "invite");
          setSaas(data.saas === true);
          setOrgName(data.organization?.name || "");
        }
      } catch {
        // allow login attempt
      } finally {
        setReady(true);
      }
    }
    checkAuth();
  }, [router, orgSlug]);

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    setResetHint("");

    const slug = getClientOrgSlug() || orgSlug.trim().toLowerCase();
    if (saas && !slug) {
      setError("Enter your organization URL (e.g. pludous)");
      setLoading(false);
      return;
    }

    try {
      const res = await fetch(orgScopedPath("/api/auth/login"), {
        method: "POST",
        headers: orgAuthHeaders({ "Content-Type": "application/json" }, slug),
        body: JSON.stringify({ email, password, orgSlug: slug || undefined }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.mfaRequired && data.mfaToken) {
          setMfaToken(data.mfaToken);
          setShowMfa(true);
          setError("");
          return;
        }
        router.push(orgScopedPath("/dashboard"));
        router.refresh();
      } else {
        const data = await res.json();
        setError(data.error || "Invalid email or password");
        if (data.resetHint) setResetHint(data.resetHint);
        if (data.retryAfter) setRetryAfter(Number(data.retryAfter));
      }
    } catch {
      setError("An error occurred. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleMfaVerify = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch(orgScopedPath("/api/auth/login/mfa"), {
        method: "POST",
        headers: orgAuthHeaders({ "Content-Type": "application/json" }, orgSlug),
        body: JSON.stringify({ mfaToken, code: mfaCode, orgSlug: orgSlug || undefined }),
      });
      if (res.ok) {
        router.push(orgScopedPath("/dashboard"));
        router.refresh();
      } else {
        const data = await res.json();
        setError(data.error || "Invalid code");
      }
    } catch {
      setError("An error occurred. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async (e) => {
    e.preventDefault();
    setLoading(true);
    setForgotMessage("");
    setError("");
    try {
      const res = await fetch(orgScopedPath("/api/auth/forgot-password"), {
        method: "POST",
        headers: orgAuthHeaders({ "Content-Type": "application/json" }, orgSlug),
        body: JSON.stringify({ email: forgotEmail || email, orgSlug: orgSlug || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Request failed");
      setForgotMessage(data.message || "If an account exists, check your email for a reset link.");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleOidcLogin = () => {
    window.location.href = orgScopedPath("/api/auth/oidc/start");
  };

  const oidcAvailable = oidcConfigured && ["oidc", "both"].includes(authMode);
  const passwordAvailable = authMode !== "oidc" || !oidcConfigured;
  const showSignupLink = signupMode !== "closed";

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg p-4">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
          <p className="text-text-muted mt-4">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg p-4 relative overflow-hidden">
      <div className="landing-grid absolute inset-0 pointer-events-none" aria-hidden="true" />
      <div className="relative z-10 w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-primary mb-2">ebRouter</h1>
          <p className="text-text-muted">
            {orgName
              ? `Sign in to ${orgName}`
              : authMode === "oidc" && oidcConfigured
                ? "Sign in with your OIDC provider"
                : saas
                  ? "Sign in to your organization workspace"
                  : "Sign in to your workspace"}
          </p>
        </div>

        <Card>
          <div className="flex flex-col gap-4">
            {oidcAvailable && (
              <Button type="button" variant="primary" className="w-full" onClick={handleOidcLogin}>
                {oidcLoginLabel}
              </Button>
            )}

            {oidcAvailable && passwordAvailable && <div className="h-px bg-border/60" />}

            {passwordAvailable && !showMfa && (
              <form onSubmit={handleLogin} className="flex flex-col gap-4">
                {saas && !getClientOrgSlug() && !orgName && (
                  <div className="flex flex-col gap-2">
                    <label className="text-sm font-medium">Organization URL</label>
                    <Input
                      type="text"
                      placeholder="your-team"
                      value={orgSlug}
                      onChange={(e) => setOrgSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                      required
                    />
                    <p className="text-xs text-text-muted">The name you chose when creating your organization (e.g. pludous)</p>
                  </div>
                )}

                <div className="flex flex-col gap-2">
                  <label className="text-sm font-medium">Email</label>
                  <Input
                    type="email"
                    placeholder="you@company.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoFocus={!oidcAvailable}
                  />
                </div>

                <div className="flex flex-col gap-2">
                  <label className="text-sm font-medium">Password</label>
                  <Input
                    type="password"
                    placeholder="Enter password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                  {error && <p className="text-xs text-red-500">{error}</p>}
                  {retryAfter > 0 && (
                    <p className="text-xs text-amber-600 dark:text-amber-400">
                      Locked. Retry in <span className="font-mono">{retryAfter}s</span>.
                    </p>
                  )}
                  {resetHint && <p className="text-xs text-text-muted">{resetHint}</p>}
                </div>

                <Button type="submit" variant="primary" className="w-full" loading={loading} disabled={retryAfter > 0}>
                  {retryAfter > 0 ? `Wait ${retryAfter}s` : "Sign in"}
                </Button>

                <button
                  type="button"
                  className="text-xs text-primary hover:underline"
                  onClick={() => { setShowForgot((v) => !v); setForgotEmail(email); }}
                >
                  Forgot password?
                </button>

                {showForgot && (
                  <div className="border border-border rounded p-3 flex flex-col gap-2">
                    <Input
                      type="email"
                      placeholder="Account email"
                      value={forgotEmail}
                      onChange={(e) => setForgotEmail(e.target.value)}
                      required
                    />
                    <Button type="button" variant="secondary" size="sm" loading={loading} onClick={handleForgotPassword}>
                      Send reset link
                    </Button>
                    {forgotMessage && <p className="text-xs text-text-muted">{forgotMessage}</p>}
                  </div>
                )}

                {showSignupLink && (
                  <p className="text-xs text-center text-text-muted">
                    Need an account? <Link href={orgScopedPath("/signup")} className="text-primary hover:underline">Create one</Link>
                  </p>
                )}

                {saas && !orgName && (
                  <p className="text-xs text-center text-text-muted">
                    New team? <Link href="/register" className="text-primary hover:underline">Create an organization</Link>
                  </p>
                )}

              </form>
            )}

            {passwordAvailable && showMfa && (
              <form onSubmit={handleMfaVerify} className="flex flex-col gap-4">
                <p className="text-sm text-text-muted">Enter the 6-digit code from your authenticator app.</p>
                <Input
                  type="text"
                  inputMode="numeric"
                  placeholder="123456"
                  value={mfaCode}
                  onChange={(e) => setMfaCode(e.target.value)}
                  required
                  autoFocus
                />
                {error && <p className="text-xs text-red-500">{error}</p>}
                <Button type="submit" variant="primary" className="w-full" loading={loading}>
                  Verify
                </Button>
                <button type="button" className="text-xs text-text-muted hover:underline" onClick={() => { setShowMfa(false); setMfaToken(""); setMfaCode(""); }}>
                  Back to sign in
                </button>
              </form>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
