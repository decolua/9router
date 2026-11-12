"use client";

import { useEffect, useState } from "react";
import { ResetCreditControls, formatCreditDate } from "../ResetCredits";
import { getConnectionLabel } from "../utils";
import { normalizeResetCard, getResetCardTypeLabel, isResetCardExpired, readPendingResetAttempt, savePendingResetAttempt, clearPendingResetAttempt, classifyResetPostOutcome } from "../glmResetCardsLogic";

function storage() {
  try { return window.localStorage; } catch { return null; }
}
function pendingFor(id) {
  const read = readPendingResetAttempt(storage(), id);
  return read.status === "ok" ? read.attempt : read.status === "invalid" ? { invalid: true } : null;
}

export default function GlmResetCredits(props) {
  const { connection, quota, onRefresh } = props;
  const [pending, setPending] = useState(() => pendingFor(connection.id));
  const [inventory, setInventory] = useState(undefined);
  const [snapshot, setSnapshot] = useState(quota?.raw);
  const [refreshNeeded, setRefreshNeeded] = useState(false);
  const [checked, setChecked] = useState(false);
  if (snapshot !== quota?.raw) {
    setSnapshot(quota?.raw);
    setInventory(undefined);
  }
  useEffect(() => {
    const update = () => { setPending(pendingFor(connection.id)); setChecked(false); };
    window.addEventListener("storage", update);
    return () => window.removeEventListener("storage", update);
  }, [connection.id]);
  const current = inventory === undefined ? quota?.raw?.resetCards : inventory;
  const load = async () => {
    setPending(pendingFor(connection.id));
    setChecked(false);
    const response = await fetch(`/api/usage/${connection.id}/glm-reset-cards`, { cache: "no-store" });
    const data = await response.json().catch(() => null);
    if (!response.ok || !Array.isArray(data?.cards) || !Number.isSafeInteger(data.availableCount) || data.availableCount < 0) {
      setInventory(null);
      throw new Error(data?.error || data?.message || "Could not load GLM reset cards");
    }
    const result = { ...data, cards: data.cards.map(normalizeResetCard).filter(Boolean).sort((a, b) => Date.parse(a.expiresAt) - Date.parse(b.expiresAt)).map((card) => ({ ...card, label: getResetCardTypeLabel(card.type) })) };
    setInventory(result);
    return result;
  };
  const finish = async () => {
    setRefreshNeeded(true);
    if (!await onRefresh()) throw new Error("Could not refresh quota; the reset result is preserved. Open card details to finish.");
    await load();
    setRefreshNeeded(false);
  };
  const clear = () => {
    if (!clearPendingResetAttempt(storage(), connection.id)) throw new Error("Could not clear recovery info. Check your GLM dashboard before continuing.");
    setPending(null);
    setChecked(false);
  };
  const prepare = async () => {
    const latest = pendingFor(connection.id);
    setPending(latest);
    if (latest || refreshNeeded) throw new Error("Resolve the unfinished reset in card details before using another card.");
    const cards = (await load()).cards.filter((card) => !isResetCardExpired(card.expiresAt));
    if (!cards.length) throw new Error("No GLM reset cards available.");
    return { cards, card: cards.length === 1 ? cards[0] : null };
  };
  const redeem = async ({ card }) => {
    const latest = pendingFor(connection.id);
    setPending(latest);
    if (latest || refreshNeeded) throw new Error("Resolve the unfinished reset before using another card.");
    if (!card || isResetCardExpired(card.expiresAt)) throw new Error("Select a valid, unexpired GLM reset card.");
    const attempt = { provider: "glm", card: normalizeResetCard(card), startedAt: new Date().toISOString() };
    if (!savePendingResetAttempt(storage(), connection.id, attempt)) throw new Error("Could not save recovery info. For safety the card was not used.");
    setPending(attempt);
    let outcome;
    try {
      const response = await fetch(`/api/usage/${connection.id}/glm-reset-cards`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ recordId: card.recordId, type: card.type }) });
      outcome = classifyResetPostOutcome({ ok: response.ok, payload: await response.json().catch(() => null) });
    } catch { outcome = { kind: "uncertain" }; }
    if (outcome.kind !== "success") throw new Error(outcome.message || "GLM reset outcome is uncertain. Check your GLM dashboard before trying again.");
    clear();
    await finish();
  };
  const resolve = async (wasUsed) => {
    if (!checked || JSON.stringify(pendingFor(connection.id)) !== JSON.stringify(pending)) throw new Error("The unfinished attempt changed. Reopen details and check the GLM dashboard.");
    clear();
    if (wasUsed) await finish();
  };
  return <ResetCreditControls {...props} reset={{
    name: "GLM", label: "GLM reset card", title: "GLM Reset Cards", count: current?.availableCount ?? null, blocked: Boolean(pending || refreshNeeded), load, prepare, redeem,
    invalid: (selection) => !selection?.card || isResetCardExpired(selection.card.expiresAt),
    message: (selection) => selection?.card ? `Use one ${getResetCardTypeLabel(selection.card.type)} reset card for ${getConnectionLabel(connection)}. Card expires ${formatCreditDate(selection.card.expiresAt)}. This cannot be undone.` : "Choose a five-hour or weekly reset. This consumes one reset card and cannot be undone.",
    selection: (selection, update) => selection && <label className="mb-3 block text-sm text-text-primary">Quota window to reset<select aria-label="Quota window to reset" value={selection.card?.id || ""} onChange={(event) => update({ ...selection, card: selection.cards.find((card) => card.id === event.target.value) || null })} className="mt-1 w-full rounded-lg border border-border-subtle bg-surface px-3 py-2"><option value="" disabled>Select a reset card</option>{selection.cards.map((card) => <option key={card.id} value={card.id} disabled={isResetCardExpired(card.expiresAt)}>{getResetCardTypeLabel(card.type)} · expires {formatCreditDate(card.expiresAt)}</option>)}</select></label>,
    recovery: ({ run, reload, busy }) => <>
      {refreshNeeded && <button type="button" disabled={busy} onClick={() => run(async () => { await finish(); await reload(); })} className="rounded-lg border px-3 py-1 text-xs disabled:opacity-50">Refresh to finish</button>}
      {pending && <div className="space-y-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
        <p>{pending.invalid ? "The unfinished attempt marker is unreadable. Check your GLM dashboard before discarding it." : "Unfinished reset attempt — it may or may not have been used. No other card can be used until it is resolved."}</p>
        {!pending.invalid && <p className="text-xs">{getResetCardTypeLabel(pending.card.type)} · expires {formatCreditDate(pending.card.expiresAt)} · attempted {formatCreditDate(pending.startedAt)}</p>}
        <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={checked} onChange={(event) => setChecked(event.target.checked)} />I checked my GLM dashboard for this card&apos;s status</label>
        <div className="flex gap-2">{pending.invalid ? <button type="button" disabled={!checked || busy} onClick={() => run(() => resolve(false))} className="rounded-lg border px-3 py-1 text-xs disabled:opacity-50">Discard unreadable marker</button> : <>
          <button type="button" disabled={!checked || busy} onClick={() => run(async () => { await resolve(true); await reload(); })} className="rounded-lg border px-3 py-1 text-xs disabled:opacity-50">Card was used</button>
          <button type="button" disabled={!checked || busy} onClick={() => run(() => resolve(false))} className="rounded-lg border px-3 py-1 text-xs disabled:opacity-50">Card was not used</button>
        </>}</div>
      </div>}
    </>,
  }} />;
}
