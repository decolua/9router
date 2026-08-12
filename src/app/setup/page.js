"use client";

import { useState, useEffect } from "react";
import { Card, Button, Input } from "@/shared/components";

export default function SetupPage() {
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState(null);

  useEffect(() => {
    async function checkStatus() {
      try {
        const res = await fetch("/api/auth/setup");
        const data = await res.json();
        if (data.needsSetup === false) {
          window.location.assign("/login");
          return;
        }
        setStatus(data);
      } catch {
        setStatus({ needsSetup: true, locked: false, minPasswordLength: 8 });
      }
    }
    checkStatus();
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (password !== confirm) {
      setError("Passwords do not match");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: token.trim(), password }),
      });
      const data = await res.json();
      if (res.ok) {
        window.location.assign("/dashboard");
        return;
      }
      setError(data.error || "Setup failed");
      if (data.locked) setStatus((s) => ({ ...(s || {}), locked: true }));
    } catch {
      setError("An error occurred. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  if (status === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg p-4">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          <p className="text-text-muted mt-4">Loading...</p>
        </div>
      </div>
    );
  }

  const minLength = status.minPasswordLength || 8;

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg p-4 relative overflow-hidden">
      <div className="landing-grid absolute inset-0 pointer-events-none" aria-hidden="true" />
      <div className="relative z-10 w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-primary mb-2">10router</h1>
          <p className="text-text-muted">Set up your dashboard password to claim this instance</p>
        </div>

        <Card>
          {status.locked ? (
            <div className="flex flex-col gap-3 text-center">
              <p className="text-sm text-amber-600 dark:text-amber-400">
                Setup window expired.
              </p>
              <p className="text-xs text-text-muted">
                Restart 10router on the host machine. A new setup token is printed to the
                server console each time it starts.
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <p className="text-xs text-text-muted">
                10router printed a one-time setup token to the console on the host machine.
                Paste it below.
                {status.windowMinutes
                  ? ` It expires ${status.windowMinutes} minutes after startup.`
                  : ""}
              </p>

              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium">Setup token</label>
                <Input
                  type="text"
                  placeholder="Paste the token from the server console"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  required
                  autoFocus
                  autoComplete="off"
                />
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium">New password</label>
                <Input
                  type="password"
                  placeholder={`At least ${minLength} characters`}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="new-password"
                />
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium">Confirm password</label>
                <Input
                  type="password"
                  placeholder="Repeat the password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                  autoComplete="new-password"
                />
              </div>

              {error && <p className="text-xs text-red-500">{error}</p>}

              <Button
                type="submit"
                variant="primary"
                className="w-full"
                loading={loading}
                disabled={!token.trim() || password.length < minLength}
              >
                Complete setup
              </Button>
            </form>
          )}
        </Card>
      </div>
    </div>
  );
}
