"use client";

import { useId, useState } from "react";
import { Button, Input, Tooltip } from "@/shared/components";
import { translate } from "@/i18n/runtime";
import { KEY_NAME_MAX, keyFieldLimits } from "@/shared/utils/keyOwnership";

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

export function KeyEditButton({ apiKey, onEdit }) {
  return (
    <Tooltip text="Edit key details">
      <Button
        type="button"
        size="sm"
        variant="ghost"
        icon="edit"
        className="size-8 p-0"
        aria-label={translate("Edit key details") + ": " + apiKey.name}
        onClick={onEdit}
      />
    </Tooltip>
  );
}

// Full-width form under the key header: name plus ownership details.
export function KeyEditForm({ apiKey, onSaved, onClose }) {
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save(event) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    const fields = { name: form.get("name")?.trim() || "", ...ownershipValues(form) };
    if (!fields.name) {
      setError("Name is required");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/keys/${encodeURIComponent(apiKey.id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fields),
      });
      if (!res.ok) throw new Error();
      const { key } = await res.json();
      onSaved({ name: key.name, owner: key.owner, project: key.project, description: key.description });
      onClose();
    } catch {
      setError("Could not save key details");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      method="post"
      aria-label={translate("Edit key details") + ": " + apiKey.name}
      onSubmit={save}
      className="mt-4 space-y-3 border-t border-border pt-4"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Input id={id + "name"} name="name" label="Name" required maxLength={KEY_NAME_MAX} defaultValue={apiKey.name} />
        <Input id={id + "project"} name="project" label={labels.project} maxLength={keyFieldLimits.project} defaultValue={apiKey.project ?? ""} />
        <Input id={id + "owner"} name="owner" label={labels.owner} maxLength={keyFieldLimits.owner} defaultValue={apiKey.owner ?? ""} />
        <Input id={id + "description"} name="description" label={labels.description} maxLength={keyFieldLimits.description} defaultValue={apiKey.description ?? ""} />
      </div>
      {error && <p role="alert" className="text-sm text-danger">{translate(error)}</p>}
      <div className="flex justify-end gap-2">
        <Button size="sm" type="button" disabled={busy} variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button size="sm" type="submit" loading={busy}>
          Save
        </Button>
      </div>
    </form>
  );
}
