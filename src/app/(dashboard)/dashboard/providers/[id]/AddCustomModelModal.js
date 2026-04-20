"use client";

import { useState, useEffect } from "react";
import PropTypes from "prop-types";
import { Loader2, FlaskConical } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function AddCustomModelModal({
  isOpen,
  providerAlias,
  providerDisplayAlias,
  onSave,
  onClose,
}) {
  const [modelId, setModelId] = useState("");
  const [testStatus, setTestStatus] = useState(null);
  const [testError, setTestError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setModelId("");
      setTestStatus(null);
      setTestError("");
    }
  }, [isOpen]);

  const handleTest = async () => {
    if (!modelId.trim()) return;
    setTestStatus("testing");
    setTestError("");
    try {
      const res = await fetch("/api/models/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: `${providerAlias}/${modelId.trim()}` }),
      });
      const data = await res.json();
      setTestStatus(data.ok ? "ok" : "error");
      setTestError(data.error || "");
    } catch (err) {
      setTestStatus("error");
      setTestError(err.message);
    }
  };

  const handleSave = async () => {
    if (!modelId.trim() || saving) return;
    setSaving(true);
    try {
      await onSave(modelId.trim());
    } finally {
      setSaving(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter") handleTest();
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add Custom Model</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="space-y-2">
            <Label htmlFor="custom-model-id">Model ID</Label>
            <div className="flex gap-2">
              <Input
                id="custom-model-id"
                type="text"
                value={modelId}
                onChange={(e) => {
                  setModelId(e.target.value);
                  setTestStatus(null);
                  setTestError("");
                }}
                onKeyDown={handleKeyDown}
                placeholder="e.g. claude-opus-4-5"
                className="flex-1"
                autoFocus
              />
              <Button
                type="button"
                variant="secondary"
                onClick={handleTest}
                disabled={!modelId.trim() || testStatus === "testing"}
                className="shrink-0 gap-1.5"
              >
                {testStatus === "testing" ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <FlaskConical className="size-4" />
                )}
                {testStatus === "testing" ? "..." : "Test"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Sent to provider as:{" "}
              <code className="rounded bg-muted px-1 font-mono text-xs">
                {modelId.trim() || "model-id"}
              </code>
            </p>
          </div>

          {testStatus === "ok" && (
            <div className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400">
              <span className="material-symbols-outlined text-base">
                check_circle
              </span>
              Model is reachable
            </div>
          )}
          {testStatus === "error" && (
            <div className="flex items-start gap-2 text-sm text-destructive">
              <span className="material-symbols-outlined shrink-0 text-base">
                cancel
              </span>
              <span>{testError || "Model not reachable"}</span>
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="flex-1"
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              className="flex-1"
              onClick={handleSave}
              disabled={!modelId.trim() || saving}
            >
              {saving ? "Adding..." : "Add Model"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

AddCustomModelModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  providerAlias: PropTypes.string.isRequired,
  providerDisplayAlias: PropTypes.string.isRequired,
  onSave: PropTypes.func.isRequired,
  onClose: PropTypes.func.isRequired,
};
