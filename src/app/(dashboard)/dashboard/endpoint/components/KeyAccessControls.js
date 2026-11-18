"use client";

// Per-API-key access control on the Endpoint page.
import { useEffect, useState } from "react";
import PropTypes from "prop-types";
import Link from "next/link";
import { Toggle, ModelSelectModal } from "@/shared/components";

export default function KeyAccessControls({ apiKey, onChange, onRequestRestrict }) {
  const access = apiKey.access || { restricted: false, allow: [] };
  const [pickerOpen, setPickerOpen] = useState(false);
  const [activeProviders, setActiveProviders] = useState([]);
  const [modelAliases, setModelAliases] = useState({});
  const [groups, setGroups] = useState([]);
  const [groupError, setGroupError] = useState("");
  const [groupBusy, setGroupBusy] = useState(false);

  useEffect(() => { loadGroups(); }, [apiKey.id]);

  const loadGroups = async () => {
    setGroupBusy(true);
    setGroupError("");
    try {
      const response = await fetch("/api/key-model-groups");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load groups.");
      setGroups(data.groups);
    } catch (error) {
      setGroupError(error.message || "Could not load groups.");
    } finally {
      setGroupBusy(false);
    }
  };


  const updateGroupLink = async (token, expand = false) => {
    setGroupError("");
    setGroupBusy(true);
    try {
      const normalized = token.toLowerCase();
      const linked = access.allow.some((entry) => entry.toLowerCase() === normalized);
      let allow = access.allow.filter((entry) => entry.toLowerCase() !== normalized);
      if (expand) {
        const response = await fetch("/api/key-model-groups");
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not load groups.");
        setGroups(data.groups);
        const group = data.groups.find((item) => `@group/${item.id}`.toLowerCase() === normalized);
        if (!group) throw new Error("Cannot expand a group that no longer exists. Detach it instead.");
        const seen = new Set(allow.map((entry) => entry.toLowerCase()));
        for (const entry of group.allow) {
          if (!seen.has(entry.toLowerCase())) {
            seen.add(entry.toLowerCase());
            allow.push(entry);
          }
        }
      } else if (!linked) {
        allow.push(token);
      }
      if (allow.length > 200) throw new Error("Cannot update group: a key can have at most 200 allowed entries.");
      const error = await onChange({ restricted: true, allow });
      if (error) setGroupError(error);
    } catch (error) {
      setGroupError(error.message || "Could not update key access.");
    } finally {
      setGroupBusy(false);
    }
  };

  const openPicker = async (kind = "llm") => {
    setPickerOpen(kind);
    loadGroups();
    // Same sources the combo editor feeds the picker with.
    try {
      const [providersRes, aliasRes] = await Promise.all([fetch("/api/providers"), fetch("/api/models/alias")]);
      if (providersRes.ok) setActiveProviders((await providersRes.json()).connections || []);
      if (aliasRes.ok) setModelAliases((await aliasRes.json()).aliases || {});
    } catch (error) {
      console.log("Error loading picker data:", error);
    }
  };

  const setAllow = async (allow) => {
    setGroupError("");
    const error = await onChange({ restricted: true, allow });
    if (error) setGroupError(error);
  };
  const add = (model) => {
    const value = model?.value;
    if (value && !access.allow.some((e) => e.toLowerCase() === value.toLowerCase())) setAllow([...access.allow, value]);
  };
  const remove = (value) => setAllow(access.allow.filter((e) => e !== value));
  const addBatch = (models) => {
    const seen = new Set(access.allow.map((entry) => entry.toLowerCase()));
    const additions = models.map((model) => model.value).filter((value) => {
      if (!value || seen.has(value.toLowerCase())) return false;
      seen.add(value.toLowerCase());
      return true;
    });
    if (additions.length) setAllow([...access.allow, ...additions]);
  };
  const removeBatch = (models) => {
    const values = new Set(models.map((model) => model.value.toLowerCase()));
    setAllow(access.allow.filter((entry) => !values.has(entry.toLowerCase())));
  };

  return (
    <div className="mt-2" data-testid="key-access">
      <Toggle
        size="sm"
        checked={access.restricted}
        label="Restrict access"
        onChange={(checked) => (checked ? onRequestRestrict() : onChange({ restricted: false, allow: access.allow }))}
      />
      {access.restricted && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {access.allow.length === 0 && (
            <span className="text-xs text-orange-500">No combos, models, or providers allowed — this key can call nothing.</span>
          )}
          {access.allow.map((entry) => {
            const isGroup = entry.toLowerCase().startsWith("@group/");
            const group = isGroup && groups.find((item) => `@group/${item.id}`.toLowerCase() === entry.toLowerCase());
            return (
              <span key={entry} className="flex items-center gap-1 rounded-xl border border-primary/30 bg-primary/10 px-2 py-0.5 text-xs text-text-main">
                {isGroup ? `Group: ${group?.name || entry}` : entry}
                {isGroup && group && <span className="text-text-muted">({group.allow.length ? group.allow.join(", ") : "No entries"})</span>}
                {isGroup && <button type="button" disabled={groupBusy || !group} onClick={() => updateGroupLink(entry, true)} className="text-primary" aria-label={`Expand ${group?.name || entry}`}>Expand</button>}
                <button
                  type="button"
                  disabled={isGroup && groupBusy}
                  onClick={() => isGroup ? updateGroupLink(entry) : remove(entry)}
                  className="rounded text-text-muted hover:text-red-500"
                  title={`${isGroup ? "Detach" : "Remove"} ${group?.name || entry}`}
                  aria-label={`${isGroup ? "Detach" : "Remove"} ${group?.name || entry}`}
                >
                  <span className="material-symbols-outlined leading-none" style={{ fontSize: "12px" }}>close</span>
                </button>
              </span>
            );
          })}
          <button
            onClick={() => openPicker()}
            className="flex items-center gap-0.5 rounded-xl border border-dashed border-black/10 px-2 py-0.5 text-xs font-medium text-primary hover:border-primary/50 dark:border-white/10"
          >
            <span className="material-symbols-outlined leading-none" style={{ fontSize: "14px" }}>add</span>
            Add combo, model, or group
          </button>
          <button
            onClick={() => openPicker("realtime")}
            className="flex items-center gap-0.5 rounded-xl border border-dashed border-black/10 px-2 py-0.5 text-xs font-medium text-primary hover:border-primary/50 dark:border-white/10"
          >
            <span className="material-symbols-outlined leading-none" style={{ fontSize: "14px" }}>add</span>
            Add realtime model
          </button>
        </div>
      )}
      {access.restricted && (
        <p className="mt-2 text-xs text-text-muted">
          Groups stay linked to their current entries. Expand to detach and copy their entries. {" "}
          <Link href="/dashboard/model-groups" className="text-primary hover:underline">Manage model groups</Link>
        </p>
      )}
      {groupError && <p className="mt-1 text-xs text-red-500" role="alert">{groupError}</p>}
      {pickerOpen && (
        <ModelSelectModal
          isOpen={pickerOpen}
          onClose={() => setPickerOpen(false)}
          onSelect={add}
          onDeselect={(model) => remove(access.allow.find((e) => e.toLowerCase() === String(model?.value).toLowerCase()))}
          onSelectBatch={addBatch}
          onDeselectBatch={removeBatch}
          activeProviders={activeProviders}
          modelAliases={modelAliases}
          title={`Allowed for "${apiKey.name}"`}
          kindFilter={pickerOpen === "realtime" ? "realtime" : null}
          addedModelValues={access.allow}
          modelGroups={pickerOpen === "realtime" ? [] : groups}
          modelGroupsError={groupError}
          closeOnSelect={false}
          allowProviderWildcard
        />
      )}
    </div>
  );
}

KeyAccessControls.propTypes = {
  apiKey: PropTypes.shape({
    id: PropTypes.string.isRequired,
    name: PropTypes.string,
    access: PropTypes.shape({ restricted: PropTypes.bool, allow: PropTypes.arrayOf(PropTypes.string) }),
  }).isRequired,
  onChange: PropTypes.func.isRequired,
  onRequestRestrict: PropTypes.func.isRequired,
};
