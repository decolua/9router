"use client";

import { useState, useEffect, useCallback } from "react";
import { startRegistration } from "@simplewebauthn/browser";
import { Card, Button, Input } from "@/shared/components";
import Modal, { ConfirmModal } from "@/shared/components/Modal";
import { cn } from "@/shared/utils/cn";

const MODE_OPTIONS = [
  { value: "off", title: "Off", desc: "Password (and SSO) only." },
  { value: "on", title: "Passkey + password", desc: "Offer passkey sign-in alongside password." },
  { value: "only", title: "Passkey only", desc: "Refuse remote password login." },
];

const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/;

// Mirrors isLocalhostRpId (server): such passkeys only work on the host itself.
function isLocalhostRpId(rpId) {
  const name = String(rpId || "").toLowerCase();
  return name === "localhost" || name.endsWith(".localhost");
}

// Why the enforced mode differs from the selected one (see getPasskeyLoginState).
const MODE_REASON_TEXT = {
  sso: "Passkey sign-in is suspended: SSO-only login is enforced, and passkeys never bypass it.",
  override: "PASSKEY_MODE_OVERRIDE on the server is loosening this setting.",
  "no-remote-passkey":
    "\"Passkey only\" is selected, but no passkey for a domain (not localhost) is registered, so remote password login is still allowed.",
};

// WebAuthn needs a secure context and a domain name (RP IDs cannot be IP addresses).
function getPasskeySupportHint() {
  if (typeof window === "undefined") return "";
  const host = window.location.hostname;
  if (IPV4_RE.test(host) || host.includes(":") || host.startsWith("[")) {
    return "Passkeys don't work on an IP address. Open the dashboard via a domain name (or http://localhost on the host).";
  }
  if (!window.isSecureContext) {
    return "Passkeys need HTTPS or http://localhost. Open the dashboard over HTTPS to add or use a passkey.";
  }
  if (!window.PublicKeyCredential) {
    return "This browser does not support passkeys.";
  }
  return "";
}

function formatDate(value) {
  if (!value) return "Never";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

async function readJson(res) {
  return res.json().catch(() => ({}));
}

async function fetchPasskeys() {
  try {
    const res = await fetch("/api/auth/passkey/credentials", { cache: "no-store" });
    const data = await readJson(res);
    if (!res.ok) return { error: data.error || "Failed to load passkeys" };
    return { data };
  } catch {
    return { error: "Failed to load passkeys" };
  }
}

export default function PasskeysCard({ hasPassword }) {
  const [passkeys, setPasskeys] = useState([]);
  const [mode, setMode] = useState("off");
  const [effectiveMode, setEffectiveMode] = useState("off");
  const [modeReason, setModeReason] = useState(null);
  const [maxPasskeys, setMaxPasskeys] = useState(20);
  const [loading, setLoading] = useState(true);
  const [modeSaving, setModeSaving] = useState(false);
  const [status, setStatus] = useState({ type: "", message: "" });
  const [supportHint, setSupportHint] = useState("");
  const [currentHost, setCurrentHost] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState({ password: "", name: "" });
  const [addLoading, setAddLoading] = useState(false);
  const [addError, setAddError] = useState("");
  const [renaming, setRenaming] = useState({ id: "", name: "" });
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  // State updates happen only in the promise callback (never synchronously in the effect).
  const applyLoaded = useCallback((result) => {
    if (result.error) {
      setStatus({ type: "error", message: result.error });
    } else {
      setPasskeys(Array.isArray(result.data.passkeys) ? result.data.passkeys : []);
      setMode(result.data.passkeyMode || "off");
      setEffectiveMode(result.data.effectivePasskeyMode || result.data.passkeyMode || "off");
      setModeReason(result.data.passkeyModeReason || null);
      if (result.data.maxPasskeys) setMaxPasskeys(result.data.maxPasskeys);
    }
    // Browser-only facts, read after mount so server and client renders match.
    setSupportHint(getPasskeySupportHint());
    setCurrentHost(window.location.hostname);
    setLoading(false);
  }, []);

  const load = useCallback(() => fetchPasskeys().then(applyLoaded), [applyLoaded]);

  useEffect(() => {
    let cancelled = false;
    fetchPasskeys().then((result) => {
      if (!cancelled) applyLoaded(result);
    });
    return () => {
      cancelled = true;
    };
  }, [applyLoaded]);

  const updateMode = async (next) => {
    if (next === mode) return;
    setModeSaving(true);
    setStatus({ type: "", message: "" });
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passkeyMode: next }),
      });
      const data = await readJson(res);
      if (!res.ok) {
        setStatus({ type: "error", message: data.error || "Failed to update passkey mode" });
        return;
      }
      setMode(data.passkeyMode || next);
      setStatus({
        type: "success",
        message: next === "off" ? "Passkey sign-in disabled" : next === "on" ? "Passkey sign-in enabled" : "Passkey-only login enabled",
      });
      // Refresh the enforced mode (SSO-only, server override) from the server.
      await load();
    } catch {
      setStatus({ type: "error", message: "Failed to update passkey mode" });
    } finally {
      setModeSaving(false);
    }
  };

  const closeAdd = () => {
    if (addLoading) return;
    setAddOpen(false);
    setAddForm({ password: "", name: "" });
    setAddError("");
  };

  const handleAdd = async () => {
    setAddLoading(true);
    setAddError("");
    try {
      const optionsRes = await fetch("/api/auth/passkey/register/options", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: addForm.password }),
      });
      const optionsJSON = await readJson(optionsRes);
      if (!optionsRes.ok) {
        setAddError(optionsJSON.error || "Could not start passkey registration");
        return;
      }

      let attestation;
      try {
        attestation = await startRegistration({ optionsJSON });
      } catch (err) {
        if (err?.name === "NotAllowedError" || err?.name === "AbortError") {
          setAddError("Passkey creation was cancelled.");
        } else if (err?.name === "InvalidStateError") {
          setAddError("This authenticator already has a passkey for 9Router.");
        } else {
          setAddError(err?.message || "Passkey creation failed");
        }
        return;
      }

      const verifyRes = await fetch("/api/auth/passkey/register/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response: attestation, name: addForm.name }),
      });
      const data = await readJson(verifyRes);
      if (!verifyRes.ok) {
        setAddError(data.error || "Passkey registration failed");
        return;
      }
      setAddOpen(false);
      setAddForm({ password: "", name: "" });
      setStatus({ type: "success", message: `Passkey "${data.passkey?.name || "Passkey"}" added` });
      await load();
    } catch {
      setAddError("An error occurred. Please try again.");
    } finally {
      setAddLoading(false);
    }
  };

  const handleRename = async () => {
    const { id, name } = renaming;
    if (!id) return;
    try {
      const res = await fetch(`/api/auth/passkey/credentials/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await readJson(res);
      if (!res.ok) {
        setStatus({ type: "error", message: data.error || "Failed to rename passkey" });
        return;
      }
      setPasskeys((list) => list.map((p) => (p.id === id ? { ...p, ...data.passkey } : p)));
      setRenaming({ id: "", name: "" });
    } catch {
      setStatus({ type: "error", message: "Failed to rename passkey" });
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    try {
      const res = await fetch(`/api/auth/passkey/credentials/${encodeURIComponent(deleteTarget.id)}`, { method: "DELETE" });
      const data = await readJson(res);
      if (!res.ok) {
        setStatus({ type: "error", message: data.error || "Failed to remove passkey" });
      } else {
        setStatus({ type: "success", message: "Passkey removed" });
        await load();
      }
    } catch {
      setStatus({ type: "error", message: "Failed to remove passkey" });
    } finally {
      setDeleteLoading(false);
      setDeleteTarget(null);
    }
  };

  const atCap = passkeys.length >= maxPasskeys;
  const remotePasskeyCount = passkeys.filter((p) => !isLocalhostRpId(p.rpId)).length;
  const subtitle =
    effectiveMode === "only"
      ? "Passkey-only login active"
      : effectiveMode === "on"
      ? "Passkey + password login active"
      : "Sign in with Touch ID, Face ID, Windows Hello or a security key";
  const modeWarning = !loading && mode !== effectiveMode ? MODE_REASON_TEXT[modeReason] || "" : "";

  return (
    <Card>
      <div className="flex items-center gap-3 mb-4">
        <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-500 shrink-0">
          <span className="material-symbols-outlined text-[20px]">passkey</span>
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-base sm:text-lg font-semibold">Passkeys</h3>
          <p className="text-xs text-text-muted">{subtitle}</p>
        </div>
      </div>

      <div className="flex flex-col gap-4">
        {supportHint && (
          <p className="text-xs sm:text-sm text-amber-600 dark:text-amber-400">{supportHint}</p>
        )}

        {/* Mode selection */}
        <div className="flex flex-col gap-2">
          <label className="font-medium text-sm sm:text-base">Passkey mode</label>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {MODE_OPTIONS.map((option) => {
              const active = mode === option.value;
              const needsRemote = option.value === "only" && remotePasskeyCount === 0 && mode !== "only";
              const disabled = loading || modeSaving || needsRemote;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => updateMode(option.value)}
                  className={cn(
                    "text-left rounded-lg border p-3 transition-colors disabled:opacity-50 disabled:cursor-not-allowed",
                    active ? "border-primary bg-primary/5" : "border-border bg-bg hover:bg-black/5 dark:hover:bg-white/5"
                  )}
                  disabled={disabled}
                  title={needsRemote ? "Add a passkey on the dashboard's domain first (localhost passkeys only work on the host)" : undefined}
                >
                  <p className="font-medium text-sm sm:text-base">{option.title}</p>
                  <p className="text-xs sm:text-sm text-text-muted mt-1">{option.desc}</p>
                </button>
              );
            })}
          </div>
          {modeWarning && (
            <p className="text-xs sm:text-sm text-amber-600 dark:text-amber-400">{modeWarning}</p>
          )}
          <p className="text-xs text-text-muted">
            &quot;Passkey only&quot; disables password login for remote access, so password scanners get nothing to try.
            It needs a passkey for the dashboard&apos;s domain. To recover: sign in with the password on the host machine
            (http://localhost), or run 9router CLI → Settings → Reset Password to Default, which switches back to
            &quot;Passkey + password&quot;. In Docker the host browser does not count as local; set
            PASSKEY_MODE_OVERRIDE=on and restart the container instead.
          </p>
        </div>

        {/* Registered passkeys */}
        <div className="flex flex-col gap-2 pt-4 border-t border-border/50">
          <div className="flex items-center justify-between gap-2">
            <label className="font-medium text-sm sm:text-base">
              Registered passkeys <span className="text-text-muted font-normal">({passkeys.length}/{maxPasskeys})</span>
            </label>
            <Button
              size="sm"
              variant="primary"
              icon="add"
              onClick={() => setAddOpen(true)}
              disabled={loading || atCap || !!supportHint}
            >
              Add passkey
            </Button>
          </div>

          {loading ? (
            <p className="text-xs text-text-muted">Loading...</p>
          ) : passkeys.length === 0 ? (
            <p className="text-xs sm:text-sm text-text-muted">No passkeys yet. Add one to enable passkey sign-in.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {passkeys.map((p) => (
                <li key={p.id} className="rounded-lg border border-border bg-bg p-3 flex flex-col sm:flex-row sm:items-center gap-2">
                  <div className="flex-1 min-w-0">
                    {renaming.id === p.id ? (
                      <div className="flex items-center gap-2">
                        <Input
                          value={renaming.name}
                          maxLength={64}
                          onChange={(e) => setRenaming((s) => ({ ...s, name: e.target.value }))}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleRename();
                            if (e.key === "Escape") setRenaming({ id: "", name: "" });
                          }}
                          autoFocus
                        />
                        <Button size="sm" variant="primary" onClick={handleRename}>Save</Button>
                        <Button size="sm" variant="ghost" onClick={() => setRenaming({ id: "", name: "" })}>Cancel</Button>
                      </div>
                    ) : (
                      <p className="font-medium text-sm truncate">{p.name || "Passkey"}</p>
                    )}
                    <p className="text-xs text-text-muted mt-0.5">
                      {p.rpId}
                      {p.rpId !== currentHost && currentHost ? " (other hostname)" : ""}
                      {" · "}
                      {p.deviceType === "multiDevice" ? (p.backedUp ? "Synced" : "Multi-device") : "Device-bound"}
                      {" · Added "}{formatDate(p.createdAt)}
                      {" · Last used "}{formatDate(p.lastUsedAt)}
                    </p>
                  </div>
                  {renaming.id !== p.id && (
                    <div className="flex items-center gap-1 shrink-0">
                      <Button size="sm" variant="ghost" icon="edit" onClick={() => setRenaming({ id: p.id, name: p.name || "" })}>
                        Rename
                      </Button>
                      <Button size="sm" variant="ghost" icon="delete" onClick={() => setDeleteTarget(p)}>
                        Remove
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-text-muted">
            A passkey works only on the hostname it was created on. Add one for each address you sign in from.
          </p>
        </div>

        {status.message && (
          <p className={`text-xs sm:text-sm ${status.type === "error" ? "text-red-500" : "text-green-500"}`}>
            {status.message}
          </p>
        )}
      </div>

      <Modal
        isOpen={addOpen}
        onClose={closeAdd}
        title="Add passkey"
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={closeAdd} disabled={addLoading}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleAdd} loading={addLoading} disabled={!addForm.password}>
              Continue
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <p className="text-text-muted text-sm">
            Confirm your current {hasPassword ? "" : "(default) "}password, then follow your browser&apos;s prompt to create the passkey.
          </p>
          <Input
            type="password"
            value={addForm.password}
            onChange={(e) => setAddForm((s) => ({ ...s, password: e.target.value }))}
            onKeyDown={(e) => { if (e.key === "Enter" && addForm.password && !addLoading) handleAdd(); }}
            placeholder="Current password"
            autoFocus
          />
          <Input
            value={addForm.name}
            maxLength={64}
            onChange={(e) => setAddForm((s) => ({ ...s, name: e.target.value }))}
            placeholder="Name (optional, e.g. MacBook Touch ID)"
          />
          {addError && <p className="text-xs text-red-500">{addError}</p>}
        </div>
      </Modal>

      <ConfirmModal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Remove passkey"
        message={`Remove "${deleteTarget?.name || "Passkey"}"? It will no longer be able to sign in.`}
        confirmText="Remove"
        cancelText="Cancel"
        variant="danger"
        loading={deleteLoading}
      />
    </Card>
  );
}
