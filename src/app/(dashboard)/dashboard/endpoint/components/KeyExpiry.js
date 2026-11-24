"use client";

import { useEffect, useId, useState } from "react";
import { expiryInput, expiryInstant } from "@/shared/utils/keyExpiryTime";

import { Button, Input } from "@/shared/components";
import { getCurrentLocale, translate } from "@/i18n/runtime";
import KeySection from "./KeySection";

function Editor({ keyId, saved, zone, onSaved, onCancel }) {
  const id = useId();
  const [local, setLocal] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    expiryInput(saved, zone)
      .then((value) => {
        if (active) setLocal(value);
      })
      .catch(() => {
        if (active) setMessage("Could not load expiry. Reopen to retry.");
      });
    return () => {
      active = false;
    };
  }, [saved, zone]);

  async function persist(remove) {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      let value = null;
      if (!remove) {
        try {
          value = await expiryInstant(local, zone, saved);
        } catch {
          setMessage("Invalid or ambiguous local time. Choose another time.");
          return;
        }
      }
      const res = await fetch("/api/keys/" + encodeURIComponent(keyId), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expiresAt: value }),
      });
      if (!res.ok) throw new Error();
      const { key } = await res.json();
      onSaved(key.expiresAt, remove ? "Expiry removed." : "Expiry saved.");
    } catch {
      setMessage("Could not save expiry. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="space-y-3 text-sm"
      method="post"
      onSubmit={(event) => {
        event.preventDefault();
        persist(false);
      }}
    >
      <Input
        id={id}
        aria-describedby={id + "-zone"}
        name="expiresAt"
        label="Local expiry time"
        type="datetime-local"
        step="any"
        required
        value={local ?? ""}
        disabled={busy || local === null}
        onChange={(event) => {
          setLocal(event.target.value);
          setMessage("");
        }}
      />
      <p id={id + "-zone"} className="text-xs text-text-muted">
        {zone}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={local === null} loading={busy}>
          Save expiry
        </Button>
        {saved && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => persist(true)}
          >
            Remove expiry
          </Button>
        )}
        <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
      <p role="status" className="text-text-muted">
        {message}
      </p>
    </form>
  );
}

export default function KeyExpiry({ keyId, expiresAt, onSaved, now }) {
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const date = expiresAt ? new Date(expiresAt) : null;
  const days = date ? Math.ceil((date.getTime() - now) / 86_400_000) : null;
  return (
    <KeySection
      icon="event"
      title="Expiry"
      description={
        date ? (
          <>
            <time dateTime={expiresAt}>
              {date.toLocaleString(getCurrentLocale(), { timeZoneName: "short" })}
            </time>
            {" · "}
            <span>{days <= 0 ? "Expired" : translate("{days} days left").replace("{days}", days)}</span>
          </>
        ) : (
          "No expiry"
        )
      }
      action={
        !open && (
          <Button
            size="sm"
            variant="outline"
            icon="edit"
            onClick={() => {
              setNotice("");
              setOpen(true);
            }}
          >
            Edit
          </Button>
        )
      }
    >
      {open && (
        <Editor
          keyId={keyId}
          saved={expiresAt}
          zone={zone}
          onSaved={(value, message) => {
            onSaved(value);
            setNotice(message);
            setOpen(false);
          }}
          onCancel={() => setOpen(false)}
        />
      )}
      {notice && (
        <p role="status" className="text-xs text-text-muted">
          {notice}
        </p>
      )}
    </KeySection>
  );
}
