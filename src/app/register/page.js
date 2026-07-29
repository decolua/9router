"use client";

import { useState, useEffect, Suspense } from "react";
import { Card, Button, Input } from "@/shared/components";
import Link from "next/link";

function RegisterForm() {
  const [orgName, setOrgName] = useState("");
  const [orgSlug, setOrgSlug] = useState("");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [slugHint, setSlugHint] = useState("");
  const [loading, setLoading] = useState(false);
  const [saas, setSaas] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    fetch("/api/auth/status")
      .then((r) => r.json())
      .then((data) => {
        setSaas(data.saas === true);
        setReady(true);
      })
      .catch(() => setReady(true));
  }, []);

  useEffect(() => {
    if (!orgSlug || orgSlug.length < 3) {
      setSlugHint("");
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/auth/org-check?slug=${encodeURIComponent(orgSlug)}`);
        const data = await res.json();
        setSlugHint(data.available ? "URL available" : (data.error || "URL taken"));
      } catch {
        setSlugHint("");
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [orgSlug]);

  const handleRegister = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/auth/register-org", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgName, orgSlug, email, name, password }),
      });
      const data = await res.json();
      if (res.ok) {
        window.location.href = data.loginUrl || data.dashboardUrl || "/login";
        return;
      }
      setError(data.error || "Registration failed");
    } catch {
      setError("An error occurred. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg">
        <p className="text-text-muted">Loading...</p>
      </div>
    );
  }

  if (!saas) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg p-4">
        <Card className="max-w-md w-full text-center">
          <h1 className="text-xl font-bold mb-2">Organization registration</h1>
          <p className="text-sm text-text-muted mb-4">
            This instance runs in on-premise mode. Use the signup page to join an existing workspace.
          </p>
          <Link href="/signup" className="text-primary hover:underline text-sm">Go to signup</Link>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg p-4 relative overflow-hidden">
      <div className="landing-grid absolute inset-0 pointer-events-none" aria-hidden="true" />
      <div className="relative z-10 w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-primary mb-2">Create organization</h1>
          <p className="text-text-muted">Register your team on ebRouter</p>
        </div>

        <Card>
          <form onSubmit={handleRegister} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium">Organization name</label>
              <Input
                type="text"
                value={orgName}
                onChange={(e) => {
                  setOrgName(e.target.value);
                  if (!orgSlug) {
                    setOrgSlug(e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""));
                  }
                }}
                required
                autoFocus
              />
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium">Organization URL</label>
              <Input
                type="text"
                placeholder="acme"
                value={orgSlug}
                onChange={(e) => setOrgSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                required
                minLength={3}
              />
              <p className="text-xs text-text-muted">Your workspace: {orgSlug || "your-org"}.yourdomain.com</p>
              {slugHint && (
                <p className={`text-xs ${slugHint === "URL available" ? "text-green-600" : "text-amber-600"}`}>
                  {slugHint}
                </p>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium">Admin email</label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium">Your name</label>
              <Input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium">Password</label>
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
            </div>

            {error && <p className="text-xs text-red-500">{error}</p>}

            <Button type="submit" variant="primary" className="w-full" loading={loading}>
              Create organization
            </Button>

            <p className="text-xs text-center text-text-muted">
              Already have an account? <Link href="/login" className="text-primary hover:underline">Sign in</Link>
            </p>
          </form>
        </Card>
      </div>
    </div>
  );
}

export default function RegisterPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center">Loading...</div>}>
      <RegisterForm />
    </Suspense>
  );
}
