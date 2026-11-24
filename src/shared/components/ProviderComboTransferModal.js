"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Modal from "./Modal";
import Button from "./Button";
import Input from "./Input";
import Select from "./Select";

function downloadJson(payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `9router-transfer-${new Date().toISOString().replace(/[.:]/g, "-")}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

function CheckRow({ checked, onChange, title, detail }) {
  return (
    <label className="flex items-start gap-3 rounded-lg border border-border p-3 hover:border-primary/40 cursor-pointer">
      <input type="checkbox" checked={checked} onChange={onChange} className="mt-1 accent-[var(--color-primary)]" />
      <span className="min-w-0">
        <span className="block text-sm font-medium text-text-main truncate">{title}</span>
        {detail && <span className="block text-xs text-text-muted truncate">{detail}</span>}
      </span>
    </label>
  );
}

function SummaryPill({ label, value }) {
  return (
    <div className="rounded-lg border border-border bg-bg px-3 py-2">
      <p className="text-xs text-text-muted">{label}</p>
      <p className="text-lg font-semibold">{value}</p>
    </div>
  );
}

function providerActions(item) {
  if (item.status === "new") return [{ value: "add", label: "Add" }, { value: "skip", label: "Skip" }];
  if (item.status === "conflict") return [{ value: "skip", label: "Keep destination" }, { value: "replace", label: "Replace credentials" }];
  return [{ value: "skip", label: item.status === "ambiguous" ? "Skip (ambiguous)" : "Skip (already present)" }];
}

function comboActions(item) {
  if (item.status === "new") return [{ value: "add", label: "Add" }, { value: "skip", label: "Skip" }];
  if (item.status === "conflict") return [
    { value: "skip", label: "Keep destination" },
    { value: "replace", label: "Replace" },
    { value: "merge", label: "Merge models" },
    { value: "rename", label: "Import renamed" },
  ];
  if (item.status === "name_conflict") return [{ value: "skip", label: "Skip" }, { value: "rename", label: "Import renamed" }];
  return [{ value: "skip", label: "Skip (already present)" }];
}

export default function ProviderComboTransferModal({ isOpen, mode, onClose, onComplete }) {
  const fileRef = useRef(null);
  const [catalog, setCatalog] = useState({ providerConnections: [], combos: [] });
  const [selectedProviders, setSelectedProviders] = useState([]);
  const [selectedCombos, setSelectedCombos] = useState([]);
  const [payload, setPayload] = useState(null);
  const [plan, setPlan] = useState(null);
  const [resolutions, setResolutions] = useState({});
  const [password, setPassword] = useState("");
  const [credentialAcknowledged, setCredentialAcknowledged] = useState(false);
  const [importCredentialAcknowledged, setImportCredentialAcknowledged] = useState(false);
  const [providerFilter, setProviderFilter] = useState("");
  const [comboFilter, setComboFilter] = useState("");
  const [loading, setLoading] = useState(mode === "export");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isOpen || mode !== "export") return;
    let cancelled = false;
    fetch("/api/settings/transfer/catalog", { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Failed to load transferable items");
        if (cancelled) return;
        setCatalog(data);
        // Credentials are never selected implicitly. Users can still select all
        // with one click after reviewing the warning and scope.
        setSelectedProviders([]);
        setSelectedCombos([]);
      })
      .catch((reason) => {
        if (!cancelled) setError(reason.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, mode]);

  const selectedCount = selectedProviders.length + selectedCombos.length;
  const filteredProviders = useMemo(() => {
    const query = providerFilter.trim().toLowerCase();
    if (!query) return catalog.providerConnections;
    return catalog.providerConnections.filter((item) => [item.provider, item.authType, item.name, item.email]
      .filter(Boolean).some((value) => String(value).toLowerCase().includes(query)));
  }, [catalog.providerConnections, providerFilter]);
  const filteredCombos = useMemo(() => {
    const query = comboFilter.trim().toLowerCase();
    if (!query) return catalog.combos;
    return catalog.combos.filter((item) => [item.name, item.kind]
      .filter(Boolean).some((value) => String(value).toLowerCase().includes(query)));
  }, [catalog.combos, comboFilter]);
  const exportNeedsPassword = selectedProviders.length > 0;
  const importNeedsPassword = (plan?.providerConnections?.length || 0) > 0;
  const counts = plan?.summary?.counts || {};
  const defaultResolutions = useMemo(() => {
    if (!plan) return {};
    const next = {};
    for (const item of plan.providerConnections) next[`provider:${item.sourceId}`] = { action: item.recommended };
    for (const item of plan.combos) next[`combo:${item.sourceId}`] = { action: item.recommended };
    return next;
  }, [plan]);

  const toggle = (value, setValues) => setValues((current) => current.includes(value)
    ? current.filter((item) => item !== value)
    : [...current, value]);

  const runExport = async () => {
    if (selectedCount === 0) {
      setError("Select at least one provider account or combo");
      return;
    }
    if (exportNeedsPassword && (!password || !credentialAcknowledged)) {
      setError("A password and credential acknowledgment are required for provider exports");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/settings/transfer/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, providerConnectionIds: selectedProviders, comboIds: selectedCombos }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to export selection");
      downloadJson(data);
      onComplete?.("Selective transfer downloaded");
      onClose();
    } catch (reason) {
      setError(reason.message);
    } finally {
      setLoading(false);
    }
  };

  const inspectFile = async (event) => {
    const file = event.target.files?.[0];
    if (fileRef.current) fileRef.current.value = "";
    if (!file) return;
    setLoading(true);
    setError("");
    setPlan(null);
    setImportCredentialAcknowledged(false);
    try {
      const parsed = JSON.parse(await file.text());
      const response = await fetch("/api/settings/transfer/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payload: parsed }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Invalid transfer file");
      setPayload(parsed);
      setPlan(data);
      const defaults = {};
      for (const item of data.providerConnections) defaults[`provider:${item.sourceId}`] = { action: item.recommended };
      for (const item of data.combos) defaults[`combo:${item.sourceId}`] = { action: item.recommended };
      setResolutions(defaults);
    } catch (reason) {
      setPayload(null);
      setError(reason.message || "Invalid transfer file");
    } finally {
      setLoading(false);
    }
  };

  const setResolution = (key, patch) => setResolutions((current) => ({
    ...current,
    [key]: { ...(current[key] || {}), ...patch },
  }));

  const runImport = async () => {
    if (importNeedsPassword && (!password || !importCredentialAcknowledged)) {
      setError("A password and credential acknowledgment are required for provider imports");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/settings/transfer/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, payload, resolutions: { ...defaultResolutions, ...resolutions } }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to import selection");
      const changed = Object.entries(data.applied || {}).filter(([key]) => key !== "skipped").reduce((sum, [, value]) => sum + value, 0);
      onComplete?.(`Selective import completed: ${changed} item${changed === 1 ? "" : "s"} changed`);
      onClose();
    } catch (reason) {
      setError(reason.message);
    } finally {
      setLoading(false);
    }
  };

  const footer = mode === "export" ? (
    <>
      <Button variant="ghost" onClick={onClose} disabled={loading}>Cancel</Button>
      <Button icon="download" onClick={runExport} loading={loading} disabled={selectedCount === 0 || (exportNeedsPassword && (!password || !credentialAcknowledged))}>
        {selectedCount ? `Export ${selectedCount} item${selectedCount === 1 ? "" : "s"}` : "Export Selected"}
      </Button>
    </>
  ) : plan ? (
    <>
      <Button variant="ghost" onClick={onClose} disabled={loading}>Cancel</Button>
      <Button icon="publish" onClick={runImport} loading={loading} disabled={importNeedsPassword && (!password || !importCredentialAcknowledged)}>
        Apply Import
      </Button>
    </>
  ) : (
    <Button variant="ghost" onClick={onClose} disabled={loading}>Close</Button>
  );

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={mode === "export" ? "Export Selected Configuration" : "Import Selected Configuration"} size="full" footer={footer} closeOnOverlay={!loading}>
      {mode === "export" ? (
        <div className="flex flex-col gap-5">
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">
            Provider accounts contain reusable credentials. They are never selected by default; review the scope before downloading. Combos and routing dependencies do not contain credentials.
          </div>
          <section>
            <div className="mb-2 flex items-center justify-between gap-3">
              <div><h3 className="font-semibold">Provider accounts <span className="text-xs font-normal text-text-muted">{selectedProviders.length}/{catalog.providerConnections.length}</span></h3><p className="text-xs text-text-muted">Credentials to add or update on another 9Router.</p></div>
              <button type="button" className="text-xs text-primary" onClick={() => setSelectedProviders(selectedProviders.length === catalog.providerConnections.length ? [] : catalog.providerConnections.map((item) => item.id))}>{selectedProviders.length === catalog.providerConnections.length ? "Clear all" : "Select all"}</button>
            </div>
            <Input type="search" label="Filter providers" value={providerFilter} onChange={(event) => setProviderFilter(event.target.value)} placeholder="Search by provider, email, or account name" />
            <div className="grid max-h-56 grid-cols-1 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
              {filteredProviders.map((item) => <CheckRow key={item.id} checked={selectedProviders.includes(item.id)} onChange={() => toggle(item.id, setSelectedProviders)} title={item.name || item.email || `${item.provider} account`} detail={`${item.provider} · ${item.authType}`} />)}
            </div>
            {filteredProviders.length === 0 && <p className="py-3 text-xs text-text-muted">No provider accounts match this filter.</p>}
          </section>
          <section>
            <div className="mb-2 flex items-center justify-between gap-3">
              <div><h3 className="font-semibold">Combos <span className="text-xs font-normal text-text-muted">{selectedCombos.length}/{catalog.combos.length}</span></h3><p className="text-xs text-text-muted">Includes each combo strategy and required custom-node/model metadata.</p></div>
              <button type="button" className="text-xs text-primary" onClick={() => setSelectedCombos(selectedCombos.length === catalog.combos.length ? [] : catalog.combos.map((item) => item.id))}>{selectedCombos.length === catalog.combos.length ? "Clear all" : "Select all"}</button>
            </div>
            <Input type="search" label="Filter combos" value={comboFilter} onChange={(event) => setComboFilter(event.target.value)} placeholder="Search by combo name" />
            <div className="grid max-h-48 grid-cols-1 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
              {filteredCombos.map((item) => <CheckRow key={item.id} checked={selectedCombos.includes(item.id)} onChange={() => toggle(item.id, setSelectedCombos)} title={item.name} detail={`${item.modelCount} model${item.modelCount === 1 ? "" : "s"}${item.kind ? ` · ${item.kind}` : ""}`} />)}
            </div>
            {filteredCombos.length === 0 && <p className="py-3 text-xs text-text-muted">No combos match this filter.</p>}
          </section>
          {exportNeedsPassword ? (
            <>
              <label className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
                <input type="checkbox" checked={credentialAcknowledged} onChange={(event) => setCredentialAcknowledged(event.target.checked)} className="mt-0.5 accent-[var(--color-primary)]" />
                <span>I understand this download contains provider credentials and I will store and transfer the JSON securely.</span>
              </label>
              <Input type="password" label="Current password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Required to export provider credentials" />
            </>
          ) : <p className="rounded-lg border border-green-500/30 bg-green-500/10 p-3 text-xs text-green-700 dark:text-green-300">No provider accounts selected. This export contains configuration metadata only.</p>}
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          {!plan && (
            <button type="button" onClick={() => fileRef.current?.click()} className="rounded-xl border-2 border-dashed border-border p-10 text-center hover:border-primary/50">
              <span className="material-symbols-outlined mb-2 text-3xl text-primary">upload_file</span>
              <span className="block font-medium">Choose a selective transfer JSON file</span>
              <span className="block text-xs text-text-muted">The file is inspected before anything changes.</span>
            </button>
          )}
          <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={inspectFile} />
          {plan && (
            <>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                <SummaryPill label="New" value={counts.new || 0} />
                <SummaryPill label="Existing" value={counts.identical || 0} />
                <SummaryPill label="Conflicts" value={(counts.conflict || 0) + (counts.name_conflict || 0)} />
                <SummaryPill label="Ambiguous" value={counts.ambiguous || 0} />
                <SummaryPill label="Deletions" value="0" />
              </div>
              <p className="text-xs text-text-muted">Dependencies: {plan.summary.providerNodes} custom nodes, {plan.summary.modelAliases} aliases, {plan.summary.customModels} custom models. New dependencies are added; existing conflicts are kept by default.</p>
              {importNeedsPassword && (
                <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
                  This file contains provider credentials. OAuth refresh tokens may rotate; running the same imported OAuth account on two installations can invalidate one installation. Disable the source account after a move.
                </p>
              )}
              {plan.providerConnections.length > 0 && <section><h3 className="mb-2 font-semibold">Provider accounts</h3><div className="flex max-h-64 flex-col gap-2 overflow-y-auto pr-1">{plan.providerConnections.map((item) => { const key = `provider:${item.sourceId}`; return <div key={key} className="grid items-center gap-2 rounded-lg border border-border p-3 sm:grid-cols-[1fr_140px_220px]"><div className="min-w-0"><p className="truncate text-sm font-medium">{item.label}</p><p className="text-xs text-text-muted">{item.provider} · {item.authType}</p></div><span className="text-xs capitalize text-text-muted">{item.status.replace("_", " ")}</span><Select value={resolutions[key]?.action || item.recommended} onChange={(event) => setResolution(key, { action: event.target.value })} options={providerActions(item)} placeholder="Action" /></div>; })}</div></section>}
              {plan.combos.length > 0 && <section><h3 className="mb-2 font-semibold">Combos</h3><div className="flex max-h-64 flex-col gap-2 overflow-y-auto pr-1">{plan.combos.map((item) => { const key = `combo:${item.sourceId}`; const action = resolutions[key]?.action || item.recommended; return <div key={key} className="grid items-center gap-2 rounded-lg border border-border p-3 sm:grid-cols-[1fr_140px_220px]"><div className="min-w-0"><p className="truncate text-sm font-medium">{item.name}</p><p className="text-xs text-text-muted">{item.modelCount} models</p></div><span className="text-xs capitalize text-text-muted">{item.status.replace("_", " ")}</span><div className="flex flex-col gap-2"><Select value={action} onChange={(event) => setResolution(key, { action: event.target.value })} options={comboActions(item)} placeholder="Action" />{action === "rename" && <Input value={resolutions[key]?.renameTo || ""} onChange={(event) => setResolution(key, { renameTo: event.target.value })} placeholder="New combo name" />}</div></div>; })}</div></section>}
              <div className="flex items-center justify-between gap-3"><Button variant="outline" icon="upload_file" onClick={() => fileRef.current?.click()} disabled={loading}>Choose another file</Button><span className="text-xs text-green-600 dark:text-green-400">No destination records will be deleted.</span></div>
              {importNeedsPassword ? (
                <>
                  <label className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
                    <input type="checkbox" checked={importCredentialAcknowledged} onChange={(event) => setImportCredentialAcknowledged(event.target.checked)} className="mt-0.5 accent-[var(--color-primary)]" />
                    <span>I understand this import adds or updates provider credentials on this destination.</span>
                  </label>
                  <Input type="password" label="Current password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Required to apply provider credentials" />
                </>
              ) : <p className="rounded-lg border border-green-500/30 bg-green-500/10 p-3 text-xs text-green-700 dark:text-green-300">No provider credentials are included. This import changes only configuration metadata.</p>}
            </>
          )}
        </div>
      )}
      {loading && !plan && <p className="mt-4 text-sm text-text-muted">Working…</p>}
      {error && <p className="mt-4 text-sm text-red-500">{error}</p>}
    </Modal>
  );
}
