"use client";

import { useState, useEffect, useMemo } from "react";
import PropTypes from "prop-types";
import Modal from "./Modal";
import Button from "./Button";
import Input from "./Input";
import Badge from "./Badge";

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

const DEFAULT_SECTIONS = [
  { key: "settings", label: "Settings & System Config", default: true, isHeavy: false },
  { key: "providers", label: "Provider Connections & Custom Nodes", default: true, isHeavy: false },
  { key: "apiKeys", label: "API Keys & Quota Limits", default: true, isHeavy: false },
  { key: "combos", label: "Combos & Custom Routing", default: true, isHeavy: false },
  { key: "customModels", label: "Custom Models & Aliases", default: true, isHeavy: false },
  { key: "pricing", label: "Pricing & Model Overrides", default: true, isHeavy: false },
  { key: "usage", label: "Usage History & Logs", default: false, isHeavy: true },
];

export default function DownloadBackupModal({ isOpen, onClose, onDownload, loading, error }) {
  const [password, setPassword] = useState("");
  const [summary, setSummary] = useState(null);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [selected, setSelected] = useState(() =>
    Object.fromEntries(DEFAULT_SECTIONS.map((s) => [s.key, s.default]))
  );

  useEffect(() => {
    if (!isOpen) {
      setPassword("");
      return;
    }
    setLoadingSummary(true);
    fetch("/api/settings/database?summary=true")
      .then((res) => res.json())
      .then((data) => {
        if (data && data.sections) {
          setSummary(data.sections);
        }
      })
      .catch(() => {})
      .finally(() => setLoadingSummary(false));
  }, [isOpen]);

  const toggleSection = (key) => {
    setSelected((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const totalSelectedBytes = useMemo(() => {
    if (!summary) return 0;
    let sum = 0;
    for (const [key, isSel] of Object.entries(selected)) {
      if (isSel && summary[key]) {
        sum += summary[key].bytes || 0;
      }
    }
    return sum;
  }, [selected, summary]);

  const selectedCount = useMemo(() => {
    return Object.values(selected).filter(Boolean).length;
  }, [selected]);

  const handleConfirm = () => {
    const activeKeys = Object.entries(selected)
      .filter(([, v]) => v)
      .map(([k]) => k);
    onDownload(password, activeKeys);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Download Backup"
      size="md"
      footer={
        <div className="flex items-center justify-between w-full">
          <div className="text-xs text-text-muted">
            Total Size: <span className="font-semibold text-text-main">{formatBytes(totalSelectedBytes)}</span>
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose} disabled={loading}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleConfirm}
              loading={loading}
              disabled={selectedCount === 0}
              icon="download"
            >
              Download Backup
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        <Input
          label="Password (if set)"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Enter dashboard password"
          hint="Leave blank if no password is configured"
        />

        <div className="space-y-2">
          <div className="text-xs font-semibold text-text-muted uppercase tracking-wider">
            Select Data to Include
          </div>

          <div className="space-y-1.5 max-h-[300px] overflow-y-auto pr-1">
            {DEFAULT_SECTIONS.map((sec) => {
              const info = summary?.[sec.key];
              const isChecked = Boolean(selected[sec.key]);
              const bytesFormatted = info ? formatBytes(info.bytes) : null;
              const countText = info ? `${info.count} item${info.count !== 1 ? "s" : ""}` : null;

              return (
                <label
                  key={sec.key}
                  className={`flex items-center justify-between p-3 rounded-lg border transition-colors cursor-pointer ${
                    isChecked
                      ? "bg-surface-2 border-primary/40"
                      : "bg-surface/50 border-border-subtle opacity-70 hover:opacity-100"
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => toggleSection(sec.key)}
                      className="rounded border-border text-primary focus:ring-primary size-4"
                    />
                    <div className="flex flex-col min-w-0">
                      <span className="text-sm font-medium text-text-main truncate">
                        {sec.label}
                      </span>
                      {countText && (
                        <span className="text-xs text-text-muted">
                          {countText}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {sec.isHeavy && (
                      <Badge variant="warning" size="sm">
                        Heavy
                      </Badge>
                    )}
                    {loadingSummary ? (
                      <span className="text-xs text-text-muted animate-pulse">Loading...</span>
                    ) : bytesFormatted ? (
                      <span className="text-xs font-mono text-text-muted">{bytesFormatted}</span>
                    ) : null}
                  </div>
                </label>
              );
            })}
          </div>
        </div>

        {error && <p className="text-xs text-red-500">{error}</p>}
      </div>
    </Modal>
  );
}

DownloadBackupModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onDownload: PropTypes.func.isRequired,
  loading: PropTypes.bool,
  error: PropTypes.string,
};
