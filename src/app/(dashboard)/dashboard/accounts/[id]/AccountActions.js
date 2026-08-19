"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import PropTypes from "prop-types";
import { Button, Toggle, Tooltip, ConfirmModal, EditConnectionModal } from "@/shared/components";

// Mirrors the keys the quota page writes, so a toggle here and a toggle there
// drive the same setting rather than two competing copies.
const AUTO_PING_SETTINGS_KEYS = {
  claude: "claudeAutoPing",
  codex: "codexAutoPing",
};

const AUTO_PING_TOOLTIPS = {
  claude: "When your 5h quota runs out, auto-sends a request the moment it resets so a new window starts right away.",
  codex: "Auto-starts the next 5h Codex window after reset by sending a tiny gpt-5.5 request. Consumes a small amount of quota.",
};

/**
 * The actions that used to crowd the quota card: edit, delete, auto-ping and
 * the Codex reset-credit controls. The card keeps only refresh and enable.
 */
export default function AccountActions({ connection, resetCredits, onChanged }) {
  const router = useRouter();
  const provider = connection.provider;
  const settingsKey = AUTO_PING_SETTINGS_KEYS[provider];

  const [proxyPools, setProxyPools] = useState([]);
  const [showEdit, setShowEdit] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [autoPing, setAutoPing] = useState(false);
  const [busy, setBusy] = useState(null);
  // fetch resolves for 4xx/5xx, so without this every failed action
  // would look like it succeeded.
  const [actionError, setActionError] = useState(null);
  const [nextExpiry, setNextExpiry] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/proxy-pools?isActive=true", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled && d?.proxyPools) setProxyPools(d.proxyPools); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!settingsKey) return undefined;
    let cancelled = false;
    fetch("/api/settings", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : {}))
      .then((s) => {
        if (!cancelled) setAutoPing(s?.[settingsKey]?.connections?.[connection.id] === true);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [settingsKey, connection.id]);

  const creditCount = resetCredits?.available ?? 0;

  // Expiry lives only on the detailed reset-credit endpoint, so it is fetched
  // lazily — and only when there is actually a credit to expire.
  useEffect(() => {
    if (provider !== "codex" || creditCount <= 0) return undefined;
    let cancelled = false;
    fetch(`/api/usage/${connection.id}/codex-reset-credits`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((result) => {
        if (cancelled || !result) return;
        const soonest = (Array.isArray(result.credits) ? result.credits : [])
          .map((c) => c?.expiresAt)
          .filter(Boolean)
          .sort()[0];
        if (soonest) {
          setNextExpiry(new Date(soonest).toLocaleDateString(undefined, { month: "short", day: "numeric" }));
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [provider, creditCount, connection.id]);

  const patchConnection = async (body) => {
    setBusy("save");
    setActionError(null);
    try {
      const res = await fetch(`/api/providers/${connection.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        setActionError(detail.error || `Could not save (${res.status}).`);
        return false;
      }
      await onChanged?.();
      return true;
    } catch {
      setActionError("Could not reach the server.");
      return false;
    } finally {
      setBusy(null);
    }
  };

  const handleToggleAutoPing = async (next) => {
    // Concurrent toggles would each read the same settings object and could
    // land out of order, persisting a value the user did not pick last.
    if (!settingsKey || busy === "autoPing") return;
    const previous = autoPing;
    setBusy("autoPing");
    setAutoPing(next);
    setActionError(null);
    try {
      const r = await fetch("/api/settings", { cache: "no-store" });
      const current = r.ok ? await r.json() : {};
      const cfg = {
        ...(current[settingsKey] || {}),
        connections: { ...(current[settingsKey]?.connections || {}), [connection.id]: next },
      };
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [settingsKey]: cfg }),
      });
      if (!res.ok) throw new Error("patch failed");
    } catch {
      setAutoPing(previous);
      setActionError("Could not change auto-ping.");
    } finally {
      setBusy(null);
    }
  };

  const handleDelete = async () => {
    setBusy("delete");
    setActionError(null);
    try {
      const res = await fetch(`/api/providers/${connection.id}`, { method: "DELETE" });
      if (!res.ok) {
        setActionError(`Could not delete this connection (${res.status}).`);
        return;
      }
      // Closed only on success — a `finally` here would dismiss the dialog on
      // failure too, which reads as a delete that worked.
      setConfirmDelete(false);
      router.push("/dashboard/quota");
    } catch {
      setActionError("Could not reach the server.");
    } finally {
      setBusy(null);
    }
  };

  const handleUseResetCredit = async () => {
    setBusy("reset");
    setActionError(null);
    try {
      const res = await fetch(`/api/usage/${connection.id}/codex-reset-credits`, { method: "POST" });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        setActionError(detail.error || `Could not use a reset credit (${res.status}).`);
        return;
      }
      await onChanged?.();
    } catch {
      setActionError("Could not reach the server.");
    } finally {
      setBusy(null);
      setConfirmReset(false);
    }
  };


  return (
    <>
      <div className="flex flex-col gap-3">
        {actionError && (
          <p
            role="alert"
            className="rounded-lg bg-red-500/10 px-3 py-2 text-[12.5px] text-red-600 dark:text-red-400"
          >
            {actionError}
          </p>
        )}
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[13px] font-medium">Enabled</p>
            <p className="text-[11.5px] text-text-muted">Route traffic through this account.</p>
          </div>
          <Toggle
            size="sm"
            checked={connection.isActive !== false}
            disabled={busy === "save"}
            onChange={(next) => patchConnection({ isActive: next })}
          />
        </div>

        {settingsKey && (
          <div className="flex items-center justify-between gap-4 border-t border-border-subtle pt-3">
            <div className="min-w-0">
              <p className="text-[13px] font-medium">Auto-ping</p>
              <p className="text-[11.5px] text-text-muted">{AUTO_PING_TOOLTIPS[provider]}</p>
            </div>
            <Toggle
              size="sm"
              checked={autoPing}
              disabled={busy === "autoPing"}
              onChange={handleToggleAutoPing}
            />
          </div>
        )}

        {provider === "codex" && (
          <div className="flex items-center justify-between gap-4 border-t border-border-subtle pt-3">
            <div className="min-w-0">
              <p className="text-[13px] font-medium">Usage resets</p>
              <p className="text-[11.5px] text-text-muted">
                {creditCount > 0
                  ? `${creditCount} available${nextExpiry ? ` · next expires ${nextExpiry}` : ""}`
                  : "None available"}
              </p>
            </div>
            <Button
              variant="secondary"
              size="sm"
              disabled={creditCount <= 0 || busy === "reset"}
              onClick={() => setConfirmReset(true)}
            >
              {busy === "reset" ? "Using…" : "Use one"}
            </Button>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 border-t border-border-subtle pt-3">
          <Button variant="secondary" size="sm" onClick={() => setShowEdit(true)}>
            Edit connection
          </Button>
          <Tooltip text="Permanently removes this account and its credentials.">
            <Button
              variant="ghost"
              size="sm"
              className="text-red-500 hover:bg-red-500/10"
              disabled={busy === "delete"}
              onClick={() => setConfirmDelete(true)}
            >
              {busy === "delete" ? "Deleting…" : "Delete"}
            </Button>
          </Tooltip>
        </div>
      </div>

      <EditConnectionModal
        isOpen={showEdit}
        connection={connection}
        proxyPools={proxyPools}
        onSave={async (updates) => {
          await patchConnection(updates);
          setShowEdit(false);
        }}
        onClose={() => setShowEdit(false)}
      />

      <ConfirmModal
        isOpen={confirmDelete}
        title="Delete connection"
        message="This removes the account and its stored credentials. This cannot be undone."
        confirmText="Delete"
        variant="danger"
        onConfirm={handleDelete}
        onClose={() => setConfirmDelete(false)}
      />

      <ConfirmModal
        isOpen={confirmReset}
        title="Use a reset credit"
        message={`Use 1 Codex reset credit for this account. This cannot be undone. Remaining: ${creditCount}.`}
        confirmText="Use credit"
        onConfirm={handleUseResetCredit}
        onClose={() => setConfirmReset(false)}
      />
    </>
  );
}

AccountActions.propTypes = {
  connection: PropTypes.shape({
    id: PropTypes.string,
    provider: PropTypes.string,
    isActive: PropTypes.bool,
  }).isRequired,
  resetCredits: PropTypes.shape({
    available: PropTypes.number,
  }),
  onChanged: PropTypes.func,
};
