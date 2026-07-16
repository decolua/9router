"use client";

import { useRef, useState } from "react";
import PropTypes from "prop-types";
import { Button, Input, Modal } from "@/shared/components";
import { translate } from "@/i18n/runtime";

const TXT_PLACEHOLDER = `production|sk-key-1
staging|sk-key-2
sk-key-only-auto-named`;

const JSON_PLACEHOLDER = `{
  "version": 1,
  "provider": "openrouter",
  "keys": [
    { "name": "production", "apiKey": "sk-..." },
    { "name": "staging", "apiKey": "sk-..." }
  ]
}`;

function downloadBlob(content, filename, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

export default function ExportImportKeysModal({ isOpen, providerId, providerName, onClose, onImportSuccess }) {
  const fileInputRef = useRef(null);
  const [tab, setTab] = useState("export"); // export | import
  const [format, setFormat] = useState("json"); // json | txt
  const [password, setPassword] = useState("");
  const [importText, setImportText] = useState("");
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [importResult, setImportResult] = useState(null);

  const resetMessages = () => {
    setError("");
    setStatus("");
    setImportResult(null);
  };

  const handleClose = () => {
    if (busy) return;
    setPassword("");
    setImportText("");
    resetMessages();
    onClose();
  };

  const handleExport = async () => {
    resetMessages();
    if (!password) {
      setError(translate("Password is required to export keys"));
      return;
    }
    setBusy(true);
    try {
      const params = new URLSearchParams({ provider: providerId, format });
      const res = await fetch(`/api/providers/keys/export?${params}`, {
        headers: { "x-9r-password": password },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Export failed (${res.status})`);
      }
      const text = await res.text();
      const stamp = new Date().toISOString().replace(/[.:]/g, "-");
      const ext = format === "txt" ? "txt" : "json";
      const mime = format === "txt" ? "text/plain;charset=utf-8" : "application/json;charset=utf-8";
      downloadBlob(text, `9router-${providerId}-keys-${stamp}.${ext}`, mime);
      setStatus(translate("Keys exported successfully"));
      setPassword("");
    } catch (err) {
      setError(err.message || translate("Failed to export keys"));
    } finally {
      setBusy(false);
    }
  };

  const handleFilePick = async (event) => {
    const file = event.target.files?.[0];
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (!file) return;
    try {
      const text = await file.text();
      setImportText(text);
      // Heuristic format from extension / content
      if (file.name.endsWith(".txt") || (!text.trim().startsWith("{") && !text.trim().startsWith("["))) {
        setFormat("txt");
      } else {
        setFormat("json");
      }
      resetMessages();
    } catch {
      setError(translate("Failed to read file"));
    }
  };

  const handleImport = async () => {
    resetMessages();
    const content = importText.trim();
    if (!content) {
      setError(translate("Paste keys or choose a file first"));
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/providers/keys/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: providerId,
          format,
          content,
          skipDuplicates,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || `Import failed (${res.status})`);
      }
      setImportResult(data);
      if (data.success > 0 && typeof onImportSuccess === "function") {
        onImportSuccess();
      }
    } catch (err) {
      setError(err.message || translate("Failed to import keys"));
    } finally {
      setBusy(false);
    }
  };

  const failedItems = importResult?.results?.filter((r) => !r.ok) || [];

  return (
    <Modal
      isOpen={isOpen}
      title={`${translate("Export / Import Keys")} — ${providerName || providerId}`}
      onClose={handleClose}
      size="lg"
    >
      <div className="flex flex-col gap-4">
        <div className="flex gap-2">
          <Button
            size="sm"
            variant={tab === "export" ? "primary" : "ghost"}
            onClick={() => { setTab("export"); resetMessages(); }}
            disabled={busy}
          >
            {translate("Export")}
          </Button>
          <Button
            size="sm"
            variant={tab === "import" ? "primary" : "ghost"}
            onClick={() => { setTab("import"); resetMessages(); }}
            disabled={busy}
          >
            {translate("Import")}
          </Button>
        </div>

        <div className="flex gap-2">
          <Button
            size="sm"
            variant={format === "json" ? "secondary" : "ghost"}
            onClick={() => setFormat("json")}
            disabled={busy}
          >
            JSON
          </Button>
          <Button
            size="sm"
            variant={format === "txt" ? "secondary" : "ghost"}
            onClick={() => setFormat("txt")}
            disabled={busy}
          >
            TXT
          </Button>
        </div>

        {tab === "export" && (
          <div className="flex flex-col gap-3">
            <p className="text-xs text-text-muted">
              {translate(
                "Download this provider's API keys (and cookie credentials). Password re-auth is required because the file contains secrets."
              )}
            </p>
            <p className="text-xs text-text-muted font-mono">
              {format === "json"
                ? '{ "version": 1, "provider": "…", "keys": [ { "name", "apiKey", … } ] }'
                : "name|apiKey  (one per line)"}
            </p>
            <Input
              label={translate("Dashboard password")}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={translate("Enter password to confirm")}
              autoComplete="current-password"
            />
            <div className="flex gap-2">
              <Button onClick={handleExport} fullWidth disabled={busy || !password}>
                {busy ? translate("Exporting...") : translate("Download")}
              </Button>
              <Button onClick={handleClose} variant="ghost" fullWidth disabled={busy}>
                {translate("Close")}
              </Button>
            </div>
          </div>
        )}

        {tab === "import" && (
          <div className="flex flex-col gap-3">
            <p className="text-xs text-text-muted">
              {format === "json"
                ? translate("Paste a JSON export (or array of { name, apiKey }) for this provider.")
                : translate("One key per line: name|apiKey — or just apiKey (auto-named).")}
            </p>
            <textarea
              className="w-full rounded border border-accent/30 bg-sidebar p-2 text-sm font-mono resize-y min-h-[180px] focus:outline-none focus:ring-1 focus:ring-primary"
              placeholder={format === "json" ? JSON_PLACEHOLDER : TXT_PLACEHOLDER}
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              disabled={busy}
            />
            <div className="flex flex-wrap items-center gap-3">
              <Button
                size="sm"
                variant="secondary"
                icon="upload_file"
                onClick={() => fileInputRef.current?.click()}
                disabled={busy}
              >
                {translate("Choose file")}
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept={format === "json" ? ".json,application/json,text/plain" : ".txt,text/plain,.json"}
                className="hidden"
                onChange={handleFilePick}
              />
              <label className="flex cursor-pointer items-center gap-1.5 text-xs text-text-muted">
                <input
                  type="checkbox"
                  checked={skipDuplicates}
                  onChange={(e) => setSkipDuplicates(e.target.checked)}
                  disabled={busy}
                  className="h-3.5 w-3.5 rounded border-gray-300 text-primary focus:ring-primary"
                />
                {translate("Skip duplicate keys")}
              </label>
            </div>
            {importResult && (
              <div className="flex flex-col gap-2">
                <div
                  className={`text-sm font-medium ${
                    importResult.failed > 0 ? "text-yellow-400" : "text-green-400"
                  }`}
                >
                  ✓ {importResult.success} {translate("added")}
                  {importResult.skipped > 0 ? `, ⊘ ${importResult.skipped} ${translate("skipped")}` : ""}
                  {importResult.failed > 0 ? `, ✗ ${importResult.failed} ${translate("failed")}` : ""}
                </div>
                {failedItems.length > 0 && (
                  <ul className="rounded border border-accent/20 bg-sidebar/50 p-2 text-xs font-mono max-h-32 overflow-y-auto">
                    {failedItems.map((item) => (
                      <li key={item.index} className="text-red-400">
                        [{item.index}] {item.error}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            <div className="flex gap-2">
              <Button onClick={handleImport} fullWidth disabled={busy || !importText.trim()}>
                {busy ? translate("Importing...") : translate("Import All")}
              </Button>
              <Button onClick={handleClose} variant="ghost" fullWidth disabled={busy}>
                {translate("Close")}
              </Button>
            </div>
          </div>
        )}

        {error && <p className="text-xs text-red-500 break-words">{error}</p>}
        {status && !error && <p className="text-xs text-green-500 break-words">{status}</p>}
      </div>
    </Modal>
  );
}

ExportImportKeysModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  providerId: PropTypes.string.isRequired,
  providerName: PropTypes.string,
  onClose: PropTypes.func.isRequired,
  onImportSuccess: PropTypes.func,
};
