"use client";

import { useState, useEffect } from "react";
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

export default function EditCompatibleNodeModal({
  isOpen,
  node,
  onSave,
  onClose,
  isAnthropic,
}) {
  const [formData, setFormData] = useState({
    name: "",
    prefix: "",
    apiType: "chat",
    baseUrl: "https://api.openai.com/v1",
  });
  const [saving, setSaving] = useState(false);
  const [checkKey, setCheckKey] = useState("");
  const [checkModelId, setCheckModelId] = useState("");
  const [validating, setValidating] = useState(false);
  const [validationResult, setValidationResult] = useState(null);

  useEffect(() => {
    if (node) {
      setFormData({
        name: node.name || "",
        prefix: node.prefix || "",
        apiType: node.apiType || "chat",
        baseUrl:
          node.baseUrl ||
          (isAnthropic
            ? "https://api.anthropic.com/v1"
            : "https://api.openai.com/v1"),
      });
    }
  }, [node, isAnthropic]);

  const apiTypeOptions = [
    { value: "chat", label: "Chat Completions" },
    { value: "responses", label: "Responses API" },
  ];

  const handleSubmit = async () => {
    if (
      !formData.name.trim() ||
      !formData.prefix.trim() ||
      !formData.baseUrl.trim()
    )
      return;
    setSaving(true);
    try {
      const payload = {
        name: formData.name,
        prefix: formData.prefix,
        baseUrl: formData.baseUrl,
      };
      if (!isAnthropic) {
        payload.apiType = formData.apiType;
      }
      await onSave(payload);
    } finally {
      setSaving(false);
    }
  };

  const handleValidate = async () => {
    setValidating(true);
    try {
      const res = await fetch("/api/provider-nodes/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl: formData.baseUrl,
          apiKey: checkKey,
          type: isAnthropic ? "anthropic-compatible" : "openai-compatible",
          modelId: checkModelId.trim() || undefined,
        }),
      });
      const data = await res.json();
      setValidationResult(data.valid ? "success" : "failed");
    } catch {
      setValidationResult("failed");
    } finally {
      setValidating(false);
    }
  };

  if (!node) return null;

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            Edit {isAnthropic ? "Anthropic" : "OpenAI"} Compatible
          </DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="space-y-2">
            <Label htmlFor="edit-node-name">Name</Label>
            <Input
              id="edit-node-name"
              value={formData.name}
              onChange={(e) =>
                setFormData({ ...formData, name: e.target.value })
              }
              placeholder={`${isAnthropic ? "Anthropic" : "OpenAI"} Compatible (Prod)`}
            />
            <p className="text-xs text-muted-foreground">
              Required. A friendly label for this node.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-node-prefix">Prefix</Label>
            <Input
              id="edit-node-prefix"
              value={formData.prefix}
              onChange={(e) =>
                setFormData({ ...formData, prefix: e.target.value })
              }
              placeholder={isAnthropic ? "ac-prod" : "oc-prod"}
            />
            <p className="text-xs text-muted-foreground">
              Required. Used as the provider prefix for model IDs.
            </p>
          </div>
          {!isAnthropic && (
            <div className="space-y-2">
              <Label>API Type</Label>
              <Select
                value={formData.apiType}
                onValueChange={(v) =>
                  setFormData({ ...formData, apiType: v })
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {apiTypeOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="edit-node-base">Base URL</Label>
            <Input
              id="edit-node-base"
              value={formData.baseUrl}
              onChange={(e) =>
                setFormData({ ...formData, baseUrl: e.target.value })
              }
              placeholder={
                isAnthropic
                  ? "https://api.anthropic.com/v1"
                  : "https://api.openai.com/v1"
              }
            />
            <p className="text-xs text-muted-foreground">
              Use the base URL (ending in /v1) for your{" "}
              {isAnthropic ? "Anthropic" : "OpenAI"}-compatible API.
            </p>
          </div>
          <div className="flex gap-2">
            <div className="min-w-0 flex-1 space-y-2">
              <Label htmlFor="edit-node-check-key">API Key (for Check)</Label>
              <Input
                id="edit-node-check-key"
                type="password"
                value={checkKey}
                onChange={(e) => setCheckKey(e.target.value)}
              />
            </div>
            <div className="flex items-end">
              <Button
                type="button"
                variant="secondary"
                onClick={handleValidate}
                disabled={!checkKey || validating || !formData.baseUrl.trim()}
              >
                {validating ? "Checking..." : "Check"}
              </Button>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-node-model">Model ID (optional)</Label>
            <Input
              id="edit-node-model"
              value={checkModelId}
              onChange={(e) => setCheckModelId(e.target.value)}
              placeholder="e.g. my-model-id"
            />
            <p className="text-xs text-muted-foreground">
              If provider lacks /models endpoint, enter a model ID to validate via
              chat/completions instead.
            </p>
          </div>
          {validationResult &&
            (validationResult === "success" ? (
              <Badge className="border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300">
                Valid
              </Badge>
            ) : (
              <Badge variant="destructive">Invalid</Badge>
            ))}
          <div className="flex gap-2">
            <Button
              type="button"
              className="flex-1"
              onClick={handleSubmit}
              disabled={
                !formData.name.trim() ||
                !formData.prefix.trim() ||
                !formData.baseUrl.trim() ||
                saving
              }
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

EditCompatibleNodeModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  node: PropTypes.shape({
    id: PropTypes.string,
    name: PropTypes.string,
    prefix: PropTypes.string,
    apiType: PropTypes.string,
    baseUrl: PropTypes.string,
  }),
  onSave: PropTypes.func.isRequired,
  onClose: PropTypes.func.isRequired,
  isAnthropic: PropTypes.bool,
};
