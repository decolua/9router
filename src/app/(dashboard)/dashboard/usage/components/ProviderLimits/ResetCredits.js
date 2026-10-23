"use client";

import { useEffect, useRef, useState } from "react";
import Tooltip from "@/shared/components/Tooltip";
import { ConfirmModal } from "@/shared/components/Modal";
import { getConnectionLabel } from "./utils";

const CLAUDE_LIMITS = { five_hour: "session", seven_day: "weekly", seven_day_overage_included: "weekly", seven_day_opus: "Opus weekly", seven_day_sonnet: "Sonnet weekly" };
const formatClears = (clears) => {
  const names = [...new Set((clears || []).map((name) => CLAUDE_LIMITS[name]).filter(Boolean))];
  return names.length ? `${names.join(" + ")} limits` : "limits";
};

export function formatCreditDate(value) {
  const date = value && new Date(value);
  return date && Number.isFinite(date.getTime()) ? date.toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) : "N/A";
}

export function formatTimeRemaining(value) {
  const diff = value ? Date.parse(value) - Date.now() : NaN;
  if (!Number.isFinite(diff)) return "N/A";
  if (diff <= 0) return "Expired";
  const hours = Math.ceil(diff / 3600000);
  return hours >= 24 ? `${Math.floor(hours / 24)}d ${hours % 24}h` : `${hours}h`;
}

function grantStatus(grant) {
  if (grant.resetsLeft <= 0) return "used";
  if (grant.paused) return "paused";
  if (grant.endsAt && Date.parse(grant.endsAt) <= Date.now()) return "expired";
  if (grant.usableNow) return "usable now";
  if (grant.startsAt && Date.parse(grant.startsAt) > Date.now()) return "not started";
  return grant.useRequiresLimit ? "at limit only" : "unavailable";
}

export default function ResetCredits(props) {
  const [Provider, setProvider] = useState(null);
  useEffect(() => {
    let active = true;
    import(`./resetProviders/${props.connection.provider}.js`)
      .then((module) => { if (active) setProvider(() => module.default); })
      .catch(() => {});
    return () => { active = false; };
  }, [props.connection.provider]);
  return Provider ? <Provider {...props} /> : <ResetCreditControls {...props} />;
}

export function ResetCreditControls({ connection, quota, disabled, onBusy, onError, onRefresh, reset }) {
  const [confirmation, setConfirmation] = useState(null);
  const [details, setDetails] = useState(null);
  const [busy, setBusy] = useState(false);
  const [, tick] = useState(0);
  const inFlight = useRef(false);
  const isCodex = connection.provider === "codex";
  const grants = connection.provider === "claude" ? quota?.raw?.resetCredits : null;
  const count = reset ? reset.count : Math.max(0, Number(quota?.raw?.resetCredits?.availableCount) || 0);
  const label = reset?.label || (isCodex ? "Codex reset credit" : "Claude limit reset");
  const blocked = disabled || busy;

  useEffect(() => {
    if (!reset || (!confirmation && !details)) return;
    const timer = setInterval(() => tick((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [reset, confirmation, details]);

  if (!reset && !isCodex && !grants) return null;

  const run = async (action) => {
    if (inFlight.current || disabled) return;
    inFlight.current = true;
    setBusy(true);
    onBusy(true);
    onError(null);
    try { return await action(); }
    catch (error) {
      const message = error.message || "Failed to reset limit";
      onError(message);
      setDetails((previous) => previous ? { ...previous, loading: false, error: message } : previous);
    } finally {
      inFlight.current = false;
      setBusy(false);
      onBusy(false);
    }
  };
  const reload = async () => {
    const data = reset ? await reset.load() : await loadCredits();
    setDetails({ data, loading: false, error: null });
    return data;
  };
  const loadCredits = async () => {
    if (grants) return { kind: "claude", ...grants };
    const response = await fetch(`/api/usage/${connection.id}/codex-reset-credits`, { cache: "no-store" });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || result.message || "Failed to load Codex reset credits");
    const credits = [...(Array.isArray(result.credits) ? result.credits : [])].sort((a, b) => (Date.parse(a.expiresAt) || Infinity) - (Date.parse(b.expiresAt) || Infinity));
    return { ...result, credits };
  };
  const confirm = (selection) => { setDetails(null); setConfirmation(selection); };
  const inspect = () => run(async () => {
    setDetails({ data: details?.data, loading: true, error: null });
    await reload();
  });
  const prepare = () => run(async () => confirm(reset ? await reset.prepare() : {}));
  const redeem = () => run(async () => {
    const selection = confirmation;
    if (reset?.invalid?.(selection)) throw new Error("Select a valid, unexpired reset card.");
    setConfirmation(null);
    if (reset) await reset.redeem(selection);
    else {
      const response = grants
        ? await fetch(`/api/usage/${connection.id}/claude-reset`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ grantId: grants.nextGrantId }) })
        : await fetch(`/api/usage/${connection.id}/codex-reset-credits`, { method: "POST" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.message || result.error || result.code || "Failed to reset limit");
      await onRefresh();
    }
  });
  const data = details?.data;
  const title = reset?.title || (data?.kind === "claude" ? "Claude Code Limit Resets" : "Codex Reset Credit Expiry");
  const message = reset ? reset.message(confirmation) : grants
    ? `Refills your ${formatClears(grants.clears)} now for ${getConnectionLabel(connection) || "this account"} · your weekly reset day stays ${formatCreditDate(grants.weeklyResetsAt)}. This cannot be undone. Resets left: ${count}.`
    : `Use 1 Codex reset credit for ${getConnectionLabel(connection) || "this account"}. This cannot be undone. Remaining credits: ${count}.`;
  const Recovery = reset?.recovery;
  const columns = data?.kind === "claude" ? ["Reset", "Left", "Refills", "Use By", "Remaining"] : reset ? ["Reset", "Expires At", "Remaining"] : ["Status", "Granted At", "Expires At", "Remaining"];
  const rows = data?.kind === "claude" ? (data.grants || []).map((grant) => ({ id: grant.id, cells: [<>{grant.label || grant.id}<span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">{grantStatus(grant)}</span></>, `${grant.resetsLeft} / ${grant.resetsTotal}`, formatClears(grant.clears), formatCreditDate(grant.endsAt), formatTimeRemaining(grant.endsAt)] }))
    : reset ? (data?.cards || []).map((card) => ({ id: card.id || card.cardId, cells: [card.label || "Full reset", formatCreditDate(card.expiresAt), formatTimeRemaining(card.expiresAt)] }))
      : (data?.credits || []).map((credit, index) => ({ id: `${credit.status}-${credit.expiresAt || index}`, cells: [credit.status || "unknown", formatCreditDate(credit.grantedAt), formatCreditDate(credit.expiresAt), formatTimeRemaining(credit.expiresAt)] }));

  return <>
    <Tooltip text={reset?.blocked ? "Resolve the unfinished reset in card details before using another card." : count == null ? "Reset cards unavailable. Open card details to retry." : count > 0 ? grants ? `Use your reset now (${count} left, use by ${formatCreditDate(grants.expiresAt)}) · refills ${formatClears(grants.clears)}` : `Use one ${label}. Available: ${count}` : `No ${label}s available`}>
      <button type="button" onClick={prepare} disabled={blocked || reset?.blocked || count == null || count <= 0} aria-label={count > 0 ? `Use one ${label}. ${count} available.` : `No ${label}s available`} className={`flex h-8 min-w-10 items-center justify-center gap-1 rounded-lg border px-2 text-[11px] font-medium tabular-nums transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary/60 disabled:cursor-not-allowed disabled:opacity-60 ${count > 0 ? "border-primary/30 bg-primary/5 text-primary hover:bg-primary/10" : "border-black/10 bg-black/[0.02] text-text-muted dark:border-white/10 dark:bg-white/[0.03]"}`}>
        <span className={`material-symbols-outlined text-[15px] ${busy ? "animate-spin" : ""}`}>{busy ? "progress_activity" : "restart_alt"}</span><span>{count ?? "–"}</span>
      </button>
    </Tooltip>
    <Tooltip text={reset ? `View ${label} expiry` : isCodex ? "View Codex reset credit expiry" : "View Claude Code reset expiry"}><button type="button" onClick={inspect} disabled={blocked} aria-label={reset ? `View ${label} expiry` : isCodex ? "View Codex reset credit expiry" : "View Claude Code reset expiry"} className="flex h-8 w-8 items-center justify-center rounded-lg border border-black/10 text-text-muted transition-colors hover:bg-black/5 hover:text-primary disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:hover:bg-white/5"><span className="material-symbols-outlined text-[17px]">schedule</span></button></Tooltip>
    <ConfirmModal isOpen={Boolean(confirmation)} onClose={() => { if (!busy) setConfirmation(null); }} onConfirm={redeem} title={reset ? `Reset ${reset.name} limits?` : grants ? "Reset Claude limits?" : "Reset Codex limit?"} message={message} confirmText="Reset limit" cancelText="Cancel" variant="danger" loading={busy} disabled={Boolean(reset?.invalid?.(confirmation))}>
      {reset?.selection?.(confirmation, setConfirmation)}
    </ConfirmModal>
    {details && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm">
      <div role="dialog" aria-modal="true" aria-label={title} className="w-full max-w-2xl overflow-hidden rounded-2xl border border-black/15 bg-white shadow-2xl ring-1 ring-black/10 dark:border-white/15 dark:bg-neutral-950 dark:ring-white/10">
        <div className="flex items-start justify-between gap-3 border-b border-black/10 bg-black/[0.03] px-4 py-3 dark:border-white/10 dark:bg-white/[0.04]"><div className="min-w-0"><h3 className="text-base font-semibold text-text-primary">{title}</h3><p className="mt-0.5 truncate text-xs text-text-muted">{getConnectionLabel(connection)}</p></div><button type="button" disabled={busy} onClick={() => setDetails(null)} aria-label="Close reset credit expiry modal" className="flex h-8 w-8 items-center justify-center rounded-lg text-text-muted hover:bg-black/5 dark:hover:bg-white/5"><span className="material-symbols-outlined text-[18px]">close</span></button></div>
        <div className="max-h-[70vh] space-y-3 overflow-auto bg-white p-4 dark:bg-neutral-950">
          {details.loading ? <div className="flex items-center justify-center gap-2 py-10 text-sm text-text-muted"><span className="material-symbols-outlined animate-spin text-[20px]">progress_activity</span>Loading reset credits...</div> : <>
            {details.error && <p role="alert" className="rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-300">{details.error}</p>}
            {Recovery && <Recovery run={run} reload={reload} confirm={confirm} busy={busy} data={data} />}
            {(!details.error || reset) && <>
              <div className="flex items-center justify-between text-xs text-text-muted"><span>{data?.kind === "claude" ? `${data.availableCount ?? 0} reset${data.availableCount === 1 ? "" : "s"} left` : reset ? data?.availableCount == null ? "Inventory unavailable — not zero." : `${data.availableCount} reset cards available` : `${data?.credits?.length ?? 0} reset credit${data?.credits?.length === 1 ? "" : "s"}`}</span>{!reset && data?.kind !== "claude" && <span>{data?.availableCount ?? 0} available</span>}{data?.kind === "claude" && <span>Weekly reset day: {formatCreditDate(data.weeklyResetsAt)}</span>}{reset && <button type="button" disabled={busy} onClick={inspect} className="rounded-lg border px-3 py-1 disabled:opacity-50">Refresh inventory</button>}</div>
              {rows.length ? <div className="overflow-x-auto rounded-xl border border-black/10 dark:border-white/10"><table className="w-full min-w-[560px] text-left text-sm"><thead className="bg-black/[0.03] text-xs uppercase text-text-muted dark:bg-white/[0.04]"><tr>{columns.map((column) => <th key={column} scope="col" className="px-3 py-2 font-medium">{column}</th>)}</tr></thead><tbody>{rows.map((row) => <tr key={row.id} className="border-t border-black/5 dark:border-white/5">{row.cells.map((cell, index) => <td key={index} className="px-3 py-2">{cell}</td>)}</tr>)}</tbody></table></div> : data?.availableCount != null && <p className="py-6 text-center text-sm text-text-muted">{data.kind === "claude" ? "No limit resets available for this account." : reset ? "No reset cards available." : "No reset credit details returned for this account."}</p>}
            </>}
          </>}
        </div>
      </div>
    </div>}
  </>;
}
