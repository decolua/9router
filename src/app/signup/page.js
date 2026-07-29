"use client";

import { useState, useEffect, Suspense } from "react";
import { Card, Button, Input } from "@/shared/components";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { getClientOrgSlug, orgScopedPath } from "@/lib/org/clientOrgPath.js";

function orgAuthHeaders(extra = {}, orgSlug = "") {
  const slug = getClientOrgSlug() || String(orgSlug || "").trim().toLowerCase();
  const headers = { ...extra };
  if (slug) headers["x-ebr-org-slug"] = slug;
  return headers;
}

function SignupForm() {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [inviteToken, setInviteToken] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [signupMode, setSignupMode] = useState("invite");
  const [orgSlug] = useState(() => getClientOrgSlug() || "");
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const token = searchParams.get("token");
    if (token) setInviteToken(token);

    fetch(orgScopedPath("/api/auth/status"), {
      cache: "no-store",
      headers: orgAuthHeaders({}, orgSlug),
    })
      .then((r) => r.json())
      .then((data) => {
        setSignupMode(data.signupMode || "invite");
        // Stay on signup when accepting an invite so a logged-in admin
        // (or wrong account) does not skip the invite form.
        if (data.currentUser && !token) {
          router.push(orgScopedPath("/dashboard"));
        }
      })
      .catch(() => {});
  }, [router, searchParams, orgSlug]);

  const handleSignup = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    const slug = getClientOrgSlug() || orgSlug.trim().toLowerCase();

    try {
      const res = await fetch(orgScopedPath("/api/auth/signup"), {
        method: "POST",
        headers: orgAuthHeaders({ "Content-Type": "application/json" }, slug),
        body: JSON.stringify({ email, name, password, inviteToken: inviteToken || undefined }),
      });
      const data = await res.json();
      if (res.ok) {
        router.push(orgScopedPath("/dashboard"));
        router.refresh();
      } else {
        setError(data.error || "Signup failed");
      }
    } catch {
      setError("An error occurred. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg p-4 relative overflow-hidden">
      <div className="landing-grid absolute inset-0 pointer-events-none" aria-hidden="true" />
      <div className="relative z-10 w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-primary mb-2">Create account</h1>
          <p className="text-text-muted">Join your organisation&apos;s ebRouter workspace</p>
        </div>

        <Card>
          <form onSubmit={handleSignup} className="flex flex-col gap-4">
            {signupMode === "invite" && (
              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium">Invite token</label>
                <Input
                  type="text"
                  placeholder="Paste invite token from your admin"
                  value={inviteToken}
                  onChange={(e) => setInviteToken(e.target.value)}
                  required={signupMode === "invite"}
                />
              </div>
            )}

            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium">Email</label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium">Name</label>
              <Input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium">Password</label>
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
              <p className="text-xs text-text-muted">At least 8 characters</p>
            </div>

            {error && <p className="text-xs text-red-500">{error}</p>}

            <Button type="submit" variant="primary" className="w-full" loading={loading}>
              Create account
            </Button>

            <p className="text-xs text-center text-text-muted">
              Already have an account?{" "}
              <Link href={orgScopedPath("/login")} className="text-primary hover:underline">
                Sign in
              </Link>
            </p>
          </form>
        </Card>
      </div>
    </div>
  );
}

export default function SignupPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center">Loading...</div>}>
      <SignupForm />
    </Suspense>
  );
}
