"use client";

import { useEffect, useId, useState } from "react";
import { Button, Input } from "@/shared/components";
import { REQUEST_WINDOWS } from "@/shared/utils/requestWindows";
import KeySection from "./KeySection";

const labels = { minute: "Per minute", hour: "Per hour", day: "Per day", month: "Per month" };

// One reader per key with a quota or an open detail; list and detail share its counters.
export function QuotaReader({ keyId, onResult, revision }) {
  useEffect(() => {
    const controller = new AbortController();
    const path = "/api/keys/" + encodeURIComponent(keyId) + "/request-quotas";
    fetch(path, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error();
        const { windows } = await response.json();
        if (!controller.signal.aborted) onResult(keyId, windows);
      })
      .catch(() => {
        if (!controller.signal.aborted) onResult(keyId, false);
      });
    return () => controller.abort();
  }, [keyId, onResult, revision]);
  return null;
}

export function QuotaBar({ name, used, limit }) {
  const percent = (used / limit) * 100;
  const color = percent < 70 ? "bg-success" : percent < 90 ? "bg-warning" : "bg-danger";
  return (
    <span
      role="meter"
      aria-label={name}
      aria-valuemin={0}
      aria-valuemax={limit}
      aria-valuenow={Math.min(used, limit)}
      aria-valuetext={used + " / " + limit}
      className="block h-1.5 overflow-hidden rounded-full bg-border"
    >
      <span
        className={`block h-full rounded-full ${color}`}
        style={{ width: Math.min(100, percent) + "%" }}
      />
    </span>
  );
}

export default function KeyRequestQuotas({ keyId, windows, onSaved, reload }) {
  const heading = useId();
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function save(event) {
    event.preventDefault();
    if (busy) return;
    const fields = new FormData(event.currentTarget);
    const changes = {};
    for (const { name, limit } of REQUEST_WINDOWS) {
      const raw = fields.get(limit);
      const value = raw === "" ? null : Number(raw);
      if (value !== windows[name].limit) changes[limit] = value;
    }
    setBusy(true);
    setMessage("");
    try {
      if (Object.keys(changes).length) {
        const response = await fetch("/api/keys/" + encodeURIComponent(keyId), {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(changes),
        });
        if (!response.ok) throw new Error();
      }
      onSaved(changes);
      reload();
      setEditing(false);
      setMessage("Request quotas saved.");
    } catch {
      setMessage("Could not save quotas. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeySection
      icon="speed"
      title="Request quotas"
      description="Leave a limit blank for unlimited requests. Periods reset in UTC."
      action={
        !editing &&
        windows && (
          <Button size="sm" variant="outline" icon="edit" onClick={() => setEditing(true)}>
            Edit
          </Button>
        )
      }
    >
      {windows === false ? (
        <div role="alert" className="flex items-center justify-between gap-2 text-sm">
          <span>Could not load quotas.</span>
          <Button size="sm" variant="ghost" onClick={reload}>
            Retry
          </Button>
        </div>
      ) : !windows ? (
        <p role="status" className="text-sm text-text-muted">
          Loading quotas...
        </p>
      ) : editing ? (
        <form aria-label="Request quotas" method="post" onSubmit={save}>
          <div className="grid gap-3 sm:grid-cols-2">
            {REQUEST_WINDOWS.map(({ name, limit }) => (
              <div key={name}>
                <Input
                  id={heading + name}
                  name={limit}
                  label={labels[name]}
                  type="number"
                  inputMode="numeric"
                  min="1"
                  max={Number.MAX_SAFE_INTEGER}
                  step="1"
                  defaultValue={windows[name].limit ?? ""}
                  disabled={busy}
                  aria-describedby={heading + name + "-remaining"}
                />
                <p id={heading + name + "-remaining"} className="mt-1 text-xs text-text-muted">
                  <span>Remaining</span>: <span>{windows[name].remaining ?? "Unlimited"}</span>
                </p>
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="submit" size="sm" loading={busy}>
              Save request quotas
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => setEditing(false)}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <ul className="divide-y divide-border">
          {REQUEST_WINDOWS.map(({ name }) => {
            const { used, limit } = windows[name];
            return (
              <li key={name} className="grid grid-cols-2 items-center gap-x-4 gap-y-2 py-2 text-sm">
                <span>{labels[name]}</span>
                <span className="text-end tabular-nums text-text-muted">
                  {limit === null ? "Unlimited" : used + " / " + limit}
                </span>
                {limit !== null && (
                  <div className="col-span-2">
                    <QuotaBar name={labels[name]} used={used} limit={limit} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {message && (
        <p role="status" className="mt-2 text-xs text-text-muted">
          {message}
        </p>
      )}
    </KeySection>
  );
}
