"use client";

import KeyAccountPicker from "./KeyAccountPicker";
import { createKeyRequest } from "./createKeyRequest";
import { OwnershipFields, ownershipValues } from "./KeyOwnership";
import { useId, useRef, useState } from "react";
import { Button, Input, Modal, ModelSelectModal } from "@/shared/components";
import { normalizeAllowList, validateKeyAccessInput } from "@/shared/utils/keyAccess";
import { expiryInstant } from "@/shared/utils/keyExpiryTime";
import { REQUEST_WINDOWS } from "@/shared/utils/requestWindows";

export default function CreateKeyModal({ connections, onClose, onCreated }) {
  const id = useId();
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [restricted, setRestricted] = useState(false);
  const [allowedConnections, setAllowedConnections] = useState([]);
  const [allow, setAllow] = useState([]);
  const [picker, setPicker] = useState(false);
  const [aliases, setAliases] = useState({});
  const pickerButton = useRef(null);
  async function openPicker() {
    setPicker(true);
    try {
      const res = await fetch("/api/models/alias");
      if (res.ok) setAliases((await res.json()).aliases || {});
    } catch {
      /* Other catalog entries remain available. */
    }
  }
  function closePicker() {
    setPicker(false);
    requestAnimationFrame(() => pickerButton.current?.focus());
  }
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const close = () => {
    if (!pending.current && !picker) onClose();
  };

  async function submit(event) {
    event.preventDefault();
    if (pending.current || picker) return;
    const form = event.currentTarget;
    const fields = new FormData(form);
    const payload = { name: fields.get("name").trim(), ...ownershipValues(fields) };
    if (restricted) {
      const checked = validateKeyAccessInput({ restricted: true, allow });
      if (!checked.ok) {
        setError(checked.error);
        return;
      }
      payload.access = checked.value;
    }
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      for (const { limit } of REQUEST_WINDOWS) {
        const raw = fields.get(limit);
        if (raw !== "") payload[limit] = Number(raw);
      }
      if (fields.get("expiresAt")) {
        try {
          payload.expiresAt = await expiryInstant(fields.get("expiresAt"), zone);
        } catch {
          setError("Invalid or ambiguous local time. Choose another time.");
          form.elements.expiresAt.focus();
          return;
        }
      }
      const res = await createKeyRequest(payload, allowedConnections);
      if (allowedConnections.length && (res.status === 401 || res.status === 403)) {
        setError("Sign in as administrator to change allowed accounts");
        return;
      }
      if (!res.ok) throw new Error();
      const data = await res.json();
      onCreated(data.key);
    } catch {
      setError("Creation not confirmed. Check your key list before trying again.");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return (
    <>
      <Modal isOpen title="Create API Key" onClose={close} className={picker ? "invisible" : ""}>
        <form
          className="flex flex-col gap-4"
          method="post"
          onSubmit={submit}
          onInput={() => setError("")}
        >
          <Input
            id={id + "-name"}
            label="Key Name"
            name="name"
            autoFocus
            pattern={".*\\S.*"}
            required
            placeholder="Production Key"
          />
          <OwnershipFields />
          <fieldset disabled={busy} className="space-y-1">
            <label className="inline-flex min-h-11 items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={restricted}
                onChange={(e) => setRestricted(e.target.checked)}
              />
              <span>Restrict model and combo access</span>
            </label>
            {restricted && (
              <>
                {allow.length === 0 && (
                  <p className="text-xs text-orange-500">
                    No combos or models allowed — this key can call nothing.
                  </p>
                )}
                <ul className="flex flex-wrap gap-2">
                  {allow.map((value) => (
                    <li key={value}>
                      <button
                        type="button"
                        onClick={() => setAllow((list) => list.filter((item) => item !== value))}
                        aria-label={`Remove ${value}`}
                        className="rounded border border-border px-2 py-1 text-sm"
                      >
                        <code>{value}</code> ×
                      </button>
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  ref={pickerButton}
                  onClick={openPicker}
                  className="min-h-11 text-sm font-medium text-primary"
                >
                  Add combo or model
                </button>
              </>
            )}
          </fieldset>
          <fieldset disabled={busy} className="space-y-2">
            <legend className="text-sm font-medium text-text-main">Allowed accounts</legend>
            <p className="text-xs text-text-muted">
              For each provider with a selection, only selected accounts can be used; other providers
              keep all accounts.
            </p>
            <KeyAccountPicker
              connections={connections}
              selected={allowedConnections}
              onChange={setAllowedConnections}
              disabled={busy}
            />
          </fieldset>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Request quotas</legend>
            <p id={id + "-limits"} className="text-xs text-text-muted">
              Leave a limit blank for unlimited requests. Periods reset in UTC.
            </p>
            <div className="grid grid-cols-2 gap-2">
              {REQUEST_WINDOWS.map(({ limit, name }) => (
                <Input
                  key={limit}
                  id={id + limit}
                  name={limit}
                  label={
                    { minute: "Per minute", hour: "Per hour", day: "Per day", month: "Per month" }[name]
                  }
                  type="number"
                  min="1"
                  max={Number.MAX_SAFE_INTEGER}
                  step="1"
                  inputMode="numeric"
                  aria-describedby={id + "-limits"}
                  inputClassName="user-invalid:border-red-500"
                />
              ))}
            </div>
          </fieldset>
          <div>
            <Input
              id={id + "-expiry"}
              label="Local expiry time"
              type="datetime-local"
              step="any"
              name="expiresAt"
              aria-describedby={id + "-zone"}
            />
            <p id={id + "-zone"} className="mt-1 text-xs text-text-muted">
              <span>{zone}</span> · <span>Leave blank for no expiry.</span>
            </p>
          </div>
          <p hidden={!error} role="alert" className="text-sm text-red-600">
            {error}
          </p>
          <div className="flex gap-2">
            <Button type="submit" fullWidth loading={busy}>
              Create
            </Button>
            <Button type="button" fullWidth variant="ghost" disabled={busy} onClick={close}>
              Cancel
            </Button>
          </div>
        </form>
      </Modal>
      {picker && (
        <ModelSelectModal
          isOpen
          title="Add combo or model"
          modelAliases={aliases}
          addedModelValues={allow}
          onSelect={(model) => setAllow((list) => normalizeAllowList([...list, model.value]))}
          onDeselect={(model) => setAllow((list) => list.filter((value) => value !== model.value))}
          onClose={closePicker}
        />
      )}
    </>
  );
}
