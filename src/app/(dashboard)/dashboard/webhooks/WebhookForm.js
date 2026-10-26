"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/shared/components";

const fieldClass = "w-full min-w-0 rounded-[10px] border border-transparent bg-surface-2 px-3 py-2.5 text-[16px] sm:text-sm text-text-main focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500/40 disabled:opacity-50 disabled:cursor-not-allowed";
const events = ["request.failed", "account.unavailable", "token.refresh_failed"];

export default function WebhookForm({ destination, busy, onSave, onCancel }) {
  const firstInput = useRef(null);
  const [form, setForm] = useState({
    name: destination?.name || "", kind: destination?.kind || "discord", url: "",
    enabled: destination?.enabled ?? true, events: destination?.events || ["request.failed"],
    allowPrivateNetwork: destination?.allowPrivateNetwork || false,
    cooldownSeconds: destination?.cooldownSeconds ?? 300, signingSecret: "",
    clearSigningSecret: false, headerMode: "keep", headers: [{ name: "", value: "" }],
  });
  const set = (key, value) => setForm((previous) => ({ ...previous, [key]: value }));
  useEffect(() => { firstInput.current?.focus(); }, []);

  function submit(event) {
    event.preventDefault();
    const { headerMode, headers, signingSecret, clearSigningSecret, url, ...values } = form;
    const input = { ...values, cooldownSeconds: Number(values.cooldownSeconds) };
    if (url) input.url = url;
    if (values.kind === "generic") {
      if (signingSecret) input.signingSecret = signingSecret;
      else if (destination && clearSigningSecret) input.clearSigningSecret = true;
      if (headerMode === "replace") input.headers = Object.fromEntries(headers.map((row) => [row.name, row.value]));
      else if (destination && headerMode === "clear") input.clearHeaders = true;
    } else if (destination?.kind === "generic") {
      input.clearHeaders = true;
      input.clearSigningSecret = true;
    }
    if (destination) input.expectedRevision = destination.revision;
    onSave(input);
  }

  return (
      <form onSubmit={submit} className="min-w-0 space-y-6">
        <fieldset disabled={busy} className="min-w-0 space-y-6 text-sm disabled:opacity-60">
          <fieldset className="min-w-0 space-y-4">
            <legend className="mb-3 font-semibold">Destination</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="min-w-0 space-y-1.5 block font-medium">Name
              <input ref={firstInput} className={fieldClass} required maxLength={80} value={form.name} onChange={(e) => set("name", e.target.value)} />
            </label>
            <label className="min-w-0 space-y-1.5 block font-medium">Kind
              <span className="relative block">
              <select className={`${fieldClass} appearance-none pr-10`} value={form.kind} onChange={(e) => set("kind", e.target.value)}>
                <option value="discord">Discord</option><option value="slack">Slack</option><option value="generic">Generic JSON</option>
              </select>
              <span aria-hidden="true" className="material-symbols-outlined pointer-events-none absolute inset-y-0 right-3 flex items-center text-xl text-text-muted">expand_more</span>
              </span>
            </label>
          </div>
          <label className="space-y-1.5 block font-medium">{destination ? "Replace URL (leave blank to keep)" : "Webhook URL"}
            <input className={fieldClass} type="password" autoComplete="new-password" spellCheck={false} required={!destination} maxLength={2048} value={form.url} onChange={(e) => set("url", e.target.value)} aria-describedby="webhook-url-help" />
          </label>
          <p id="webhook-url-help" className="text-xs text-text-muted">URLs are credentials and are never revealed. Use HTTPS for public destinations. No userinfo or fragments.</p>
          <label className="flex items-center justify-between gap-4 border-t border-border-subtle pt-4"><span className="font-medium">Enabled for operational events</span><input className="h-4 w-4 shrink-0 accent-primary" type="checkbox" checked={form.enabled} onChange={(e) => set("enabled", e.target.checked)} /></label>
          </fieldset>
          <fieldset className="min-w-0 space-y-4 border-t border-border-subtle pt-4">
            <legend className="pr-2 font-semibold">Events (choose at least one)</legend>
            <div className="divide-y divide-border-subtle">
            {events.map((type) => <label key={type} className="flex items-center justify-between gap-4 py-3"><span className="min-w-0 break-words">{type}{type !== "request.failed" && <span className="text-text-muted"> (opt-in)</span>}</span><input className="h-4 w-4 shrink-0 accent-primary" type="checkbox" checked={form.events.includes(type)} onChange={(e) => set("events", e.target.checked ? [...form.events, type] : form.events.filter((value) => value !== type))} /></label>)}
            </div>
            <p className="text-xs text-text-muted">request.failed reports the final failure after fallback. Opt-in account and refresh events can be more frequent.</p>
          <label className="space-y-1.5 block font-medium">Cooldown (seconds, 0–3600)
            <input className={fieldClass} type="number" min={0} max={3600} step={1} required value={form.cooldownSeconds} onChange={(e) => set("cooldownSeconds", e.target.value)} />
          </label>
          </fieldset>
          <fieldset className="min-w-0 space-y-3 border-t border-border-subtle pt-4">
          <legend className="pr-2 font-semibold">Network policy</legend>
          <label className="flex items-center justify-between gap-4"><span className="font-medium">Allow private network and HTTP</span><input className="h-4 w-4 shrink-0 accent-primary" type="checkbox" checked={form.allowPrivateNetwork} onChange={(e) => set("allowPrivateNetwork", e.target.checked)} aria-describedby="webhook-network-help" /></label>
          <p id="webhook-network-help" className="text-xs text-text-muted">Opt-in permits HTTP and local/LAN targets, including localhost. HTTP exposes credentials and payloads in transit. Metadata, link-local, unspecified, multicast and broadcast addresses remain blocked; redirects are never followed.</p>
          </fieldset>
          {form.kind === "generic" && <fieldset className="min-w-0 space-y-4 border-t border-border-subtle pt-4">
            <legend className="pr-2 font-semibold">Generic JSON credentials</legend>
            <label className="space-y-1.5 block font-medium">Replace signing secret (leave blank to keep)
              <input className={fieldClass} type="password" autoComplete="new-password" maxLength={2048} value={form.signingSecret} disabled={form.clearSigningSecret} onChange={(e) => set("signingSecret", e.target.value)} />
            </label>
            <p className="text-xs text-text-muted">{destination?.hasSigningSecret ? "A signing secret is configured." : "A random signing secret is generated when omitted on create."} Generic JSON uses Standard Webhooks signatures. Secrets cannot be revealed here; set your own to configure a receiver.</p>
            {destination && <label className="flex items-center gap-2"><input className="h-4 w-4 shrink-0 accent-primary" type="checkbox" checked={form.clearSigningSecret} onChange={(e) => { set("clearSigningSecret", e.target.checked); set("signingSecret", ""); }} />Clear and regenerate signing secret (never unsigned)</label>}
            <label className="space-y-1.5 block font-medium">Headers
              <span className="relative block">
              <select className={`${fieldClass} appearance-none pr-10`} value={form.headerMode} onChange={(e) => set("headerMode", e.target.value)}>
                <option value="keep">{destination ? `Keep saved headers (${destination.headerCount || 0})` : "No custom headers"}</option>
                <option value="replace">Replace all headers</option>
                {destination && <option value="clear">Clear all saved headers</option>}
              </select>
              <span aria-hidden="true" className="material-symbols-outlined pointer-events-none absolute inset-y-0 right-3 flex items-center text-xl text-text-muted">expand_more</span>
              </span>
            </label>
            <p className="text-xs text-text-muted">Only Authorization and allowed X-* headers, up to 8. Routing/forwarding headers are blocked. Blank edit fields preserve saved credentials; replacement requires every new value.</p>
            {form.headerMode === "replace" && <div className="space-y-3">
              {form.headers.map((row, index) => <div key={index} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                <label className="min-w-0 space-y-1.5 block font-medium">Header {index + 1} name<input className={fieldClass} required value={row.name} onChange={(e) => set("headers", form.headers.map((item, i) => i === index ? { ...item, name: e.target.value } : item))} /></label>
                <label className="min-w-0 space-y-1.5 block font-medium">Header {index + 1} value<input className={fieldClass} required type="password" autoComplete="new-password" maxLength={2048} value={row.value} onChange={(e) => set("headers", form.headers.map((item, i) => i === index ? { ...item, value: e.target.value } : item))} /></label>
                <Button type="button" variant="ghost" icon="delete" className="self-end" disabled={form.headers.length === 1} onClick={() => set("headers", form.headers.filter((_, i) => i !== index))} aria-label={`Remove header ${index + 1}`}>Remove</Button>
              </div>)}
              <Button type="button" variant="secondary" icon="add" aria-label="Add header" className="whitespace-nowrap shrink-0" disabled={form.headers.length >= 8} onClick={() => set("headers", [...form.headers, { name: "", value: "" }])}>Add header</Button>
            </div>}
          </fieldset>}
          {destination?.kind === "generic" && form.kind !== "generic" && <p className="text-xs text-text-muted">Changing away from Generic JSON clears its saved headers and signing secret.</p>}
          <p className="text-xs text-text-muted">Disabling, deleting or changing delivery credentials/network policy cancels queued deliveries for the old revision. Already sent messages cannot be recalled.</p>
        </fieldset>
        <div className="flex flex-wrap justify-end gap-2 border-t border-border-subtle pt-4">
          <Button type="button" variant="secondary" disabled={busy} onClick={onCancel}>Cancel</Button>
          <Button type="submit" className="whitespace-nowrap shrink-0" loading={busy}>Save destination</Button>
        </div>
      </form>
  );
}
