"use client";

import { useState } from "react";
import PropTypes from "prop-types";
import { Button, Modal } from "@/shared/components";
import { CenterLoading } from "@/shared/components/Loading";
import { translate } from "@/i18n/runtime";

// Server-side bulk insert runs serially (priority transaction), so very
// large payloads are split client-side into batches. Keeps each request
// small and lets the overlay report real per-account progress.
const BULK_BATCH_SIZE = 20;

const PLACEHOLDER = `[
  {
    "accessToken": "eyJhbGc...",
    "refreshToken": "rt_...",
    "idToken": "eyJhbGc...",
    "email": "user@example.com"
  }
]`;

function normalizeToArray(parsed) {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === "object") {
    if (Array.isArray(parsed.accounts)) return parsed.accounts;
    return [parsed];
  }
  return null;
}

export default function BulkImportCodexModal({ isOpen, onClose, onSuccess }) {
  const [jsonText, setJsonText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [parseError, setParseError] = useState("");
  const [result, setResult] = useState(null);
  const [importProgress, setImportProgress] = useState(null); // { done, total }

  const handleClose = () => {
    if (submitting) return;
    setJsonText("");
    setParseError("");
    setResult(null);
    onClose();
  };

  const handleSubmit = async () => {
    setParseError("");
    setResult(null);

    const trimmed = jsonText.trim();
    if (!trimmed) return;

    let parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch (err) {
      setParseError(`${translate("Invalid JSON")}: ${err.message}`);
      return;
    }

    const accounts = normalizeToArray(parsed);
    if (!accounts || accounts.length === 0) {
      setParseError(translate("No accounts found in input"));
      return;
    }

    setSubmitting(true);
    setImportProgress({ done: 0, total: accounts.length });
    try {
      let success = 0;
      let failed = 0;
      const results = [];
      for (let offset = 0; offset < accounts.length; offset += BULK_BATCH_SIZE) {
        const batch = accounts.slice(offset, offset + BULK_BATCH_SIZE);
        const res = await fetch("/api/oauth/codex/bulk-import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accounts: batch }),
        });
        const data = await res.json();
        if (!res.ok) {
          setParseError(data?.error || `Request failed: ${res.status}`);
          return;
        }
        success += data.success || 0;
        failed += data.failed || 0;
        for (const item of data.results || []) {
          results.push({ ...item, index: (item.index ?? 0) + offset });
        }
        setImportProgress({ done: Math.min(accounts.length, offset + batch.length), total: accounts.length });
      }
      const data = { success, failed, results };
      setResult(data);
      if (data.success > 0 && typeof onSuccess === "function") {
        onSuccess();
      }
    } catch (err) {
      setParseError(err.message || translate("Request failed"));
    } finally {
      setSubmitting(false);
      setImportProgress(null);
    }
  };

  const failedItems = result?.results?.filter((r) => !r.ok) || [];
  const importPct = importProgress && importProgress.total > 0
    ? Math.round((importProgress.done / importProgress.total) * 100)
    : null;

  return (
    <Modal isOpen={isOpen} title={translate("Bulk Add Codex Accounts")} onClose={handleClose}>
      <div className="flex flex-col gap-4">
        <p className="text-xs text-text-muted">
          {translate(
            "Paste an array of codex account JSON objects. Each must include accessToken (and ideally refreshToken, idToken)."
          )}
        </p>

        <textarea
          className="w-full rounded border border-accent/30 bg-sidebar p-2 text-sm font-mono resize-y min-h-[240px] focus:outline-none focus:ring-1 focus:ring-primary"
          placeholder={PLACEHOLDER}
          value={jsonText}
          onChange={(e) => setJsonText(e.target.value)}
          disabled={submitting}
        />

        {parseError && (
          <p className="text-xs text-red-500 break-words">{parseError}</p>
        )}

        {result && (
          <div className="flex flex-col gap-2">
            <div
              className={`text-sm font-medium ${
                result.failed > 0 ? "text-yellow-400" : "text-green-400"
              }`}
            >
              ✓ {result.success} {translate("added")}
              {result.failed > 0 ? `, ✗ ${result.failed} ${translate("failed")}` : ""}
            </div>
            {failedItems.length > 0 && (
              <ul className="rounded border border-accent/20 bg-sidebar/50 p-2 text-xs font-mono max-h-40 overflow-y-auto">
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
          <Button
            onClick={handleSubmit}
            fullWidth
            disabled={submitting || !jsonText.trim()}
          >
            {translate("Import All")}
          </Button>
          <Button onClick={handleClose} variant="ghost" fullWidth disabled={submitting}>
            {translate("Close")}
          </Button>
        </div>
      </div>
      {importProgress && (
        <CenterLoading
          fixed={false}
          message={importPct !== null ? `${translate("Importing accounts")} ${importProgress.done}/${importProgress.total}` : translate("Importing accounts")}
          progress={importPct}
        />
      )}
    </Modal>
  );
}

BulkImportCodexModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onSuccess: PropTypes.func,
};
