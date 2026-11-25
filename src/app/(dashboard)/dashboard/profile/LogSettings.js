"use client";

import { useEffect, useState } from "react";
import { Button, ConfirmModal, Input } from "@/shared/components";

import { SettingsCard } from "./SessionSettings";

const warning =
  "Debug capture stores prompts and responses. Credentials are masked, but personal information may remain. Bodies are cleared 24 hours after capture ends.";
const pageSize = 20;
export default function LogSettings({ settings }) {
  const [until, setUntil] = useState(() =>
    Date.parse(settings.debugBodyLoggingUntil) > Date.now() ? settings.debugBodyLoggingUntil : null,
  );
  const [minutes, setMinutes] = useState(15);
  const [days, setDays] = useState(settings.auditRetentionDays);
  const [confirm, setConfirm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [filters, setFilters] = useState({});
  const [page, setPage] = useState(1);
  const [revision, reload] = useState(0);
  const [result, setResult] = useState(null);
  const active = Boolean(until);

  useEffect(() => {
    if (!until) return;
    const timer = setTimeout(() => setUntil(null), Math.max(0, Date.parse(until) - Date.now()));
    return () => clearTimeout(timer);
  }, [until]);

  useEffect(() => {
    const abort = new AbortController();
    const params = new URLSearchParams({ ...filters, page, pageSize });
    fetch("/api/audit-log?" + params, { signal: abort.signal, cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw new Error();
        return r.json();
      })
      .then((data) => {
        if (!abort.signal.aborted) setResult(data);
      })
      .catch(() => {
        if (!abort.signal.aborted) setResult({ error: true });
      });
    return () => abort.abort();
  }, [filters, page, revision]);

  async function change(enable) {
    setBusy(true);
    try {
      const r = await fetch("/api/settings/debug-logging", {
        method: enable ? "POST" : "DELETE",
        headers: { "Content-Type": "application/json" },
        body: enable ? JSON.stringify({ minutes }) : undefined,
      });
      if (!r.ok) throw new Error();
      setUntil((await r.json()).debugBodyLoggingUntil);
      setMessage("");
      reload((v) => v + 1);
    } catch {
      setMessage("Could not change debug capture.");
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  }

  async function saveDays(event) {
    event.preventDefault();
    setBusy(true);
    try {
      const r = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ auditRetentionDays: Number(days) }),
      });
      if (!r.ok) throw new Error();
      setMessage("Retention saved.");
      reload((v) => v + 1);
    } catch {
      setMessage("Could not save retention.");
    } finally {
      setBusy(false);
    }
  }
  function filter(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const next = {};
    if (form.get("action").trim()) next.action = form.get("action").trim();
    for (const key of ["startDate", "endDate"])
      if (form.get(key)) next[key] = new Date(form.get(key)).toISOString();
    setFilters(next);
    setPage(1);
  }

  return (
    <>
      <SettingsCard icon="policy" title="Body logging (debug)">
        <p className="my-2 text-sm text-text-muted">{warning}</p>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <p className="text-sm font-medium" role="status">
            {active ? (
              <>
                Capture ends at <time dateTime={until}>{new Date(until).toLocaleString()}</time>
              </>
            ) : (
              "Capture is off."
            )}
          </p>
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              setConfirm(!active);
            }}
          >
            {!active && (
              <Input
                id="capture-minutes"
                type="number"
                label="Duration (minutes)"
                min={1}
                max={1440}
                required
                value={minutes}
                onChange={(e) => setMinutes(e.target.value === "" ? "" : Number(e.target.value))}
              />
            )}
            <Button type="submit" disabled={busy}>
              {active ? "Stop capture" : "Start capture"}
            </Button>
          </form>
        </div>
        <ConfirmModal
          isOpen={confirm !== null}
          onClose={() => setConfirm(null)}
          onConfirm={() => change(confirm)}
          title={confirm ? "Start capture" : "Stop capture"}
          message={confirm ? warning : "Stop recording new bodies now?"}
          confirmText={confirm ? "Start capture" : "Stop capture"}
          loading={busy}
        />
      </SettingsCard>
      <SettingsCard icon="receipt_long" title="Audit log">
        <form className="my-3 flex flex-wrap items-end gap-3" onSubmit={saveDays}>
          <Input
            id="retention-days"
            label="Retention (days)"
            type="number"
            required
            min={1}
            max={3650}
            value={days}
            onChange={(e) => setDays(e.target.value)}
          />
          <Button type="submit" variant="outline" disabled={busy}>
            Save retention
          </Button>
        </form>
        <form className="my-3 flex flex-wrap items-end gap-3" onSubmit={filter}>
          <Input id="audit-action" name="action" label="Action" placeholder="key.rotate" />
          <Input id="audit-start" name="startDate" label="From" type="datetime-local" />
          <Input id="audit-end" name="endDate" label="Until" type="datetime-local" />
          <Button type="submit" variant="outline">
            Filter
          </Button>
        </form>
        {result?.error ? (
          <p role="alert">Could not load audit log.</p>
        ) : !result ? (
          <p role="status">Loading…</p>
        ) : !result.entries.length ? (
          <p>No matching events.</p>
        ) : (
          <div className="overflow-x-auto" role="region" aria-labelledby="audit-caption" tabIndex={0}>
            <table className="w-full min-w-max border-collapse text-left text-xs">
              <caption id="audit-caption" className="sr-only">
                Audit log
              </caption>
              <thead className="bg-bg">
                <tr className="border-b border-border">
                  {[
                    "Time",
                    "Action",
                    "Actor",
                    "Role",
                    "Target",
                    "Result",
                    "Peer IP",
                    "Changed fields",
                  ].map((h) => (
                    <th className="px-3 py-2 font-semibold text-text-muted" scope="col" key={h}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {result.entries.map((r) => (
                  <tr className="transition-colors hover:bg-surface-2/50" key={r.id}>
                    {[
                      new Date(r.timestamp).toLocaleString(),
                      r.action,
                      r.actor,
                      r.actorRole,
                      r.target,
                      r.result,
                      r.ip,
                      r.detail.fields?.join(", "),
                    ].map((v, i) => (
                      <td className="px-3 py-2" key={i}>
                        {v || "—"}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex items-center justify-center gap-1 px-2 py-4 sm:justify-end">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((n) => n - 1)}>
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!result?.hasNext}
            onClick={() => setPage((n) => n + 1)}
          >
            Next
          </Button>
        </div>
        <p role="status">{message}</p>
      </SettingsCard>
    </>
  );
}
