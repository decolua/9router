"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/shared/components";

const iconClass = "h-9 w-9 shrink-0 !p-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";
const inputClass = "h-9 min-w-0 rounded-[10px] border border-border bg-surface px-3 text-sm text-text-main outline-none focus:border-primary focus:ring-1 focus:ring-primary disabled:opacity-50";

export default function BrowserProfilePicker({ value, onChange, disabled = false, onAvailabilityChange }) {
  const id = useId();
  const [profiles, setProfiles] = useState([]);
  const [action, setAction] = useState("");
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const mutationRef = useRef(null);
  const refreshRevision = useRef(0);
  const callbacks = useRef({ onChange, onAvailabilityChange });
  callbacks.current = { onChange, onAvailabilityChange };
  const selected = profiles.find((profile) => profile.name === value);

  useEffect(() => {
    const controller = new AbortController();
    let timer;
    const load = async () => {
      if (mutationRef.current) { timer = setTimeout(load, 5000); return; }
      const revision = ++refreshRevision.current;
      try {
        const response = await fetch("/api/browser/profiles", { cache: "no-store", signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Unable to load browser profiles");
        if (!Array.isArray(data.profiles)) throw new Error("Invalid browser profile response");
        if (!controller.signal.aborted && revision === refreshRevision.current) {
          setProfiles(data.profiles);
          setLoadError("");
        }
      } catch (cause) {
        if (!controller.signal.aborted && revision === refreshRevision.current) {
          setLoadError(cause.message || "Unable to load browser profiles");
          setProfiles([]);
        }
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(load, 5000);
      }
    };
    load();
    return () => { controller.abort(); mutationRef.current?.abort(); clearTimeout(timer); };
  }, []);

  useEffect(() => {
    callbacks.current.onAvailabilityChange?.(selected || null);
  }, [selected]);

  useEffect(() => {
    if (profiles.length && !profiles.some((profile) => profile.name === value) && !disabled) {
      callbacks.current.onChange(profiles.find((profile) => profile.name === "default")?.name || profiles[0].name);
    }
  }, [profiles, value, disabled]);

  useEffect(() => { setAction(""); setName(""); }, [value, disabled]);

  const mutate = async (event) => {
    event.preventDefault();
    if (pending || disabled || (action !== "create" && selected?.busy) || !action) return;
    setPending(true);
    setError("");
    refreshRevision.current += 1;
    const controller = new AbortController();
    mutationRef.current = controller;
    try {
      const response = await fetch(`/api/browser/profiles${action === "delete" ? `?name=${encodeURIComponent(value)}` : ""}`, {
        signal: controller.signal,
        method: action === "create" ? "POST" : action === "rename" ? "PATCH" : "DELETE",
        headers: { "Content-Type": "application/json" },
        ...(action !== "delete" && { body: JSON.stringify(action === "create" ? { name: name.trim() } : { name: value, newName: name.trim() }) }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to update browser profile");
      const nextName = action === "delete" ? "default" : name.trim();
      const refreshed = await fetch("/api/browser/profiles", { cache: "no-store", signal: controller.signal });
      const next = await refreshed.json();
      if (!refreshed.ok || !Array.isArray(next.profiles)) throw new Error(next.error || "Profile updated, but the list could not be refreshed");
      if (controller.signal.aborted) return;
      setProfiles(next.profiles);
      onChange(nextName);
      setAction("");
      setName("");
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause.message || "Unable to update browser profile");
    } finally {
      mutationRef.current = null;
      if (!controller.signal.aborted) setPending(false);
    }
  };

  const protectedProfile = !selected || selected.busy || value === "default";
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        <label htmlFor={id} className="flex min-w-0 flex-1 flex-col gap-1.5 text-xs font-medium text-text-muted">
          Browser profile
          <select id={id} value={value} disabled={disabled || pending || !profiles.length} onChange={(event) => onChange(event.target.value)} className={`${inputClass} w-full`}>
            {!profiles.length && <option value={value}>{value} — profiles unavailable</option>}
            {profiles.map((profile) => <option key={profile.name} value={profile.name}>{profile.name}{profile.busy ? " — in use" : ""}</option>)}
          </select>
        </label>
        <Button type="button" variant="secondary" icon="add" className={iconClass} aria-label="Create browser profile" title="Create browser profile" disabled={disabled || pending} onClick={() => { setAction("create"); setName(""); setError(""); }} />
        <Button type="button" variant="ghost" icon="edit" className={iconClass} aria-label="Rename browser profile" title={value === "default" ? "The default profile cannot be renamed" : selected?.busy ? "Stop the browser before renaming this profile" : "Rename browser profile"} disabled={disabled || pending || protectedProfile} onClick={() => { setAction("rename"); setName(value); setError(""); }} />
        <Button type="button" variant="ghost" icon="delete" className={iconClass} aria-label="Delete browser profile" title={value === "default" ? "The default profile cannot be deleted" : selected?.busy ? "Stop the browser before deleting this profile" : "Delete browser profile"} disabled={disabled || pending || protectedProfile} onClick={() => { setAction("delete"); setError(""); }} />
      </div>
      {action && !disabled && (action === "create" || !selected?.busy) && (
        <form onSubmit={mutate} className="space-y-3 rounded-[10px] border border-border bg-surface-2 p-3">
          {action === "delete" ? <p className="text-sm text-text-main">Delete <strong className="break-all">{value}</strong>? This permanently removes this profile’s signed-in browser data, including cookies and saved sessions. This cannot be undone.</p> : (
            <label className="flex flex-col gap-1.5 text-xs font-medium text-text-muted">{action === "create" ? "New profile name" : "Rename profile"}
              <input autoFocus required maxLength={40} pattern="[a-zA-Z0-9_-]+" title="Use 1–40 letters, numbers, hyphens, or underscores" value={name} onChange={(event) => setName(event.target.value)} disabled={pending} className={inputClass} autoComplete="off" />
              <span className="font-normal">1–40 letters, numbers, hyphens, or underscores.</span>
            </label>
          )}
          <div className="flex gap-2">
            <Button type="submit" size="sm" variant={action === "delete" ? "danger" : "primary"} loading={pending} disabled={action !== "create" && protectedProfile}>{action === "create" ? "Create profile" : action === "rename" ? "Save name" : "Delete profile permanently"}</Button>
            <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => setAction("")}>Cancel</Button>
          </div>
        </form>
      )}
      {error && <p role="alert" className="text-xs text-red-500">{error}</p>}
      {loadError && <p role="alert" className="text-xs text-red-500">{loadError}</p>}
    </div>
  );
}
