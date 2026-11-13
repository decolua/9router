"use client";

import { useState, useEffect } from "react";
import { Button, Modal } from "@/shared/components";
import { exportProviderKeys } from "./exportKeysAction";

// Export Keys modal — one row per connection, raw credential visible in full,
// copy button per row + Copy All. Data comes from the server action, not a
// REST endpoint: raw keys never gain another fetchable API surface.
export default function ExportKeysModal({ isOpen, providerId, providerName, onClose }) {
  const [keys, setKeys] = useState([]);
  const [loading, setLoading] = useState(false);
  const [copiedId, setCopiedId] = useState(null);

  useEffect(() => {
    if (!isOpen) return undefined;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setCopiedId(null);
      try {
        const data = await exportProviderKeys(providerId);
        if (!cancelled) setKeys(data.connections || []);
      } catch {
        if (!cancelled) setKeys([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [isOpen, providerId]);

  const copy = async (item) => {
    try {
      await navigator.clipboard.writeText(item.key);
      setCopiedId(item.id);
      setTimeout(() => setCopiedId((v) => (v === item.id ? null : v)), 1500);
    } catch { /* clipboard unavailable */ }
  };

  const copyAll = async () => {
    const text = keys.filter((k) => k.key).map((k) => `${k.name}: ${k.key}`).join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId("__all__");
      setTimeout(() => setCopiedId((v) => (v === "__all__" ? null : v)), 1500);
    } catch { /* clipboard unavailable */ }
  };

  const withKeys = keys.filter((k) => k.key);

  return (
    <Modal isOpen={isOpen} title={`Export Keys — ${providerName || providerId}`} onClose={onClose}>
      <div className="flex flex-col gap-3">
        {loading && <p className="text-sm text-text-muted">Loading…</p>}
        {!loading && withKeys.length === 0 && (
          <p className="text-sm text-text-muted">No keys stored for this provider.</p>
        )}
        {!loading && withKeys.map((item) => (
          <div
            key={item.id}
            className="flex items-center gap-2 rounded-lg border border-border-subtle bg-sidebar px-3 py-2"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs text-text-muted">{item.name}</p>
              <p className="break-all text-sm font-mono text-text-main">{item.key}</p>
            </div>
            <button
              onClick={() => copy(item)}
              title="Copy key"
              className={`shrink-0 rounded p-1.5 hover:bg-black/5 dark:hover:bg-white/5 ${copiedId === item.id ? "text-green-500" : "text-text-muted hover:text-primary"}`}
            >
              <span className="material-symbols-outlined text-[18px]">
                {copiedId === item.id ? "check" : "content_copy"}
              </span>
            </button>
          </div>
        ))}
        {!loading && withKeys.length > 0 && (
          <div className="flex gap-2">
            <Button size="sm" icon={copiedId === "__all__" ? "check" : "content_copy"} onClick={copyAll}>
              {copiedId === "__all__" ? "Copied" : "Copy All"}
            </Button>
            <Button size="sm" variant="ghost" onClick={onClose}>Close</Button>
          </div>
        )}
      </div>
    </Modal>
  );
}
