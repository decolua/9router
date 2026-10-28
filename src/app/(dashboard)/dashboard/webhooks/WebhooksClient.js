"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Badge, Button, Card, Modal, ConfirmModal } from "@/shared/components";
import WebhookForm from "./WebhookForm";

async function request(path, signal, method = "GET", body) {
  const response = await fetch(`/api/webhooks${path}`, {
    signal, method, cache: "no-store",
    ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) throw new Error("Session expired. Sign in, then retry; your form is still here.");
    if (response.status === 409) throw new Error("Destination changed elsewhere or the 20-destination limit was reached. Refresh destinations and retry without losing your form.");
    if (response.status === 429) throw new Error("The delivery queue is full. Wait, check delivery status and retry.");
    const fields = [...new Set((data.errors || []).map((entry) => entry.field))]
      .filter((field) => ["name", "kind", "url", "events", "cooldownSeconds", "headers", "signingSecret", "allowPrivateNetwork"].includes(field));
    throw new Error(fields.length ? `Check ${fields.join(", ")} and retry. Values were not saved.` : "Request failed. Check your connection and retry.");
  }
  return data;
}

function time(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

export default function WebhooksClient() {
  const [destinations, setDestinations] = useState([]);
  const [deliveries, setDeliveries] = useState([]);
  const [health, setHealth] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [deliveryError, setDeliveryError] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState(undefined);
  const [deleting, setDeleting] = useState(null);
  const [busy, setBusy] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const actionController = useRef(null);
  const errorRef = useRef(null);
  const addRef = useRef(null);
  const dialogRef = useRef(null);
  const initiatingRef = useRef(null);
  const mounted = useRef(false);
  const dialogOpen = editing !== undefined || deleting !== null;

  useEffect(() => {
    if (!dialogOpen) return;
    const dialog = dialogRef.current;
    const fallbackTrigger = addRef.current;
    const focusable = () => [...dialog.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]')]
      .filter((element) => !element.matches(":disabled") && element.getClientRects().length);
    const initial = dialog.querySelector("input") || focusable().find((element) => element.textContent === "Keep destination") || dialog;
    initial.focus();
    function trap(event) {
      if (event.key !== "Tab") return;
      const elements = focusable();
      const index = elements.indexOf(document.activeElement);
      if (!elements.length) { event.preventDefault(); dialog.focus(); }
      else if (event.shiftKey ? index <= 0 : index === -1 || index === elements.length - 1) {
        event.preventDefault();
        elements[event.shiftKey ? elements.length - 1 : 0].focus();
      }
    }
    function contain(event) { if (!dialog.contains(event.target)) (focusable()[0] || dialog).focus(); }
    document.addEventListener("keydown", trap);
    document.addEventListener("focusin", contain);
    return () => {
      document.removeEventListener("keydown", trap);
      document.removeEventListener("focusin", contain);
      const trigger = initiatingRef.current;
      requestAnimationFrame(() => (trigger?.isConnected && !trigger.disabled ? trigger : fallbackTrigger)?.focus());
    };
  }, [dialogOpen]);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; actionController.current?.abort(); };
  }, []);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    request("", controller.signal).then((data) => {
      if (!controller.signal.aborted) { setDestinations(data.destinations); setLoadError(""); }
    }).catch((failure) => {
      if (!controller.signal.aborted) setLoadError(failure.message);
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [refreshKey]);

  useEffect(() => {
    let timer;
    let controller;
    let stopped = false;
    async function poll() {
      if (stopped || document.visibilityState !== "visible") return;
      controller = new AbortController();
      const signal = controller.signal;
      try {
        const data = await request("/deliveries?limit=20", signal);
        if (!stopped && !signal.aborted) { setDeliveries(data.deliveries); setHealth(data.health); setDeliveryError(""); }
      } catch (failure) {
        if (!stopped && !signal.aborted) setDeliveryError(failure.message);
      } finally {
        if (!stopped && !signal.aborted) timer = setTimeout(poll, 5000);
      }
    }
    function visibility() {
      clearTimeout(timer);
      controller?.abort();
      if (document.visibilityState === "visible") poll();
    }
    poll();
    document.addEventListener("visibilitychange", visibility);
    return () => { stopped = true; clearTimeout(timer); controller?.abort(); document.removeEventListener("visibilitychange", visibility); };
  }, [refreshKey]);

  const closeForm = useCallback(() => {
    if (actionController.current) return;
    setEditing(undefined); setDeleting(null); setError("");
  }, []);
  function openForm(destination, trigger) {
    initiatingRef.current = trigger;
    setEditing(destination); setDeleting(null); setError("");
  }
  async function mutate(path, method, body, success) {
    if (actionController.current) return;
    const controller = new AbortController();
    actionController.current = controller;
    setBusy(true); setError(""); setNotice("");
    try {
      const data = await request(path, controller.signal, method, body);
      if (mounted.current && !controller.signal.aborted) { success(data); setRefreshKey((value) => value + 1); }
    } catch (failure) {
      if (mounted.current && !controller.signal.aborted) setError(failure.message);
    } finally {
      actionController.current = null;
      if (mounted.current) setBusy(false);
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-6 px-1 sm:px-0 text-text-main">
      <div className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-amber-700 dark:text-amber-400">
        <span aria-hidden="true" className="material-symbols-outlined shrink-0 text-base">warning</span>
        <p className="text-xs">If dashboard login is disabled, anyone who can reach this dashboard can manage webhook targets and send tests. This includes other users on your LAN when exposed there. Enable login in Settings before sharing access.</p>
      </div>
      <div role="status" className={notice ? "break-words text-sm" : "sr-only"}>{notice}</div>
      {error && !dialogOpen && <div ref={errorRef} role="alert" tabIndex={-1} className="rounded-[10px] border border-danger p-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">{error}</div>}
      <Card role="region" aria-labelledby="destinations-title" className="min-w-0 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="destinations-title" className="flex items-center gap-2 text-lg font-semibold"><span aria-hidden="true" className="material-symbols-outlined text-primary">webhook</span>Destinations</h2>
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" size="sm" aria-label="Refresh destinations" className="whitespace-nowrap shrink-0" disabled={loading || busy} onClick={() => setRefreshKey((value) => value + 1)}><span aria-hidden="true" className="material-symbols-outlined text-[18px]">refresh</span>Refresh destinations</Button>
            <Button ref={addRef} icon="add" aria-label="Add destination" className="whitespace-nowrap shrink-0" disabled={busy || dialogOpen} onClick={(event) => openForm(null, event.currentTarget)}>Add destination</Button>
          </div>
        </div>
        {loading && <p role="status">Loading destinations…</p>}
        {loadError && <p role="alert">{loadError} <Button variant="secondary" icon="refresh" aria-label="Retry loading" className="whitespace-nowrap shrink-0" onClick={() => setRefreshKey((value) => value + 1)}>Retry loading</Button></p>}
        {!loading && !loadError && destinations.length === 0 && <div className="py-12 text-center">
          <div aria-hidden="true" className="mb-4 inline-flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-primary"><span className="material-symbols-outlined text-3xl">webhook</span></div>
          <p className="mb-1 font-medium">No destinations yet.</p>
          <p className="mb-4 text-sm text-text-muted">Add one to receive alerts. Only final request failures are selected by default.</p>
          <Button icon="add" aria-label="Add destination" className="whitespace-nowrap shrink-0" disabled={busy || dialogOpen} onClick={(event) => openForm(null, event.currentTarget)}>Add destination</Button>
        </div>}
        <ul className="divide-y divide-border-subtle">
          {destinations.map((destination) => <li key={destination.id} className="py-3 space-y-2">
            <div className="flex flex-col justify-between gap-3 sm:flex-row">
              <div className="min-w-0 flex-1 space-y-1"><div className="flex flex-wrap items-center gap-2"><h3 className="min-w-0 text-sm font-medium break-words">{destination.name}</h3><Badge size="sm" variant={destination.enabled ? "success" : "default"}>{destination.enabled ? "Enabled" : "Disabled"}</Badge><Badge size="sm">{destination.kind}</Badge></div><p className="text-xs font-mono text-text-muted break-all">{destination.url?.scheme}://{destination.url?.host || "Not configured"}</p><p className="text-xs text-text-muted break-words">{destination.events.join(", ")} · Cooldown {destination.cooldownSeconds}s{destination.allowPrivateNetwork ? " · Private network allowed" : " · Public HTTPS only"}</p></div>
              <div className="flex flex-wrap gap-2">
                <Button variant="ghost" size="sm" icon="edit" className="whitespace-nowrap shrink-0" disabled={busy || dialogOpen} aria-label={`Edit ${destination.name}`} onClick={(event) => openForm(destination, event.currentTarget)}>Edit</Button>
                <Button variant="ghost" size="sm" icon="play_arrow" className="whitespace-nowrap shrink-0" disabled={busy || dialogOpen} aria-label={`Send saved synthetic test to ${destination.name}`} onClick={() => mutate(`/${encodeURIComponent(destination.id)}/test`, "POST", {}, (data) => setNotice(`Synthetic test queued: ${data.deliveryId}. Queued does not mean delivered; check the table below.`))}>Send test</Button>
                <Button variant="ghost" size="sm" icon="delete" className="whitespace-nowrap shrink-0 text-red-500 hover:text-red-600" disabled={busy || dialogOpen} aria-label={`Delete ${destination.name}`} onClick={(event) => { initiatingRef.current = event.currentTarget; setDeleting(destination); setError(""); }}>Delete</Button>
              </div>
            </div>
            {!destination.enabled && <p className="text-sm text-text-muted">Operational alerts are disabled. Send test explicitly queues one synthetic delivery to this saved destination.</p>}
          </li>)}
        </ul>
      </Card>
      <Card padding="none" role="region" aria-labelledby="deliveries-title" className="min-w-0 overflow-hidden">
        <div className="p-4 border-b border-border bg-bg-subtle/50">
          <h2 id="deliveries-title" className="font-semibold">Latest deliveries</h2>
        </div>
        <div className="space-y-3 p-4">
        <p className="text-sm text-text-muted">Latest 20; refreshes every 5 seconds while this page is visible. Tests use saved credentials, including for disabled destinations.</p>
        {health?.degraded?.enqueueFailures > 0 && <p role="alert" className="border border-border-subtle bg-surface-2 rounded-[10px] p-3 break-words">Delivery service degraded: {health.degraded.enqueueFailures} enqueue failures since process start. Some alerts could not be queued. Last class: {health.degraded.lastErrorClass || "unknown"}. Check server storage and queue capacity.</p>}
        {health && <p className="text-sm">Queue: {health.queue.pending} pending · {health.queue.inflight} in flight · {health.queue.retry} retrying · {health.queue.failed} failed</p>}
        {deliveryError && <p role="alert">Status may be stale. {deliveryError} <Button variant="secondary" icon="refresh" aria-label="Retry status" className="whitespace-nowrap shrink-0" onClick={() => setRefreshKey((value) => value + 1)}>Retry status</Button></p>}
        {!health && !deliveryError && <p role="status">Loading delivery status…</p>}
        {health && deliveries.length === 0 && <p className="text-text-muted">No deliveries recorded.</p>}
        </div>
        {deliveries.length > 0 && <div className="max-w-full overflow-x-auto focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" role="region" aria-label="Latest webhook deliveries" tabIndex={0}>
          <table className="w-full text-left text-sm"><caption className="sr-only">Latest webhook delivery status, including synthetic tests</caption>
            <thead className="bg-bg-subtle/30 text-text-muted uppercase text-xs"><tr>{["Destination / delivery", "Event / kind", "Status", "Attempts", "Last result", "Created / next retry"].map((heading) => <th key={heading} scope="col" className="px-6 py-3 whitespace-nowrap">{heading}</th>)}</tr></thead>
            <tbody className="divide-y divide-border">{deliveries.map((delivery) => <tr key={delivery.id} className="hover:bg-bg-subtle/50 transition-colors">
              <td className="px-6 py-3"><span className="block break-words">{destinations.find((item) => item.id === delivery.destinationId)?.name || "Deleted destination"}</span><span className="block text-xs text-text-muted break-all">{delivery.id}</span></td>
              <td className="px-6 py-3">{delivery.type}<span className="block text-text-muted">{delivery.deliveryKind}</span></td><td className="px-6 py-3"><Badge variant={delivery.status === "delivered" ? "success" : delivery.status === "failed" ? "error" : delivery.status === "retry" ? "warning" : "default"}>{delivery.status}</Badge></td><td className="px-6 py-3 tabular-nums">{delivery.attempts}</td>
              <td className="px-6 py-3">{delivery.lastStatus || "—"}<span className="block">{delivery.lastErrorClass || "—"}</span></td><td className="px-6 py-3 whitespace-nowrap">{time(delivery.createdAt)}<span className="block text-text-muted">{delivery.status === "retry" ? time(delivery.nextAttemptAt) : "—"}</span></td>
            </tr>)}</tbody>
          </table>
        </div>}
      </Card>
      {dialogOpen && <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={deleting ? "Delete destination" : editing ? "Edit destination" : "Add destination"} tabIndex={-1}>
        {editing !== undefined && <Modal isOpen title={editing ? "Edit destination" : "Add destination"} size="xl" onClose={closeForm} closeOnOverlay={!busy}>
          {error && <div ref={errorRef} role="alert" tabIndex={-1} className="mb-4 rounded-[10px] border border-danger p-3 text-sm">{error}</div>}
          <WebhookForm key={editing?.id || "new"} destination={editing} busy={busy} onCancel={closeForm}
            onSave={(input) => mutate(editing ? `/${encodeURIComponent(editing.id)}` : "", editing ? "PATCH" : "POST", input, () => { setEditing(undefined); setError(""); setNotice("Destination saved."); })} />
        </Modal>}
        {deleting && <ConfirmModal isOpen title="Delete destination" loading={busy} onClose={closeForm} confirmText="Confirm delete" cancelText="Keep destination"
          message={<><span className="block break-words">Delete <strong>{deleting.name}</strong>? Queued deliveries will be cancelled; already sent messages cannot be recalled.</span>{error && <span ref={errorRef} role="alert" tabIndex={-1} className="mt-3 block break-words text-sm text-red-500">{error}</span>}</>}
          onConfirm={() => mutate(`/${encodeURIComponent(deleting.id)}`, "DELETE", { expectedRevision: deleting.revision }, () => { initiatingRef.current = addRef.current; setDeleting(null); setError(""); setNotice("Destination deleted."); })} />}
      </div>}
    </div>
  );
}
