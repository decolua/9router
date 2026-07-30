"use client";

import { useState, useEffect } from "react";
import { Card, Button, Toggle, Select, Input, Modal } from "@/shared/components";

const MATCH_TYPES = [
  { value: "literal", label: "Literal" },
  { value: "regex", label: "Regex" },
];

const ACTIONS = [
  { value: "replace", label: "Replace" },
  { value: "delete", label: "Delete" },
];

export default function ConvoyPage() {
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(null); // rule being edited, or null
  const [showForm, setShowForm] = useState(false);
  const [providers, setProviders] = useState([]);
  const [error, setError] = useState("");

  // Form state
  const [form, setForm] = useState({
    name: "",
    enabled: true,
    priority: 1,
    matchType: "literal",
    action: "replace",
    pattern: "",
    replacement: "",
    caseSensitive: true,
    providerIds: [],
  });

  const refreshRules = async () => {
    try {
      const res = await fetch("/api/convoy/rules");
      const data = await res.json();
      setRules(data.items || []);
    } catch (e) {
      console.error("Failed to fetch rules", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetch("/api/convoy/rules")
      .then((res) => res.ok ? res.json() : Promise.reject(new Error("Failed to load rules")))
      .then((data) => setRules(data.items || []))
      .catch((e) => console.error("Failed to fetch rules", e))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    fetch("/api/providers")
      .then((res) => res.ok ? res.json() : Promise.reject(new Error("Failed to load providers")))
      .then((data) => {
        const seen = new Set();
        setProviders((data.connections || []).filter((item) => {
          if (!item.provider || seen.has(item.provider)) return false;
          seen.add(item.provider);
          return true;
        }).map((item) => ({ id: item.provider, name: item.name || item.displayName || item.provider })));
      })
      .catch(() => setProviders([]));
  }, []);

  const resetForm = () => {
    setForm({
      name: "",
      enabled: true,
      priority: rules.length + 1,
      matchType: "literal",
      action: "replace",
      pattern: "",
      replacement: "",
      caseSensitive: true,
      providerIds: [],
    });
    setEditing(null);
    setShowForm(false);
  };

  const openNew = () => {
    resetForm();
    setForm(f => ({ ...f, priority: rules.length + 1 }));
    setShowForm(true);
  };

  const openEdit = (rule) => {
    setEditing(rule.id);
    setForm({
      name: rule.name,
      enabled: rule.enabled,
      priority: rule.priority,
      matchType: rule.matchType || "literal",
      action: rule.action || "replace",
      pattern: rule.pattern,
      replacement: rule.replacement || "",
      caseSensitive: rule.caseSensitive,
      providerIds: rule.providerIds || [],
    });
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.name.trim() || !form.pattern.trim()) return;
    setSaving(true);
    setError("");
    try {
      const body = editing ? { ...form, id: editing } : form;
      const res = await fetch("/api/convoy/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        await refreshRules();
        resetForm();
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Failed to save rule");
      }
    } catch (e) {
      console.error("Failed to save rule", e);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm("Delete this rule?")) return;
    try {
      await fetch(`/api/convoy/rules?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      await refreshRules();
    } catch (e) {
      console.error("Failed to delete rule", e);
    }
  };

  const handleToggle = async (rule) => {
    try {
      await fetch("/api/convoy/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...rule, enabled: !rule.enabled }),
      });
      await refreshRules();
    } catch (e) {
      console.error("Failed to toggle rule", e);
    }
  };

  if (loading) return <div className="p-6 text-sm text-zinc-400">Loading...</div>;

  return (
    <div className="p-6 max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold text-zinc-100">Input Guard</h2>
          <p className="text-sm text-zinc-400 mt-1">
            Text replacement rules applied to chat request bodies before they reach upstream providers.
          </p>
        </div>
        <Button onClick={openNew}>+ Add Rule</Button>
      </div>

      {rules.length === 0 && !showForm && (
        <Card className="p-8 text-center text-zinc-500">
          No rules yet. Add a rule to start filtering request content.
        </Card>
      )}

      {rules.map((rule) => (
        <Card key={rule.id} className="mb-3 p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-sm font-medium text-zinc-200">{rule.name}</span>
                <span className="text-xs text-zinc-500">#{rule.priority}</span>
              </div>
              <div className="text-xs text-zinc-400 font-mono truncate">
                <span className="text-zinc-500">{rule.matchType}:</span>{" "}
                {rule.pattern.length > 60 ? rule.pattern.slice(0, 60) + "..." : rule.pattern}
                {rule.action === "replace" && (
                  <>
                    {" "}
                    <span className="text-emerald-500">{"->"}</span>{" "}
                    {(rule.replacement || "").length > 40
                      ? (rule.replacement || "").slice(0, 40) + "..."
                      : rule.replacement || "(empty)"}
                  </>
                )}
                {rule.action === "delete" && (
                  <>
                    {" "}
                    <span className="text-red-500">[delete]</span>
                  </>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Toggle checked={rule.enabled} onChange={() => handleToggle(rule)} />
              <Button variant="ghost" size="sm" onClick={() => openEdit(rule)}>
                Edit
              </Button>
              <Button variant="ghost" size="sm" onClick={() => handleDelete(rule.id)}>
                Delete
              </Button>
            </div>
          </div>
        </Card>
      ))}

      {showForm && (
        <Modal isOpen={showForm} onClose={resetForm} title={editing ? "Edit Rule" : "New Rule"} size="lg">
          <div className="space-y-4">
            <Input
              label="Name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. Claude -> CodeBuddy"
            />
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs text-zinc-400 mb-1">Match Type</label>
                <Select
                  value={form.matchType}
                  onChange={(e) => setForm({ ...form, matchType: e.target.value })}
                  options={MATCH_TYPES}
                />
              </div>
              <div>
                <label className="block text-xs text-zinc-400 mb-1">Action</label>
                <Select
                  value={form.action}
                  onChange={(e) => setForm({ ...form, action: e.target.value })}
                  options={ACTIONS}
                />
              </div>
              <div>
                <label className="block text-xs text-zinc-400 mb-1">Priority</label>
                <Input
                  type="number"
                  value={form.priority}
                  onChange={(e) => setForm({ ...form, priority: parseInt(e.target.value) || 0 })}
                />
              </div>
            </div>
            <Input
              label="Pattern"
              value={form.pattern}
              onChange={(e) => setForm({ ...form, pattern: e.target.value })}
              placeholder={
                form.matchType === "regex"
                  ? "e.g. You are \\w+ Code"
                  : "e.g. You are Claude Code"
              }
            />
            {form.action === "replace" && (
              <Input
                label="Replacement"
                value={form.replacement}
                onChange={(e) => setForm({ ...form, replacement: e.target.value })}
                placeholder="e.g. You are CodeBuddy"
              />
            )}
            <div>
              <div className="mb-2 flex items-center justify-between gap-3">
                <label className="text-xs text-zinc-400">Providers</label>
                <span className="text-xs text-zinc-500">None selected means all providers</span>
              </div>
              <div className="max-h-40 overflow-y-auto rounded-lg border border-white/10 p-2">
                {providers.length === 0 ? (
                  <div className="p-2 text-xs text-zinc-500">No connected providers</div>
                ) : providers.map((provider) => {
                  const checked = form.providerIds.includes(provider.id);
                  return (
                    <label key={provider.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-white/5">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => setForm({
                          ...form,
                          providerIds: checked
                            ? form.providerIds.filter((id) => id !== provider.id)
                            : [...form.providerIds, provider.id],
                        })}
                      />
                      <span className="text-sm text-zinc-300">{provider.name}</span>
                      <span className="ml-auto font-mono text-xs text-zinc-500">{provider.id}</span>
                    </label>
                  );
                })}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Toggle
                checked={form.enabled}
                onChange={(checked) => setForm({ ...form, enabled: checked })}
              />
              <span className="text-sm text-zinc-300">Enabled</span>
              <span className="mx-2 text-zinc-600">|</span>
              <Toggle
                checked={form.caseSensitive}
                onChange={(checked) => setForm({ ...form, caseSensitive: checked })}
              />
              <span className="text-sm text-zinc-300">Case Sensitive</span>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              {error && <div className="mr-auto self-center text-sm text-red-400">{error}</div>}
              <Button variant="ghost" onClick={resetForm}>Cancel</Button>
              <Button onClick={handleSave} disabled={saving}>
                {saving ? "Saving..." : "Save"}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
