"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useSearchParams } from "next/navigation";
import { Badge, Button, Card, Toggle } from "@/shared/components";
import { useDashboardRole } from "@/shared/hooks/useDashboardRole";
import { REQUEST_WINDOWS } from "@/shared/utils/requestWindows";
import { filterKeys } from "@/shared/utils/apiKeyList";
import { getCurrentLocale, onLocaleChange, translate } from "@/i18n/runtime";
import SecurityWarning from "./SecurityWarning";
import KeyList from "./KeyList";
import KeyDetail from "./KeyDetail";
import { QuotaReader } from "./KeyRequestQuotas";

function writeSelection(id, replace = false) {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set("keyId", id);
  else url.searchParams.delete("keyId");
  if (url.href !== window.location.href) {
    window.history[replace ? "replaceState" : "pushState"](null, "", url);
  }
}

export default function ApiKeysPanel({
  keys,
  requireApiKey,
  onRequireKey,
  onCreate,
  isRemoteHost,
  rotationError,
  onSaved,
  ...detailActions
}) {
  // Native attributes (placeholders, aria-labels) aren't translated by the DOM observer.
  useSyncExternalStore(onLocaleChange, getCurrentLocale, () => "en");
  const requested = useSearchParams().get("keyId");
  const [filters, setFilters] = useState({ search: "", status: "All", project: "" });
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const filtered = filterKeys(keys, filters, now);
  const selected = filtered.find((key) => key.id === requested) ?? filtered[0];
  const activeId = selected?.id;
  const mobileDetail = Boolean(requested && selected);
  const listRef = useRef(null);
  const backRef = useRef(null);
  const triggerRef = useRef(null);
  const [quotas, setQuotas] = useState({});
  const [revisions, setRevisions] = useState({});
  const recordQuotas = useCallback((id, windows) => {
    setQuotas((prev) => ({ ...prev, [id]: windows }));
  }, []);
  const isAdmin = useDashboardRole()?.role === "admin";
  const [usage, setUsage] = useState(null);
  const usageRequest = useRef(null);

  useEffect(() => {
    if (!isAdmin) return;
    let active = true;
    usageRequest.current ??= fetch("/api/usage/analytics?period=7d", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error();
        const { breakdowns } = await response.json();
        return breakdowns.apiKey;
      })
      .catch(() => false);
    usageRequest.current.then((rows) => {
      if (active) setUsage(rows);
    });
    return () => {
      active = false;
    };
  }, [isAdmin]);

  useEffect(() => {
    // Without a deep link, phones start in the list and desktops show the first detail.
    if (requested !== activeId && (requested || window.matchMedia("(min-width: 64rem)").matches)) {
      writeSelection(activeId, true);
    }
  }, [requested, activeId]);

  function select(id, trigger) {
    triggerRef.current = trigger;
    writeSelection(id);
    if (!window.matchMedia("(min-width: 64rem)").matches) {
      requestAnimationFrame(() => backRef.current?.focus());
    }
  }

  function back() {
    writeSelection(null);
    requestAnimationFrame(() => {
      const target = triggerRef.current?.isConnected
        ? triggerRef.current
        : listRef.current?.querySelector("button");
      target?.focus();
    });
  }

  function updateFields(fields) {
    onSaved(activeId, fields);
    if ("project" in fields && filters.project && fields.project !== filters.project) {
      setFilters((prev) => ({ ...prev, project: "" }));
    }
  }

  return (
    <Card id="require-api-key" padding="none" className="-mx-2 min-w-0 p-4 lg:mx-0 lg:p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-4 border-b border-border pb-4">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <span aria-hidden="true" className="material-symbols-outlined text-primary">
            vpn_key
          </span>
          <span>API Keys</span>
          <Badge variant="primary" size="sm">
            {keys.length}
          </Badge>
        </h2>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
          <div className="flex min-w-0 items-center gap-3">
            <div>
              <p className="text-sm font-medium">Require API key</p>
              <p className="text-xs text-text-muted">Requests without a valid key will be rejected</p>
            </div>
            <Toggle
              checked={requireApiKey}
              aria-label={translate("Require API key")}
              onChange={onRequireKey}
            />
          </div>
          <Button icon="add" onClick={onCreate}>
            Create Key
          </Button>
        </div>
      </div>
      {isRemoteHost && !requireApiKey && (
        <div className="mb-4">
          <SecurityWarning message="Endpoint is exposed without an API key." />
        </div>
      )}
      {rotationError && (
        <p role="alert" className="mb-2 text-sm text-danger">
          {rotationError}
        </p>
      )}
      {!keys.length ? (
        <div className="py-12 text-center">
          <span aria-hidden="true" className="mb-4 inline-grid size-16 place-items-center rounded-full bg-primary/10 text-primary">
            <span className="material-symbols-outlined block text-[32px] leading-none">vpn_key</span>
          </span>
          <p className="font-medium">No API keys yet</p>
          <p className="mb-4 text-sm text-text-muted">Create your first API key to get started</p>
          <Button icon="add" onClick={onCreate}>
            Create Key
          </Button>
        </div>
      ) : (
        <div className="grid min-w-0 items-start gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
          <div ref={listRef} className={mobileDetail ? "hidden min-w-0 lg:block" : "min-w-0"}>
            <KeyList
              keys={keys}
              filters={filters}
              filtered={filtered}
              now={now}
              onFilter={(field, value) => setFilters((prev) => ({ ...prev, [field]: value }))}
              activeId={activeId}
              onSelect={select}
              quotas={quotas}
            />
          </div>
          {selected && (
            <div className={mobileDetail ? "min-w-0" : "hidden min-w-0 lg:block"}>
              <Button
                ref={backRef}
                size="sm"
                variant="ghost"
                icon="arrow_back"
                className="mb-3 lg:hidden"
                onClick={back}
              >
                Keys
              </Button>
              <KeyDetail
                key={activeId}
                apiKey={selected}
                onSaved={updateFields}
                isAdmin={isAdmin}
                usage={usage}
                now={now}
                windows={quotas[activeId]}
                reloadQuotas={() =>
                  setRevisions((prev) => ({ ...prev, [activeId]: (prev[activeId] || 0) + 1 }))
                }
                {...detailActions}
              />
            </div>
          )}
        </div>
      )}
      {keys
        .filter((key) => key.id === activeId || REQUEST_WINDOWS.some((w) => key[w.limit] != null))
        .map((key) => (
          <QuotaReader
            key={key.id}
            keyId={key.id}
            revision={revisions[key.id]}
            onResult={recordQuotas}
          />
        ))}
    </Card>
  );
}
