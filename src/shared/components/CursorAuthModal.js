"use client";

import { useState } from "react";
import PropTypes from "prop-types";
import { Modal, Button, Input } from "@/shared/components";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";

/**
 * Cursor Auth Modal
 * Import token from Cursor IDE's local SQLite database
 *
 * Token Location:
 * - Linux: ~/.config/Cursor/User/globalStorage/state.vscdb
 * - macOS: /Users/<user>/Library/Application Support/Cursor/User/globalStorage/state.vscdb
 * - Windows: %APPDATA%\Cursor\User\globalStorage\state.vscdb
 *
 * Database Keys:
 * - cursorAuth/accessToken: The access token
 * - storage.serviceMachineId: Machine ID for checksum
 */
export default function CursorAuthModal({ isOpen, onSuccess, onClose }) {
  const [accessToken, setAccessToken] = useState("");
  const [machineId, setMachineId] = useState("");
  const [error, setError] = useState(null);
  const [importing, setImporting] = useState(false);
  const { copied, copy } = useCopyToClipboard();

  const handleImportToken = async () => {
    if (!accessToken.trim()) {
      setError("Please enter an access token");
      return;
    }

    if (!machineId.trim()) {
      setError("Please enter a machine ID");
      return;
    }

    setImporting(true);
    setError(null);

    try {
      const res = await fetch("/api/oauth/cursor/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accessToken: accessToken.trim(),
          machineId: machineId.trim(),
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Import failed");
      }

      // Success - close modal and trigger refresh
      onSuccess?.();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setImporting(false);
    }
  };

  const linuxCommand = `sqlite3 ~/.config/Cursor/User/globalStorage/state.vscdb "SELECT key, value FROM itemTable WHERE key IN ('cursorAuth/accessToken', 'storage.serviceMachineId')"`;
  const macCommand = `sqlite3 "/Users/$USER/Library/Application Support/Cursor/User/globalStorage/state.vscdb" "SELECT key, value FROM itemTable WHERE key IN ('cursorAuth/accessToken', 'storage.serviceMachineId')"`;

  return (
    <Modal isOpen={isOpen} title="Connect Cursor IDE" onClose={onClose} size="lg">
      <div className="flex flex-col gap-4">
        {/* Info Box */}
        <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg border border-blue-200 dark:border-blue-800">
          <div className="flex gap-2">
            <span className="material-symbols-outlined text-blue-600 dark:text-blue-400">info</span>
            <div className="flex-1 text-sm">
              <p className="font-medium text-blue-900 dark:text-blue-100 mb-1">
                Prerequisites
              </p>
              <p className="text-blue-800 dark:text-blue-200">
                Make sure you are logged in to Cursor IDE first. Tokens are stored in the local SQLite database.
              </p>
            </div>
          </div>
        </div>

        {/* Instructions */}
        <div className="space-y-3">
          <p className="text-sm font-medium">How to get your tokens:</p>

          <div className="bg-sidebar/50 p-3 rounded-lg space-y-2">
            <p className="text-xs text-text-muted">Linux:</p>
            <div className="flex items-start gap-2">
              <code className="text-xs bg-sidebar px-2 py-1 rounded flex-1 overflow-x-auto whitespace-pre">
                {linuxCommand}
              </code>
              <button
                onClick={() => copy(linuxCommand, "linux-cmd")}
                className="p-1 hover:bg-sidebar rounded text-text-muted hover:text-primary flex-shrink-0"
                title="Copy command"
              >
                <span className="material-symbols-outlined text-sm">
                  {copied === "linux-cmd" ? "check" : "content_copy"}
                </span>
              </button>
            </div>
          </div>

          <div className="bg-sidebar/50 p-3 rounded-lg space-y-2">
            <p className="text-xs text-text-muted">macOS:</p>
            <div className="flex items-start gap-2">
              <code className="text-xs bg-sidebar px-2 py-1 rounded flex-1 overflow-x-auto whitespace-pre">
                {macCommand}
              </code>
              <button
                onClick={() => copy(macCommand, "mac-cmd")}
                className="p-1 hover:bg-sidebar rounded text-text-muted hover:text-primary flex-shrink-0"
                title="Copy command"
              >
                <span className="material-symbols-outlined text-sm">
                  {copied === "mac-cmd" ? "check" : "content_copy"}
                </span>
              </button>
            </div>
          </div>

          <div className="text-xs text-text-muted">
            <p className="mb-1">Database locations:</p>
            <ul className="list-disc list-inside space-y-0.5">
              <li>Linux: <code className="bg-sidebar px-1 rounded">~/.config/Cursor/User/globalStorage/state.vscdb</code></li>
              <li>macOS: <code className="bg-sidebar px-1 rounded">/Users/&lt;user&gt;/Library/Application Support/Cursor/User/globalStorage/state.vscdb</code></li>
              <li>Windows: <code className="bg-sidebar px-1 rounded">%APPDATA%\Cursor\User\globalStorage\state.vscdb</code></li>
            </ul>
          </div>
        </div>

        {/* Access Token Input */}
        <div>
          <label className="block text-sm font-medium mb-2">
            Access Token <span className="text-red-500">*</span>
          </label>
          <textarea
            value={accessToken}
            onChange={(e) => setAccessToken(e.target.value)}
            placeholder="Paste your access token here..."
            rows={3}
            className="w-full px-3 py-2 text-sm font-mono border border-border rounded-lg bg-background focus:outline-none focus:border-primary resize-none"
          />
          <p className="text-xs text-text-muted mt-1">
            From key: <code className="bg-sidebar px-1 rounded">cursorAuth/accessToken</code>
          </p>
        </div>

        {/* Machine ID Input */}
        <div>
          <label className="block text-sm font-medium mb-2">
            Machine ID <span className="text-red-500">*</span>
          </label>
          <Input
            value={machineId}
            onChange={(e) => setMachineId(e.target.value)}
            placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
            className="font-mono text-sm"
          />
          <p className="text-xs text-text-muted mt-1">
            From key: <code className="bg-sidebar px-1 rounded">storage.serviceMachineId</code>
          </p>
        </div>

        {/* Error Display */}
        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 p-3 rounded-lg border border-red-200 dark:border-red-800">
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex gap-2">
          <Button
            onClick={handleImportToken}
            fullWidth
            disabled={importing || !accessToken.trim() || !machineId.trim()}
          >
            {importing ? "Importing..." : "Import Token"}
          </Button>
          <Button onClick={onClose} variant="ghost" fullWidth>
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  );
}

CursorAuthModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onSuccess: PropTypes.func,
  onClose: PropTypes.func.isRequired,
};
