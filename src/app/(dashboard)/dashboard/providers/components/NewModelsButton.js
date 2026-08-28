"use client";

import { useState, useEffect } from "react";
import { Modal } from "@/shared/components";

// Compact button that shows the "New Models" discovery modal.
// Fetches unseen model count on mount for the badge, and the full
// model list when the modal opens.

function ProviderIcon({ name }) {
  return (
    <span className="material-symbols-outlined text-[16px]">
      dns
    </span>
  );
}

export default function NewModelsButton() {
  const [open, setOpen] = useState(false);
  const [unseenCount, setUnseenCount] = useState(0);

  // Fetch unseen count on mount (lightweight — just a count).
  useEffect(() => {
    let cancelled = false;
    fetch("/api/models/new")
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled && data?.totalUnseen) setUnseenCount(data.totalUnseen);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="relative flex items-center gap-1.5 rounded-lg border border-border bg-surface/60 px-3 py-1.5 text-xs font-medium text-text-muted hover:text-text-main hover:border-primary/40 transition-colors"
        title="Check for new models across all providers"
      >
        <span className="material-symbols-outlined text-[16px]">new_releases</span>
        <span className="hidden sm:inline">New Models</span>
        {unseenCount > 0 && (
          <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-bold px-1">
            {unseenCount > 99 ? "99+" : unseenCount}
          </span>
        )}
      </button>
      {open && <NewModelsModal onClose={() => { setOpen(false); setUnseenCount(0); }} />}
    </>
  );
}

function NewModelsModal({ onClose }) {
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [seeded, setSeeded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const res = await fetch("/api/models/new");
        if (!res.ok) throw new Error("Failed to fetch");
        const data = await res.json();
        if (!cancelled) {
          setGroups(data.groups || []);
          setSeeded(!!data.seeded);
        }
      } catch (e) {
        if (!cancelled) setError(e.message || "Error loading new models");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, []);

  const handleMarkAllRead = async () => {
    try {
      await fetch("/api/models/new/acknowledge", { method: "POST" });
      setGroups([]);
    } catch {
      // ignore — user can retry
    }
  };

  return (
    <Modal isOpen={true} onClose={onClose} title="New Models Discovery">
      <div className="flex flex-col gap-3 max-h-[60vh] overflow-y-auto custom-scrollbar">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-6 text-text-muted text-sm">
            <span className="material-symbols-outlined text-[18px] animate-spin">progress_activity</span>
            Scanning all providers…
          </div>
        ) : error ? (
          <div className="flex items-center justify-center gap-2 py-6 text-red-500 text-sm">
            <span className="material-symbols-outlined text-[18px]">error</span>
            {error}
          </div>
        ) : seeded ? (
          <div className="flex flex-col items-center gap-2 py-8 text-text-muted text-sm">
            <span className="material-symbols-outlined text-[28px] text-green-500">check_circle</span>
            <span className="font-medium text-text-main">Baseline created</span>
            <span className="text-center text-xs leading-relaxed">
              Your current models have been recorded.
              <br />
              Only genuinely new models will appear here going forward.
            </span>
          </div>
        ) : groups.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-text-muted text-sm">
            <span className="material-symbols-outlined text-[28px]">new_releases</span>
            <span className="font-medium text-text-main">No new models</span>
            <span className="text-center text-xs">
              All providers are up to date. New models will appear here when they are added.
            </span>
          </div>
        ) : (
          <>
            {groups.map((group) => (
              <div key={group.providerAlias} className="border border-border rounded-lg overflow-hidden">
                <div className="flex items-center justify-between px-3 py-2 bg-surface/60 border-b border-border">
                  <div className="flex items-center gap-2">
                    <ProviderIcon name={group.providerAlias} />
                    <span className="text-sm font-medium text-text-main">
                      {group.providerName}
                    </span>
                    <span className="text-[10px] text-text-muted bg-bg rounded-full px-1.5 py-0.5">
                      {group.models.length}
                    </span>
                  </div>
                </div>
                <div className="divide-y divide-border">
                  {group.models.map((m) => (
                    <div key={m.modelId} className="flex items-center gap-2 px-3 py-1.5">
                      {m.isNew && (
                        <span className="shrink-0 min-w-[32px] text-center text-[9px] font-bold text-white bg-blue-500 rounded px-1 py-0.5">
                          NEW
                        </span>
                      )}
                      {m.isFree && (
                        <span className="shrink-0 min-w-[32px] text-center text-[9px] font-bold text-green-700 bg-green-100 dark:bg-green-900/30 dark:text-green-400 rounded px-1 py-0.5">
                          FREE
                        </span>
                      )}
                      <code className="text-xs font-mono text-text-muted truncate flex-1">
                        {m.modelId}
                      </code>
                      <span className="text-[9px] text-text-muted/60 shrink-0">
                        {new Date(m.firstSeenAt).toLocaleDateString()}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}

            <button
              onClick={handleMarkAllRead}
              className="mt-1 flex items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-medium text-text-muted hover:text-text-main hover:border-primary/40 transition-colors"
            >
              <span className="material-symbols-outlined text-[14px]">done_all</span>
              Mark all as read
            </button>
          </>
        )}
      </div>
    </Modal>
  );
}
