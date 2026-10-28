"use client";

import { useState } from "react";
import { Card, Button, Input } from "@/shared/components";

/**
 * MFA (TOTP) enrollment card for the profile page.
 *
 * Enrollment is deliberately two-phase: /setup mints a candidate secret and
 * renders its QR, /enable only persists it once the user proves the
 * authenticator produced a valid code. Backup codes come back exactly once.
 */
export default function MfaCard({ enabled, backupCodesRemaining = 0, onChanged }) {
  const [step, setStep] = useState("idle"); // idle | password | verify | codes | disable
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [secret, setSecret] = useState("");
  const [qr, setQr] = useState("");
  const [backupCodes, setBackupCodes] = useState([]);
  const [status, setStatus] = useState({ type: "", message: "" });
  const [loading, setLoading] = useState(false);

  const reset = () => {
    setStep("idle");
    setPassword("");
    setCode("");
    setSecret("");
    setQr("");
    setBackupCodes([]);
    setStatus({ type: "", message: "" });
  };

  const post = async (url, body) => {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, data };
  };

  const startSetup = async (e) => {
    e.preventDefault();
    setLoading(true);
    setStatus({ type: "", message: "" });
    const { ok, data } = await post("/api/auth/mfa/setup", { password });
    setLoading(false);
    if (!ok) {
      setStatus({ type: "error", message: data.error || "Failed to start setup" });
      return;
    }
    setSecret(data.secret);
    setQr(data.qrCodeDataUri);
    setStep("verify");
    setStatus({ type: "", message: "" });
  };

  const confirmEnable = async (e) => {
    e.preventDefault();
    setLoading(true);
    setStatus({ type: "", message: "" });
    const { ok, data } = await post("/api/auth/mfa/enable", { password, secret, code });
    setLoading(false);
    if (!ok) {
      setStatus({ type: "error", message: data.error || "Failed to enable MFA" });
      setCode("");
      return;
    }
    setBackupCodes(data.backupCodes || []);
    setStep("codes");
    setPassword("");
    setCode("");
    onChanged?.();
  };

  const confirmDisable = async (e) => {
    e.preventDefault();
    setLoading(true);
    setStatus({ type: "", message: "" });
    const { ok, data } = await post("/api/auth/mfa/disable", { password, code });
    setLoading(false);
    if (!ok) {
      setStatus({ type: "error", message: data.error || "Failed to disable MFA" });
      setCode("");
      return;
    }
    reset();
    setStatus({ type: "success", message: "Two-factor authentication disabled" });
    onChanged?.();
  };

  const copyCodes = () => {
    navigator.clipboard?.writeText(backupCodes.join("\n"));
    setStatus({ type: "success", message: "Backup codes copied" });
  };

  return (
    <Card>
      <div className="flex flex-col gap-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-semibold">Two-Factor Authentication</h2>
            <p className="text-sm text-text-muted mt-1">
              Require a time-based code from an authenticator app in addition to your password.
            </p>
          </div>
          <span
            className={`text-xs px-2 py-1 rounded shrink-0 ${
              enabled ? "bg-green-500/15 text-green-600" : "bg-sidebar text-text-muted"
            }`}
          >
            {enabled ? "Enabled" : "Disabled"}
          </span>
        </div>

        {status.message && (
          <p className={`text-xs ${status.type === "error" ? "text-red-500" : "text-green-600"}`}>
            {status.message}
          </p>
        )}

        {/* ── enabled, idle ── */}
        {enabled && step === "idle" && (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-text-muted">
              {backupCodesRemaining} backup code{backupCodesRemaining === 1 ? "" : "s"} remaining.
            </p>
            <Button type="button" variant="secondary" onClick={() => setStep("disable")}>
              Disable 2FA
            </Button>
          </div>
        )}

        {/* ── disabled, idle ── */}
        {!enabled && step === "idle" && (
          <Button type="button" variant="primary" onClick={() => setStep("password")}>
            Enable 2FA
          </Button>
        )}

        {/* ── step 1: re-auth ── */}
        {step === "password" && (
          <form onSubmit={startSetup} className="flex flex-col gap-3">
            <label className="text-sm font-medium">Confirm your password</label>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Current password"
              required
              autoFocus
            />
            <div className="flex gap-2">
              <Button type="submit" variant="primary" loading={loading} disabled={!password}>
                Continue
              </Button>
              <Button type="button" variant="secondary" onClick={reset}>
                Cancel
              </Button>
            </div>
          </form>
        )}

        {/* ── step 2: scan + confirm ── */}
        {step === "verify" && (
          <form onSubmit={confirmEnable} className="flex flex-col gap-3">
            <p className="text-sm">Scan this QR code with your authenticator app:</p>
            {qr && (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={qr} alt="TOTP QR code" width={200} height={200} className="rounded bg-white p-2 self-start" />
            )}
            <details className="text-xs text-text-muted">
              <summary className="cursor-pointer">Can&apos;t scan? Enter this key manually</summary>
              <code className="block mt-2 break-all bg-sidebar p-2 rounded font-mono">{secret}</code>
            </details>
            <label className="text-sm font-medium mt-1">Enter the 6-digit code to confirm</label>
            <Input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="123456"
              required
              autoFocus
            />
            <div className="flex gap-2">
              <Button type="submit" variant="primary" loading={loading} disabled={!code}>
                Enable
              </Button>
              <Button type="button" variant="secondary" onClick={reset}>
                Cancel
              </Button>
            </div>
          </form>
        )}

        {/* ── step 3: one-time backup codes ── */}
        {step === "codes" && (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-amber-600 dark:text-amber-400">
              Save these backup codes now — they are shown only once. Each can be used a single
              time if you lose access to your authenticator.
            </p>
            <div className="grid grid-cols-2 gap-2 bg-sidebar p-3 rounded font-mono text-sm">
              {backupCodes.map((c) => (
                <span key={c}>{c}</span>
              ))}
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="secondary" onClick={copyCodes}>
                Copy codes
              </Button>
              <Button type="button" variant="primary" onClick={reset}>
                Done
              </Button>
            </div>
          </div>
        )}

        {/* ── disable: password + live factor ── */}
        {step === "disable" && (
          <form onSubmit={confirmDisable} className="flex flex-col gap-3">
            <p className="text-sm text-text-muted">
              Confirm with your password and a current code (or a backup code).
            </p>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Current password"
              required
              autoFocus
            />
            <Input
              type="text"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="123456 or backup code"
              required
            />
            <div className="flex gap-2">
              <Button type="submit" variant="secondary" loading={loading} disabled={!password || !code}>
                Disable 2FA
              </Button>
              <Button type="button" variant="primary" onClick={reset}>
                Cancel
              </Button>
            </div>
          </form>
        )}
      </div>
    </Card>
  );
}
