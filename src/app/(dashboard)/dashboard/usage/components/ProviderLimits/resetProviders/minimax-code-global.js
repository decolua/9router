"use client";

import { useState } from "react";
import { ResetCreditControls, formatCreditDate } from "../ResetCredits";
import { getConnectionLabel } from "../utils";

export default function MiniMaxResetCredits(props) {
  const { connection, quota, onRefresh } = props;
  const [inventory, setInventory] = useState(null);
  const endpoint = `/api/usage/${connection.id}/minimax-reset-cards`;
  if (connection.authType !== "oauth") return <ResetCreditControls {...props} />;
  const apply = (result) => {
    if (Object.hasOwn(result, "pending") && !(result.uncertain && result.pending === null)) setInventory((previous) => ({ ...previous, ...result }));
  };
  const load = async () => {
    const response = await fetch(endpoint, { cache: "no-store" });
    const result = await response.json().catch(() => ({}));
    apply(result);
    if (!response.ok || !Array.isArray(result.cards)) throw new Error(result.message || result.error || "Could not load MiniMax reset cards");
    return result;
  };
  const post = async (body) => {
    let response;
    try { response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); }
    catch { throw new Error("MiniMax reset outcome is uncertain. Open card details before retrying."); }
    const result = await response.json().catch(() => ({}));
    apply(result);
    if (!response.ok || (body.acknowledge ? result.confirmed !== true : result.reset !== true && result.alreadyUsed !== true)) throw new Error(result.message || result.error || "MiniMax reset outcome is uncertain. Open card details before retrying.");
    return result;
  };
  const finish = async (card, expectedAttempt) => {
    if (!await onRefresh()) throw new Error("Could not refresh quota; the reset result is preserved. Open card details to finish.");
    let current = await load();
    if (current.pending) {
      if (current.pending.state !== "refreshing" || current.pending.attemptId !== expectedAttempt || current.pending.card.cardId !== card.cardId) throw new Error("The reset attempt changed. Open card details before continuing.");
      await post({ cardId: card.cardId, attemptId: expectedAttempt, acknowledge: true });
      current = await load();
    }
    return current;
  };
  const prepare = async () => {
    const current = await load();
    if (current.pending) throw new Error("Resolve the previous reset using the clock before using another card.");
    const card = [...current.cards].filter((entry) => Date.parse(entry.expiresAt) > Date.now()).sort((a, b) => Date.parse(a.expiresAt) - Date.parse(b.expiresAt))[0];
    if (!card) throw new Error("No MiniMax reset cards available.");
    return { card };
  };
  const redeem = async (selection) => {
    const current = await load();
    if (selection.retry ? current.pending?.attemptId !== selection.pending?.attemptId : Boolean(current.pending)) throw new Error("The reset recovery state changed. Open card details before continuing.");
    const result = await post({ cardId: selection.card.cardId, ...(selection.retry ? { retry: true, attemptId: selection.pending.attemptId } : {}) });
    await finish(selection.card, result.pending?.attemptId);
  };
  return <ResetCreditControls {...props} reset={{
    name: "MiniMax", label: "MiniMax reset card", title: "MiniMax Reset Cards", count: inventory?.availableCount ?? quota?.raw?.resetCards?.availableCount ?? null, blocked: Boolean(inventory?.pending), load, prepare, redeem,
    invalid: (selection) => !selection?.card || Date.parse(selection.card.expiresAt) <= Date.now(),
    message: (selection) => `${selection?.retry ? "Retry the same" : "Use one"} MiniMax full-reset card for ${getConnectionLabel(connection)}. Card expires ${formatCreditDate(selection?.card?.expiresAt)}. This cannot be undone.`,
    recovery: ({ run, reload, confirm, busy }) => inventory?.pending && <div className="space-y-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
      <p>{inventory.pending.state === "refreshing" ? "Reset confirmed; refresh quota and inventory to finish." : "The previous reset is uncertain. No other card can be used until it is resolved."}</p>
      <p className="text-xs">Pending card expires {formatCreditDate(inventory.pending.card.expiresAt)}</p>
      {inventory.pending.state === "refreshing" ? <button type="button" disabled={busy} onClick={() => run(async () => { await finish(inventory.pending.card, inventory.pending.attemptId); await reload(); })} className="rounded-lg border px-3 py-1 text-xs disabled:opacity-50">Refresh to finish</button> : <div className="flex gap-2">
        <button type="button" disabled={busy} onClick={() => run(async () => {
          const response = await fetch(`${endpoint}?cardId=${encodeURIComponent(inventory.pending.card.cardId)}`, { cache: "no-store" });
          const result = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(result.message || result.error || "Could not check the reset result");
          await reload();
        })} className="rounded-lg border px-3 py-1 text-xs disabled:opacity-50">Check result</button>
        <button type="button" disabled={busy || Date.parse(inventory.pending.card.expiresAt) <= Date.now()} onClick={() => confirm({ card: inventory.pending.card, pending: inventory.pending, retry: true })} className="rounded-lg border px-3 py-1 text-xs disabled:opacity-50">Retry this card</button>
      </div>}
    </div>,
  }} />;
}
