"use client";

import React, { useState, useEffect } from "react";
import { Modal, Button, Input } from "@/shared/components";
import { 
  CheckCircle, 
  Info,
  WarningCircle
} from "@phosphor-icons/react";
import { translate } from "@/i18n/runtime";

interface CursorAuthModalProps {
  open: boolean;
  onSuccess?: () => void;
  onClose: () => void;
}

/**
 * Cursor Auth Modal
 * Auto-detect and import token from Cursor IDE's local SQLite database
 */
export default function CursorAuthModal({ open, onSuccess, onClose }: CursorAuthModalProps) {
  const [accessToken, setAccessToken] = useState("");
  const [machineId, setMachineId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [autoDetecting, setAutoDetecting] = useState(false);
  const [autoDetected, setAutoDetected] = useState(false);
  const [windowsManual, setWindowsManual] = useState(false);

  const runAutoDetect = async () => {
    setAutoDetecting(true);
    setError(null);
    setAutoDetected(false);
    setWindowsManual(false);

    try {
      const res = await fetch("/api/oauth/cursor/auto-import");
      const data = await res.json();

      if (data.found) {
        setAccessToken(data.accessToken);
        setMachineId(data.machineId);
        setAutoDetected(true);
      } else if (data.windowsManual) {
        setWindowsManual(true);
      } else {
        setError(data.error || "Could not auto-detect tokens");
      }
    } catch (err) {
      setError("Failed to auto-detect tokens");
    } finally {
      setAutoDetecting(false);
    }
  };

  // Auto-detect tokens when modal opens
  useEffect(() => {
    if (!open) return;
    runAutoDetect();
  }, [open]);

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

      onSuccess?.();
      onClose();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setImporting(false);
    }
  };

  return (
    <Modal open={open} title="Connect Cursor IDE" onClose={onClose}>
      <div className="flex flex-col gap-4">
        {/* Auto-detecting state */}
        {autoDetecting && (
          <div className="text-center py-6 flex flex-col items-center gap-3">
            <span className="material-symbols-outlined text-4xl text-primary animate-spin">
              progress_activity
            </span>
            <h3 className="text-lg font-semibold mb-2">Auto-detecting tokens...</h3>
            <p className="text-sm text-muted-foreground animate-pulse font-medium">
              Reading from Cursor IDE database
            </p>
          </div>
        )}

        {/* Form (shown after auto-detect completes) */}
        {!autoDetecting && (
          <>
            {/* Success message if auto-detected */}
            {autoDetected && (
              <div className="bg-primary/10 p-3 rounded-lg border border-primary/20 flex items-center gap-2">
                <CheckCircle className="size-4 text-primary" weight="bold" />
                <p className="text-xs font-bold uppercase tracking-wide text-primary">
                  Tokens auto-detected from Cursor IDE successfully!
                </p>
              </div>
            )}

            {/* Windows manual instructions */}
            {windowsManual && (
              <div className="bg-amber-500/10 dark:bg-amber-500/5 p-3 rounded-lg border border-amber-500/20 flex flex-col gap-2">
                <div className="flex gap-2 items-center">
                  <Info className="size-4 text-amber-500" weight="bold" />
                  <p className="text-xs font-bold uppercase tracking-wide text-amber-500">
                    Could not read Cursor database automatically.
                  </p>
                </div>
                <p className="text-[10px] text-amber-600/80 dark:text-amber-500/60 font-medium leading-relaxed italic">
                  Make sure Cursor IDE has been opened at least once, then click <strong>Retry</strong>. If the problem persists, paste your tokens manually below.
                </p>
                <Button onClick={runAutoDetect} variant="outline" className="h-8 text-[10px] font-bold uppercase tracking-widest border-amber-500/30 hover:bg-amber-500/10 text-amber-600">
                  Retry Detection
                </Button>
              </div>
            )}

            {/* Info message if not auto-detected */}
            {!autoDetected && !windowsManual && !error && (
              <div className="bg-muted/10 p-3 rounded-lg border border-border/50 flex items-center gap-2">
                <Info className="size-4 text-muted-foreground" weight="bold" />
                <p className="text-xs font-medium text-muted-foreground">
                  Cursor IDE not detected. Please paste your tokens manually.
                </p>
              </div>
            )}

            {/* Access Token Input */}
            <div className="grid gap-2">
              <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground opacity-60 px-1">
                Access Token <span className="text-destructive">*</span>
              </label>
              <textarea
                value={accessToken}
                onChange={(e) => setAccessToken(e.target.value)}
                placeholder="Access token will be auto-filled..."
                rows={3}
                className="w-full px-3 py-2 text-xs font-mono border border-border/50 rounded-none bg-muted/5 focus:outline-none focus:border-primary/50 resize-none transition-colors"
              />
            </div>

            {/* Machine ID Input */}
            <div className="grid gap-2">
              <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground opacity-60 px-1">
                Machine ID <span className="text-destructive">*</span>
              </label>
              <Input
                value={machineId}
                onChange={(e) => setMachineId(e.target.value)}
                placeholder="Machine ID will be auto-filled..."
                className="font-mono text-xs h-10 bg-muted/5 border-border/50 rounded-none"
              />
            </div>

            {/* Error Display */}
            {error && (
              <div className="bg-destructive/10 p-3 rounded-lg border border-destructive/20 flex items-center gap-2">
                <WarningCircle className="size-4 text-destructive" weight="bold" />
                <p className="text-xs font-bold uppercase tracking-wide text-destructive">{error}</p>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex gap-2 pt-2">
              <Button
                onClick={handleImportToken}
                className="flex-1 h-10 font-bold text-xs uppercase tracking-widest"
                disabled={importing || !accessToken.trim() || !machineId.trim()}
              >
                {importing ? "Importing..." : "Import Token"}
              </Button>
              <Button onClick={onClose} variant="ghost" className="flex-1 h-10 font-bold text-xs uppercase tracking-widest border border-border/50 rounded-none">
                Cancel
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
