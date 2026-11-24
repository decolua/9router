"use client";

import { useId, useState } from "react";
import { Button, Input, Tooltip } from "@/shared/components";
import { translate } from "@/i18n/runtime";
import { keyFieldLimits } from "@/shared/utils/keyOwnership";

const labels = { description: "Description", owner: "Owner", project: "Project" };

export function ownershipValues(formData) {
  return Object.fromEntries(
    Object.keys(labels).map((field) => [field, formData.get(field)?.trim() || null]),
  );
}

export function OwnershipFields({ values = {} }) {
  const id = useId();
  return (
    <div className="grid gap-2">
      {Object.entries(labels).map(([field, label]) => (
        <Input
          key={field}
          id={id + field}
          label={label}
          name={field}
          maxLength={keyFieldLimits[field]}
          defaultValue={values[field] ?? ""}
        />
      ))}
    </div>
  );
}

export default function KeyOwnership({ apiKey, onSaved }) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  async function save(event) {
    event.preventDefault();
    if (busy) return;
    const fields = ownershipValues(new FormData(event.currentTarget));
    setBusy(true);
    setError(false);
    try {
      const res = await fetch(`/api/keys/${encodeURIComponent(apiKey.id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fields),
      });
      if (!res.ok) throw new Error();
      const { key } = await res.json();
      onSaved({ owner: key.owner, project: key.project, description: key.description });
      setEditing(false);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }
  return editing ? (
    <form
      method="post"
      aria-label={translate("Edit key details") + ": " + apiKey.name}
      onSubmit={save}
      className="my-2 space-y-2"
    >
      <OwnershipFields values={apiKey} />
      {error && <p role="alert">Could not save key details</p>}
      <div className="flex gap-2">
        <Button size="sm" type="submit" loading={busy}>
          Save
        </Button>
        <Button
          size="sm"
          type="button"
          disabled={busy}
          variant="secondary"
          onClick={() => setEditing(false)}
        >
          Cancel
        </Button>
      </div>
    </form>
  ) : (
    <Tooltip text="Edit key details">
      <Button
        type="button"
        size="sm"
        variant="ghost"
        icon="edit"
        className="size-8 p-0"
        aria-label={translate("Edit key details") + ": " + apiKey.name}
        onClick={() => {
          setError(false);
          setEditing(true);
        }}
      />
    </Tooltip>
  );
}
