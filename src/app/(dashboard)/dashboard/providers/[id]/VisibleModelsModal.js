"use client";

import { useEffect, useMemo, useState } from "react";
import PropTypes from "prop-types";
import { Button, Modal } from "@/shared/components";
import { getModelsByProviderId, getModelKind } from "@/shared/constants/models";

// Pick the models a provider exposes on /v1/models ("visible models" allowlist).
//
// The list here is deliberately wider than the provider page's model chips:
// providers with a live catalog (GitHub Copilot, …) expose models upstream that
// the static registry has never listed, and only an allowlist can hide those —
// a blacklist built from the registry can never name them. Live entries come
// from /api/providers/[connectionId]/models, with the registry as fallback.
//
// Saving an empty selection clears the allowlist = no restriction.
export default function VisibleModelsModal({
  isOpen,
  onClose,
  providerId,
  providerAlias,
  connections,
  customModels,
  disabledModelIds,
  onSaved,
}) {
  const [available, setAvailable] = useState([]);
  const [selected, setSelected] = useState(() => new Set());
  const [search, setSearch] = useState("");
  // The page mounts this modal only while it is open, so fresh state already
  // means "loading" — no setState needed at the top of the fetch effect.
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const activeConnectionIds = useMemo(
    () => (connections || []).filter((c) => c.isActive !== false && c.id).map((c) => c.id),
    [connections]
  );

  useEffect(() => {
    if (!isOpen) return undefined;
    let cancelled = false;

    (async () => {
      let current = [];
      try {
        const res = await fetch(
          `/api/models/enabled?providerAlias=${encodeURIComponent(providerAlias)}`,
          { cache: "no-store" }
        );
        if (res.ok) current = (await res.json()).ids || [];
      } catch {
        // Treat as "no allowlist" — the modal still works, it just starts from
        // the currently visible set.
      }

      const liveLists = await Promise.all(
        activeConnectionIds.map(async (connectionId) => {
          try {
            const res = await fetch(`/api/providers/${connectionId}/models`, { cache: "no-store" });
            if (!res.ok) return [];
            const data = await res.json();
            return Array.isArray(data?.models) ? data.models : [];
          } catch {
            return [];
          }
        })
      );
      if (cancelled) return undefined;

      const seen = new Set();
      const rows = [];
      const push = (id, name, extra = {}) => {
        const key = String(id ?? "").trim();
        if (!key || seen.has(key)) return;
        seen.add(key);
        rows.push({ id: key, name: name || key, ...extra });
      };

      // Live catalog first — these are the ids missing from the registry.
      for (const list of liveLists) {
        for (const entry of list) {
          const id = typeof entry === "string" ? entry : entry?.id;
          const name = typeof entry === "string" ? entry : (entry?.name || entry?.id);
          push(id, name, { live: true });
        }
      }
      for (const model of getModelsByProviderId(providerId) || []) {
        const kind = getModelKind(model, "llm");
        if (kind && kind !== "llm") continue;
        push(model.id, model.name);
      }
      // Allowlisted ids that no longer show up in any catalog stay listed, so
      // saving cannot silently drop them.
      for (const id of current) push(id, id, { stale: true });

      const disabledSet = new Set(disabledModelIds || []);
      const defaults = current.length > 0
        ? current
        : rows.filter((row) => !row.isCustom && !disabledSet.has(row.id)).map((row) => row.id);

      setAvailable(rows);
      setSelected(new Set(defaults));
      setLoading(false);
      return undefined;
    })();

    return () => { cancelled = true; };
  }, [isOpen, providerId, providerAlias, activeConnectionIds, disabledModelIds]);

  // Custom models are merged into /v1/models after the allowlist, so they are
  // always visible — showing them as toggleable would be a lie.
  const customRows = useMemo(
    () => (customModels || [])
      .filter((m) => m.providerAlias === providerAlias && (m.kind || m.type || "llm") === "llm")
      .map((m) => ({ id: String(m.id).trim(), name: m.name || m.id }))
      .filter((m) => m.id),
    [customModels, providerAlias]
  );

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return available;
    return available.filter(
      (row) => row.id.toLowerCase().includes(query) || row.name.toLowerCase().includes(query)
    );
  }, [available, search]);

  const toggle = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    setError("");
    try {
      const ids = Array.from(selected);
      const res = await fetch("/api/models/enabled", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerAlias, ids }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Failed to save (${res.status})`);
      }
      onSaved?.(ids);
      onClose();
    } catch (e) {
      setError(e?.message || "Failed to save visible models");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Visible models" size="lg" footer={null}>
      <div className="flex flex-col gap-3 p-4">
        <div className="flex items-start gap-2 rounded-lg border border-primary/20 bg-primary/8 px-2.5 py-2 text-xs text-text-muted">
          <span className="material-symbols-outlined shrink-0 text-primary" style={{ fontSize: "14px" }}>info</span>
          <span>
            Only the checked models are exposed on <code className="font-mono">/v1/models</code>. Leave
            everything unchecked to expose all of them. Custom models are always exposed.
          </span>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <span className="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted text-[16px]">
              search
            </span>
            <input
              type="text"
              placeholder="Search..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded border border-border bg-surface py-1.5 pl-8 pr-3 text-xs focus:outline-none focus:ring-1 focus:ring-primary/50"
            />
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSelected(new Set(available.map((row) => row.id)))}
            disabled={loading || saving}
          >
            Select all
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSelected(new Set())}
            disabled={loading || saving}
          >
            Clear
          </Button>
        </div>

        {error && <p className="text-xs text-red-500 break-words">{error}</p>}

        {loading ? (
          <p className="py-6 text-center text-xs text-text-muted">Loading models…</p>
        ) : (
          <div className="max-h-[360px] overflow-y-auto rounded-lg border border-border">
            {filtered.map((row) => (
              <label
                key={row.id}
                className="flex cursor-pointer items-center gap-2 border-b border-border/50 px-3 py-2 last:border-b-0 hover:bg-sidebar/50"
              >
                <input
                  type="checkbox"
                  checked={selected.has(row.id)}
                  onChange={() => toggle(row.id)}
                  className="size-3.5 accent-primary cursor-pointer"
                />
                <span className="truncate text-xs text-text-main">{row.name}</span>
                <code className="truncate font-mono text-[11px] text-text-muted">{row.id}</code>
                {row.live && !row.stale && (
                  <span className="ml-auto shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">live</span>
                )}
                {row.stale && (
                  <span className="ml-auto shrink-0 rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-600 dark:text-amber-400">not in catalog</span>
                )}
              </label>
            ))}
            {filtered.length === 0 && (
              <p className="py-6 text-center text-xs text-text-muted">No models found</p>
            )}
          </div>
        )}

        {customRows.length > 0 && (
          <div className="rounded-lg border border-border px-3 py-2">
            <p className="mb-1 text-[11px] text-text-muted">Always exposed (custom models)</p>
            <div className="flex flex-wrap gap-1.5">
              {customRows.map((row) => (
                <span key={row.id} className="rounded bg-sidebar px-1.5 py-0.5 font-mono text-[11px] text-text-muted">
                  {row.id}
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-text-muted">
            {selected.size === 0
              ? "Nothing selected — all models stay visible."
              : `${selected.size} of ${available.length} selected`}
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>Cancel</Button>
            <Button variant="primary" size="sm" onClick={handleSave} loading={saving} disabled={loading}>
              Save
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

VisibleModelsModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  providerId: PropTypes.string.isRequired,
  providerAlias: PropTypes.string.isRequired,
  connections: PropTypes.arrayOf(PropTypes.object),
  customModels: PropTypes.arrayOf(PropTypes.object),
  disabledModelIds: PropTypes.arrayOf(PropTypes.string),
  onSaved: PropTypes.func,
};
