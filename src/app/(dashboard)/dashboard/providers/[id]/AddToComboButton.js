"use client";

import { useEffect, useRef, useState } from "react";
import PropTypes from "prop-types";
import { translate } from "@/i18n/runtime";

const DEFAULT_BUTTON_CLASS = "rounded p-0.5 text-text-muted hover:bg-sidebar hover:text-primary transition-colors";

// "+" button next to a model's name: opens a small popover to add that model
// to an existing combo (PUT /api/combos/:id, replacing its `models` array) or
// to a brand-new one (POST /api/combos). `fullModel` must be the exact
// "<alias>/<modelId>" string the row already uses for combo-membership
// detection (candidatesForModelId / comboNamesFor in page.js) — writing
// anything else here would make "already in this combo" and actual routing
// disagree. `comboNames` (combo names that already contain this model, as
// computed by that same page.js helper) drives the "already in" state.
export default function AddToComboButton({ fullModel, combos, comboNames = [], onChanged, buttonClassName = DEFAULT_BUTTON_CLASS }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [justAddedId, setJustAddedId] = useState(null);
  const [formError, setFormError] = useState("");
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    const onKeyDown = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const closeAndReset = () => {
    setOpen(false);
    setSearch("");
    setCreating(false);
    setNewName("");
    setFormError("");
  };

  const alreadyIn = new Set(comboNames);
  const filtered = (combos || []).filter((c) =>
    c.name.toLowerCase().includes(search.trim().toLowerCase())
  );

  const handleAdd = async (combo) => {
    if (busyId) return;
    setBusyId(combo.id);
    setFormError("");
    try {
      const members = Array.isArray(combo.models) ? combo.models : [];
      const nextModels = members.includes(fullModel) ? members : [...members, fullModel];
      const res = await fetch(`/api/combos/${combo.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ models: nextModels }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setFormError(data?.error || translate("Failed to update the combo"));
        return;
      }
      setJustAddedId(combo.id);
      onChanged?.();
      setTimeout(() => setJustAddedId((id) => (id === combo.id ? null : id)), 1500);
    } catch {
      setFormError(translate("Failed to update the combo"));
    } finally {
      setBusyId(null);
    }
  };

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name || busyId) return;
    setBusyId("__new__");
    setFormError("");
    try {
      const res = await fetch("/api/combos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, models: [fullModel] }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setFormError(data?.error || translate("Failed to create the combo"));
        return;
      }
      onChanged?.();
      closeAndReset();
    } catch {
      setFormError(translate("Failed to create the combo"));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <span className="relative inline-flex shrink-0" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={buttonClassName}
        title={translate("Add to a combo")}
      >
        <span className="material-symbols-outlined text-[17px]">add</span>
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-64 max-w-[85vw] rounded-lg border border-border bg-surface p-2 shadow-2xl">
          <p className="mb-1.5 px-0.5 text-[11px] font-semibold text-text-main">{translate("Add to a combo")}</p>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={translate("Search combos…")}
            autoFocus
            className="mb-1.5 w-full rounded-md border border-border bg-bg px-2 py-1.5 text-xs focus:border-primary focus:outline-none"
          />
          <div className="max-h-52 overflow-y-auto">
            {filtered.length === 0 && (
              <p className="px-1 py-1 text-[11px] text-text-muted">{translate("No combos found")}</p>
            )}
            {filtered.map((combo) => {
              const isIn = alreadyIn.has(combo.name);
              const isBusy = busyId === combo.id;
              const isJustAdded = justAddedId === combo.id;
              return (
                <button
                  key={combo.id}
                  type="button"
                  disabled={isIn || isBusy}
                  onClick={() => handleAdd(combo)}
                  className={`flex w-full items-center justify-between gap-2 rounded-md px-1.5 py-1.5 text-left text-xs transition-colors ${
                    isIn ? "cursor-not-allowed text-text-muted/60" : "text-text-main hover:bg-black/5 dark:hover:bg-white/5"
                  }`}
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="material-symbols-outlined shrink-0 text-[14px] text-text-muted">layers</span>
                    <span className="truncate">{combo.name}</span>
                    {Array.isArray(combo.models) && (
                      <span className="shrink-0 text-[10px] text-text-muted/70">{combo.models.length}</span>
                    )}
                  </span>
                  {isJustAdded ? (
                    <span className="material-symbols-outlined shrink-0 text-[15px] text-green-500">check</span>
                  ) : isBusy ? (
                    <span className="material-symbols-outlined shrink-0 text-[15px]" style={{ animation: "spin 1s linear infinite" }}>progress_activity</span>
                  ) : isIn ? (
                    <span className="inline-flex shrink-0 items-center gap-0.5 text-[10px] text-green-600/80 dark:text-green-400/80" title={translate("Already in this combo")}>
                      <span className="material-symbols-outlined text-[13px]">check_circle</span>
                      {translate("Added")}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>

          <div className="mt-1.5 border-t border-border pt-1.5">
            {creating ? (
              <div className="flex items-center gap-1">
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleCreate();
                    if (e.key === "Escape") setCreating(false);
                  }}
                  placeholder={translate("Combo name")}
                  autoFocus
                  className="min-w-0 flex-1 rounded-md border border-border bg-bg px-2 py-1.5 text-xs focus:border-primary focus:outline-none"
                />
                <button
                  type="button"
                  onClick={handleCreate}
                  disabled={!newName.trim() || busyId === "__new__"}
                  className="shrink-0 rounded p-1 text-primary hover:bg-primary/10 disabled:opacity-40"
                >
                  <span className="material-symbols-outlined text-[17px]">check</span>
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setCreating(true)}
                className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1.5 text-left text-xs font-medium text-primary hover:bg-primary/5"
              >
                <span className="material-symbols-outlined text-[15px]">add</span>
                {translate("New combo…")}
              </button>
            )}
          </div>

          {formError && <p className="mt-1 text-[10px] text-red-500">{formError}</p>}
        </div>
      )}
    </span>
  );
}

AddToComboButton.propTypes = {
  fullModel: PropTypes.string.isRequired,
  combos: PropTypes.arrayOf(PropTypes.shape({
    id: PropTypes.string,
    name: PropTypes.string,
    models: PropTypes.array,
  })),
  comboNames: PropTypes.arrayOf(PropTypes.string),
  onChanged: PropTypes.func,
  buttonClassName: PropTypes.string,
};
