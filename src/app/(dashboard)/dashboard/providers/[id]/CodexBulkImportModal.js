"use client";

import { useRef, useState } from "react";
import PropTypes from "prop-types";
import { Button, Modal, Badge } from "@/shared/components";

const ACCEPT = ".json,application/json";

/**
 * Bulk-import Codex (OpenAI) accounts from one or more uploaded JSON files.
 *
 * Each file may contain a single account object or an array of them. Server
 * normalizes / validates / persists; this component just gathers files and
 * surfaces the result.
 */
export default function CodexBulkImportModal({ isOpen, onSuccess, onClose }) {
  const [files, setFiles] = useState(/** @type {File[]} */ ([]));
  const [submitting, setSubmitting] = useState(false);
  const [parseError, setParseError] = useState("");
  const [result, setResult] = useState(null);
  const inputRef = useRef(null);

  const reset = () => {
    setFiles([]);
    setParseError("");
    setResult(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  const handleClose = () => {
    if (submitting) return;
    reset();
    onClose?.();
  };

  const fileKey = (f) => `${f.name}::${f.size}`;

  const handleFilesAdd = (e) => {
    const incoming = Array.from(e.target.files || []);
    if (!incoming.length) return;
    setFiles((prev) => {
      const seen = new Set(prev.map(fileKey));
      const merged = [...prev];
      for (const f of incoming) {
        const k = fileKey(f);
        if (!seen.has(k)) {
          merged.push(f);
          seen.add(k);
        }
      }
      return merged;
    });
    setParseError("");
    setResult(null);
    // Allow re-selecting the same file later by clearing the input element.
    if (inputRef.current) inputRef.current.value = "";
  };

  const handleRemoveFile = (index) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
    setResult(null);
  };

  const handleClearAll = () => {
    setFiles([]);
    setResult(null);
    setParseError("");
  };

  const handleSubmit = async () => {
    if (!files.length || submitting) return;
    setSubmitting(true);
    setParseError("");
    setResult(null);

    /** @type {{file: string, error: string}[]} */
    const parseErrors = [];
    /** @type {unknown[]} */
    const accounts = [];

    for (const file of files) {
      let text;
      try {
        text = await file.text();
      } catch (e) {
        parseErrors.push({ file: file.name, error: `Read failed: ${e?.message || e}` });
        continue;
      }
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch (e) {
        parseErrors.push({ file: file.name, error: `Invalid JSON: ${e?.message || e}` });
        continue;
      }
      if (Array.isArray(parsed)) accounts.push(...parsed);
      else accounts.push(parsed);
    }

    if (accounts.length === 0) {
      setSubmitting(false);
      setParseError(
        parseErrors.length > 0
          ? parseErrors.map((p) => `${p.file}: ${p.error}`).join("\n")
          : "No accounts found in selected files",
      );
      return;
    }

    try {
      const res = await fetch("/api/oauth/codex/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accounts }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setParseError(data?.error || `Import failed (${res.status})`);
      } else {
        const merged = { ...data, parseErrors };
        setResult(merged);
        if (data.imported > 0) onSuccess?.();
      }
    } catch (e) {
      setParseError(`Network error: ${e?.message || e}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Bulk Import Codex Accounts"
    >
      <div className="flex flex-col gap-4">
        <p className="text-xs text-text-muted leading-relaxed">
          Upload one or more <code>.json</code> files. Supports both flat exports
          and the Codex CLI <code>auth.json</code> shape (tokens nested under{" "}
          <code>tokens</code>). Each file may contain a single account or an
          array. Required: <code>access_token</code>, <code>refresh_token</code>,
          and either an <code>id_token</code> we can decode or a top-level{" "}
          <code>email</code>.
        </p>

        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs text-text-muted">JSON files</label>
            {files.length > 0 && (
              <button
                type="button"
                onClick={handleClearAll}
                disabled={submitting}
                className="text-xs text-text-muted hover:text-red-500 disabled:opacity-50"
              >
                Clear all
              </button>
            )}
          </div>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={ACCEPT}
            onChange={handleFilesAdd}
            disabled={submitting}
            className="block w-full text-sm text-text-main file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:bg-primary file:text-white hover:file:bg-primary/90 file:cursor-pointer"
          />

          {files.length > 0 && (
            <div className="mt-2 max-h-48 overflow-y-auto rounded border border-border bg-sidebar/40">
              <ul className="divide-y divide-border">
                {files.map((f, i) => (
                  <li
                    key={`${fileKey(f)}::${i}`}
                    className="flex items-center justify-between gap-2 px-2 py-1.5 text-xs"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="material-symbols-outlined text-[16px] text-text-muted shrink-0">
                        description
                      </span>
                      <span className="truncate font-mono text-text-main" title={f.name}>
                        {f.name}
                      </span>
                      <span className="shrink-0 text-text-muted">
                        {formatBytes(f.size)}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemoveFile(i)}
                      disabled={submitting}
                      title="Remove"
                      className="shrink-0 rounded p-0.5 text-text-muted hover:bg-red-500/10 hover:text-red-500 disabled:opacity-50"
                    >
                      <span className="material-symbols-outlined text-[16px]">
                        close
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {files.length > 0 && (
            <p className="mt-2 text-xs text-text-muted">
              {files.length} file{files.length === 1 ? "" : "s"} ready
            </p>
          )}
        </div>

        {parseError && (
          <pre className="whitespace-pre-wrap break-words text-xs text-red-500 bg-red-500/5 border border-red-500/20 rounded p-2 max-h-40 overflow-auto">
            {parseError}
          </pre>
        )}

        {result && (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap gap-2 items-center">
              <Badge variant={result.failed > 0 ? "warning" : "success"}>
                {result.imported} imported
              </Badge>
              {result.failed > 0 && (
                <Badge variant="error">{result.failed} failed</Badge>
              )}
              {result.parseErrors?.length > 0 && (
                <Badge variant="error">
                  {result.parseErrors.length} unparseable
                </Badge>
              )}
              <span className="text-xs text-text-muted">
                of {result.total} record{result.total === 1 ? "" : "s"}
              </span>
            </div>

            {result.parseErrors?.length > 0 && (
              <div className="text-xs">
                <p className="text-text-muted mb-1">File parse errors:</p>
                <ul className="list-disc pl-5 space-y-0.5 text-red-500">
                  {result.parseErrors.map((p, i) => (
                    <li key={i}>
                      <span className="font-mono">{p.file}</span>: {p.error}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {result.results?.some((r) => !r.ok) && (
              <div className="text-xs">
                <p className="text-text-muted mb-1">Record errors:</p>
                <ul className="list-disc pl-5 space-y-0.5 text-red-500 max-h-40 overflow-auto">
                  {result.results
                    .filter((r) => !r.ok)
                    .map((r) => (
                      <li key={r.index}>
                        #{r.index + 1}: {r.error}
                      </li>
                    ))}
                </ul>
              </div>
            )}
          </div>
        )}

        <div className="flex gap-2">
          <Button
            onClick={handleSubmit}
            fullWidth
            disabled={!files.length || submitting}
          >
            {submitting ? "Importing..." : `Import ${files.length || ""}`.trim()}
          </Button>
          <Button onClick={handleClose} variant="ghost" fullWidth disabled={submitting}>
            {result ? "Close" : "Cancel"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

CodexBulkImportModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onSuccess: PropTypes.func,
  onClose: PropTypes.func.isRequired,
};

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
