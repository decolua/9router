"use client";

import { useEffect, useState } from "react";
import { Button, Card, ConfirmModal, ModelSelectModal } from "@/shared/components";

export default function ModelGroupsPage() {
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [editor, setEditor] = useState(null);
  const [picker, setPicker] = useState("");
  const [aliases, setAliases] = useState({});
  const [deleting, setDeleting] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/key-model-groups")
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not load groups.");
        if (!cancelled) setGroups(data.groups);
      })
      .catch((err) => { if (!cancelled) setError(err.message || "Could not load groups."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const openPicker = async (kind) => {
    setPicker(kind);
    try {
      const response = await fetch("/api/models/alias");
      if (!response.ok) throw new Error("Could not load model aliases.");
      setAliases((await response.json()).aliases || {});
    } catch (err) {
      setError(err.message || "Could not load model aliases.");
    }
  };

  const addModels = (models) => setEditor((current) => {
    if (!current) return current;
    const seen = new Set(current.allow.map((value) => value.toLowerCase()));
    const additions = models.map((model) => model?.value).filter((value) => {
      if (!value || seen.has(value.toLowerCase())) return false;
      seen.add(value.toLowerCase());
      return true;
    });
    return { ...current, allow: [...current.allow, ...additions] };
  });
  const removeModels = (models) => setEditor((current) => {
    if (!current) return current;
    const values = new Set(models.map((model) => model.value.toLowerCase()));
    return { ...current, allow: current.allow.filter((value) => !values.has(value.toLowerCase())) };
  });

  const save = async (event) => {
    event.preventDefault();
    if (!editor.name.trim()) { setError("Enter a group name."); return; }
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/key-model-groups", {
        method: editor.id ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...(editor.id ? { id: editor.id } : {}), name: editor.name.trim(), allow: editor.allow }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not save group.");
      setGroups((current) => editor.id ? current.map((group) => group.id === editor.id ? data.group : group) : [...current, data.group]);
      setEditor(null);
    } catch (err) {
      setError(err.message || "Could not save group.");
    } finally {
      setBusy(false);
    }
  };

  const deleteGroup = async () => {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/key-model-groups?id=${encodeURIComponent(deleting.id)}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not delete group.");
      setGroups((current) => current.filter((group) => group.id !== deleting.id));
      if (editor?.id === deleting.id) setEditor(null);
      setDeleting(null);
    } catch (err) {
      setDeleting(null);
      setError(err.message || "Could not delete group.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-text-main">Model Groups</h1>
          <p className="mt-1 text-sm text-text-muted">Manage reusable model access lists for API keys. Linked keys always use the current group contents.</p>
        </div>
        <Button onClick={() => { setError(""); setEditor({ name: "", allow: [] }); }} disabled={busy || !!editor}>Create group</Button>
      </div>
      {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
      {editor && (
        <Card>
          <form onSubmit={save} className="space-y-4">
            <h2 className="text-lg font-semibold text-text-main">{editor.id ? "Edit group" : "Create group"}</h2>
            {editor.id && <p className="text-sm text-text-muted">Changes affect every API key linked to this group.</p>}
            <div>
              <label htmlFor="group-name" className="block text-sm font-medium text-text-main mb-1">Group name</label>
              <input id="group-name" value={editor.name} onChange={(event) => setEditor({ ...editor, name: event.target.value })} maxLength={100} required className="w-full rounded-lg border border-border-subtle bg-surface px-3 py-2 text-text-main" />
            </div>
            <div className="space-y-2">
              <h3 className="text-sm font-medium text-text-main">Allowed models, combos and providers</h3>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="secondary" onClick={() => openPicker("llm")} disabled={busy}>Add models or combos</Button>
                <Button type="button" variant="secondary" onClick={() => openPicker("realtime")} disabled={busy}>Add realtime models</Button>
              </div>
              {editor.allow.length ? (
                <ul className="space-y-1">
                  {editor.allow.map((value) => <li key={value} className="flex items-center justify-between gap-2 rounded-lg bg-surface-2 px-3 py-2 text-sm text-text-main"><span className="break-all">{value}</span><button type="button" onClick={() => removeModels([{ value }])} disabled={busy} aria-label={`Remove ${value}`} className="text-text-muted hover:text-red-500">Remove</button></li>)}
                </ul>
              ) : <p className="text-sm text-text-muted">No entries selected.</p>}
            </div>
            <div className="flex gap-2">
              <Button type="submit" loading={busy}>Save group</Button>
              <Button type="button" variant="ghost" disabled={busy} onClick={() => { setEditor(null); setError(""); }}>Cancel</Button>
            </div>
          </form>
        </Card>
      )}
      {loading ? <p className="text-sm text-text-muted">Loading groups…</p> : groups.length === 0 ? <p className="text-sm text-text-muted">No model groups yet.</p> : (
        <div className="space-y-3">
          {groups.map((group) => (
            <Card key={group.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="font-semibold text-text-main break-words">{group.name}</h2>
                  <p className="mt-1 text-sm text-text-muted break-all">{group.allow.length ? group.allow.join(", ") : "No entries"}</p>
                </div>
                <div className="flex gap-2">
                  <Button variant="secondary" disabled={busy || !!editor} aria-label={`Edit ${group.name}`} onClick={() => { setError(""); setEditor({ id: group.id, name: group.name, allow: [...group.allow] }); }}>Edit</Button>
                  <Button variant="danger" disabled={busy || !!editor} aria-label={`Delete ${group.name}`} onClick={() => setDeleting(group)}>Delete</Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
      {picker && editor && <ModelSelectModal isOpen onClose={() => setPicker("")} onSelect={(model) => addModels([model])} onDeselect={(model) => removeModels([model])} onSelectBatch={addModels} onDeselectBatch={removeModels} modelAliases={aliases} title={`Allowed for ${editor.name || "new group"}`} kindFilter={picker === "realtime" ? "realtime" : null} addedModelValues={editor.allow} closeOnSelect={false} allowProviderWildcard />}
      <ConfirmModal isOpen={!!deleting} onClose={() => { if (!busy) setDeleting(null); }} onConfirm={deleteGroup} title="Delete model group" message={`Delete “${deleting?.name}”? Deletion is blocked while any API key is linked to this group.`} confirmText="Delete" loading={busy} />
    </div>
  );
}
