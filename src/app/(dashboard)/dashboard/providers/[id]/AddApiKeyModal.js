"use client";

import { useState } from "react";
import PropTypes from "prop-types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export default function AddApiKeyModal({
  isOpen,
  provider,
  providerName,
  isCompatible,
  isAnthropic,
  proxyPools,
  onSave,
  onClose,
}) {
  const NONE_PROXY_POOL_VALUE = "__none__";

  const [formData, setFormData] = useState({
    name: "",
    apiKey: "",
    priority: 1,
    proxyPoolId: NONE_PROXY_POOL_VALUE,
  });
  const [validating, setValidating] = useState(false);
  const [validationResult, setValidationResult] = useState(null);
  const [saving, setSaving] = useState(false);

  const proxyOptions = [
    { value: NONE_PROXY_POOL_VALUE, label: "None" },
    ...(proxyPools || []).map((pool) => ({ value: pool.id, label: pool.name })),
  ];

  const handleValidate = async () => {
    setValidating(true);
    try {
      const res = await fetch("/api/providers/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, apiKey: formData.apiKey }),
      });
      const data = await res.json();
      setValidationResult(data.valid ? "success" : "failed");
    } catch {
      setValidationResult("failed");
    } finally {
      setValidating(false);
    }
  };

  const handleSubmit = async () => {
    if (!provider || !formData.apiKey) return;

    setSaving(true);
    try {
      let isValid = false;
      try {
        setValidating(true);
        setValidationResult(null);
        const res = await fetch("/api/providers/validate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ provider, apiKey: formData.apiKey }),
        });
        const data = await res.json();
        isValid = !!data.valid;
        setValidationResult(isValid ? "success" : "failed");
      } catch {
        setValidationResult("failed");
      } finally {
        setValidating(false);
      }

      await onSave({
        name: formData.name,
        apiKey: formData.apiKey,
        priority: formData.priority,
        proxyPoolId:
          formData.proxyPoolId === NONE_PROXY_POOL_VALUE
            ? null
            : formData.proxyPoolId,
        testStatus: isValid ? "active" : "unknown",
        providerSpecificData: undefined,
      });
    } finally {
      setSaving(false);
    }
  };

  if (!provider) return null;

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add {providerName || provider} API Key</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="space-y-2">
            <Label htmlFor="add-key-name">Name</Label>
            <Input
              id="add-key-name"
              value={formData.name}
              onChange={(e) =>
                setFormData({ ...formData, name: e.target.value })
              }
              placeholder="Production Key"
            />
          </div>
          <div className="flex gap-2">
            <div className="min-w-0 flex-1 space-y-2">
              <Label htmlFor="add-key-secret">API Key</Label>
              <Input
                id="add-key-secret"
                type="password"
                value={formData.apiKey}
                onChange={(e) =>
                  setFormData({ ...formData, apiKey: e.target.value })
                }
              />
            </div>
            <div className="flex items-end">
              <Button
                type="button"
                variant="secondary"
                onClick={handleValidate}
                disabled={!formData.apiKey || validating || saving}
              >
                {validating ? "Checking..." : "Check"}
              </Button>
            </div>
          </div>
          {validationResult &&
            (validationResult === "success" ? (
              <Badge className="border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300">
                Valid
              </Badge>
            ) : (
              <Badge variant="destructive">Invalid</Badge>
            ))}
          {isCompatible && (
            <p className="text-xs text-muted-foreground">
              {isAnthropic
                ? `Validation checks ${providerName || "Anthropic Compatible"} by verifying the API key.`
                : `Validation checks ${providerName || "OpenAI Compatible"} via /models on your base URL.`}
            </p>
          )}
          <div className="space-y-2">
            <Label htmlFor="add-key-priority">Priority</Label>
            <Input
              id="add-key-priority"
              type="number"
              value={formData.priority}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  priority: Number.parseInt(e.target.value, 10) || 1,
                })
              }
            />
          </div>
          <div className="space-y-2">
            <Label>Proxy Pool</Label>
            <Select
              value={formData.proxyPoolId}
              onValueChange={(v) =>
                setFormData({ ...formData, proxyPoolId: v })
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="None" />
              </SelectTrigger>
              <SelectContent>
                {proxyOptions.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {(proxyPools || []).length === 0 && (
            <p className="text-xs text-muted-foreground">
              No active proxy pools available. Create one in Proxy Pools page
              first.
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            Legacy manual proxy fields are still accepted by API for backward
            compatibility.
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              className="flex-1"
              onClick={handleSubmit}
              disabled={!formData.name || !formData.apiKey || saving}
            >
              {saving ? "Saving..." : "Save"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="flex-1"
              onClick={onClose}
            >
              Cancel
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

AddApiKeyModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  provider: PropTypes.string,
  providerName: PropTypes.string,
  isCompatible: PropTypes.bool,
  isAnthropic: PropTypes.bool,
  proxyPools: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.string,
      name: PropTypes.string,
    }),
  ),
  onSave: PropTypes.func.isRequired,
  onClose: PropTypes.func.isRequired,
};
