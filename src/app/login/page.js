"use client";

import { useState, useEffect } from "react";
import { Card, Button, Input } from "@/shared/components";
import { useRouter, useSearchParams } from "next/navigation";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [hasPassword, setHasPassword] = useState(null);
  const [microsoftOAuthEnabled, setMicrosoftOAuthEnabled] = useState(false);
  const [microsoftPublicClient, setMicrosoftPublicClient] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    async function checkAuth() {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      const baseUrl = typeof window !== "undefined" ? window.location.origin : "";

      try {
        const res = await fetch(`${baseUrl}/api/settings`, {
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        if (res.ok) {
          const data = await res.json();
          if (data.requireLogin === false) {
            router.push("/dashboard");
            router.refresh();
            return;
          }
          setHasPassword(!!data.hasPassword);
        } else {
          // Safe fallback on non-OK response to avoid infinite loading state.
          setHasPassword(true);
        }
      } catch (err) {
        clearTimeout(timeoutId);
        setHasPassword(true);
      }
    }
    
    async function checkMicrosoftOAuth() {
      try {
        const res = await fetch("/api/auth/microsoft/status");
        if (res.ok) {
          const data = await res.json();
          setMicrosoftOAuthEnabled(data.enabled);
          setMicrosoftPublicClient(!!data.publicClient);
        }
      } catch (err) {
        setMicrosoftOAuthEnabled(false);
        setMicrosoftPublicClient(false);
      }
    }
    
    checkAuth();
    checkMicrosoftOAuth();
  }, [router]);
  useEffect(() => {
    const err = searchParams.get("error");
    if (err) setError(decodeURIComponent(err));
  }, [searchParams]);

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setError("Email is required");
      setLoading(false);
      return;
    }

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: trimmedEmail.toLowerCase(),
          password,
        }),
      });

      if (res.ok) {
        router.push("/dashboard");
        router.refresh();
      } else {
        const data = await res.json();
        setError(data.error || "Invalid email or password");
      }
    } catch (err) {
      setError("An error occurred. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleMicrosoftLogin = async () => {
    if (microsoftPublicClient) {
      try {
        const [configRes, { generateCodeVerifier, generateCodeChallenge, generateState, savePkceToSession }] = await Promise.all([
          fetch("/api/auth/microsoft/config"),
          import("@/shared/utils/pkceClient"),
        ]);
        if (!configRes.ok) {
          setError("Microsoft auth not available");
          return;
        }
        const config = await configRes.json();
        const verifier = generateCodeVerifier();
        const challenge = await generateCodeChallenge(verifier);
        const state = generateState();
        savePkceToSession(verifier, state);
        const authUrl = new URL(config.authorizeUrl);
        authUrl.searchParams.set("client_id", config.clientId);
        authUrl.searchParams.set("response_type", "code");
        authUrl.searchParams.set("redirect_uri", config.redirectUri);
        authUrl.searchParams.set("scope", config.scope);
        authUrl.searchParams.set("response_mode", "query");
        authUrl.searchParams.set("state", state);
        authUrl.searchParams.set("code_challenge", challenge);
        authUrl.searchParams.set("code_challenge_method", "S256");
        window.location.href = authUrl.toString();
      } catch (err) {
        setError(err.message || "Could not start Microsoft sign-in");
      }
      return;
    }
    window.location.href = "/api/auth/microsoft";
  };

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

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-primary mb-2">EGS Proxy AI</h1>
          <p className="text-text-muted">Sign in with your account</p>
        </div>

        <Card>
          {microsoftOAuthEnabled && (
            <>
              <Button
                type="button"
                variant="secondary"
                className="w-full mb-4"
                onClick={handleMicrosoftLogin}
              >
                <svg className="w-5 h-5 mr-2" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M11.4 24H0V12.6h11.4V24zM24 24H12.6V12.6H24V24zM11.4 11.4H0V0h11.4v11.4zm12.6 0H12.6V0H24v11.4z"/>
                </svg>
                Sign in with Microsoft
              </Button>
              
              <div className="relative my-4">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-border"></div>
                </div>
                <div className="relative flex justify-center text-sm">
                  <span className="px-2 bg-surface text-text-muted">or</span>
                </div>
              </div>
            </>
          )}
          
          <form onSubmit={handleLogin} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium">Email</label>
              <Input
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                autoFocus
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
                autoComplete="current-password"
              />
            </div>
            {error && <p className="text-xs text-red-500">{error}</p>}

            <Button
              type="submit"
              variant="primary"
              className="w-full"
              loading={loading}
            >
              Sign in
            </Button>

            <p className="text-xs text-center text-text-muted mt-2">
              Don&apos;t have an account?{" "}
              <a href="/register" className="text-primary hover:underline">
                Register
              </a>
            </p>
          </form>
        </Card>
      </div>
    </div>
  );
}
