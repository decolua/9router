"use client";

import { useEffect, useState } from "react";
import PropTypes from "prop-types";
import { Badge, Button, Input, Modal, Select } from "@/shared/components";

const API_TYPE_OPTIONS = [
  { value: "chat", label: "Chat Completions" },
  { value: "responses", label: "Responses API" },
];

export default function EditCompatibleNodeModal({
  isOpen,
  node,
  onSave,
  onClose,
  isAnthropic,
}) {
  const isMulti = node?.type === "multi-compatible";
  const [formData, setFormData] = useState({
    name: "",
    prefix: "",
    apiType: "chat",
    baseUrl: "https://api.openai.com/v1",
    openaiUrl: "",
    anthropicUrl: "",
    supportsResponses: false,
  });
  const [saving, setSaving] = useState(false);
  const [checkKey, setCheckKey] = useState("");
  const [checkModelId, setCheckModelId] = useState("");
  const [validating, setValidating] = useState(false);
  const [validationResult, setValidationResult] = useState(null);

  useEffect(() => {
    if (!node) return;

    const transportUrl = (format) =>
      node.transports?.find((transport) => transport.format === format)?.baseUrl || "";
    setFormData({
      name: node.name || "",
      prefix: node.prefix || "",
      apiType: node.apiType || "chat",
      baseUrl:
        node.baseUrl ||
        (isAnthropic
          ? "https://api.anthropic.com/v1"
          : "https://api.openai.com/v1"),
      openaiUrl: node.baseUrl || transportUrl("openai"),
      anthropicUrl: transportUrl("claude"),
      supportsResponses: Boolean(transportUrl("openai-responses")),
    });
    setValidationResult(null);
  }, [node, isAnthropic]);

  const hasRequiredEndpoints = isMulti
    ? formData.openaiUrl.trim() && formData.anthropicUrl.trim()
    : formData.baseUrl.trim();

  const handleSubmit = async () => {
    if (!formData.name.trim() || !formData.prefix.trim() || !hasRequiredEndpoints) return;
    setSaving(true);
    try {
      const payload = {
        name: formData.name,
        prefix: formData.prefix,
        ...(isMulti
          ? {
              openaiUrl: formData.openaiUrl,
              anthropicUrl: formData.anthropicUrl,
              supportsResponses: formData.supportsResponses,
            }
          : { baseUrl: formData.baseUrl }),
      };
      if (!isAnthropic && !isMulti) payload.apiType = formData.apiType;
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
          ...(isMulti
            ? {
                openaiUrl: formData.openaiUrl,
                anthropicUrl: formData.anthropicUrl,
                responsesUrl: formData.responsesUrl,
              }
            : { baseUrl: formData.baseUrl }),
          apiKey: checkKey,
          type: isMulti
            ? "multi-compatible"
            : isAnthropic
              ? "anthropic-compatible"
              : "openai-compatible",
          modelId: checkModelId.trim() || undefined,
        }),
      });
      const data = await res.json();
      setValidationResult(data.valid ? data : "failed");
      if (isMulti && data.valid) {
        setFormData((prev) => ({
          ...prev,
          supportsResponses: Boolean(data.supportsResponses),
        }));
      }
    } catch {
      setValidationResult("failed");
    } finally {
      setValidating(false);
    }
  };

  if (!node) return null;

  const providerLabel = isMulti
    ? "Multi-protocol"
    : isAnthropic
      ? "Anthropic"
      : "OpenAI";

  return (
    <Modal isOpen={isOpen} title={`Edit ${providerLabel} Compatible`} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <Input
          label="Name"
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          placeholder={`${providerLabel} Compatible (Prod)`}
          hint="Required. A friendly label for this node."
        />
        <Input
          label="Prefix"
          value={formData.prefix}
          onChange={(e) => setFormData({ ...formData, prefix: e.target.value })}
          placeholder={isMulti ? "multi-prod" : isAnthropic ? "ac-prod" : "oc-prod"}
          hint="Required. Used as the provider prefix for model IDs."
        />
        {!isAnthropic && !isMulti && (
          <Select
            label="API Type"
            options={API_TYPE_OPTIONS}
            value={formData.apiType}
            onChange={(e) => setFormData({ ...formData, apiType: e.target.value })}
          />
        )}
        {isMulti ? (
          <>
            <Input
              label="OpenAI URL"
              value={formData.openaiUrl}
              onChange={(e) => setFormData({
                ...formData,
                openaiUrl: e.target.value,
                supportsResponses: false,
              })}
              placeholder="https://provider.example/v1"
              hint="Required. Base URL, Chat Completions URL, or Responses URL. Check detects Responses support."
            />
            <Input
              label="Anthropic Messages URL"
              value={formData.anthropicUrl}
              onChange={(e) => setFormData({ ...formData, anthropicUrl: e.target.value })}
              placeholder="https://provider.example/v1/messages"
              hint="Required. Base URL or full Anthropic Messages endpoint URL."
            />
          </>
        ) : (
          <Input
            label="Base URL"
            value={formData.baseUrl}
            onChange={(e) => setFormData({ ...formData, baseUrl: e.target.value })}
            placeholder={
              isAnthropic
                ? "https://api.anthropic.com/v1"
                : "https://api.openai.com/v1"
            }
            hint={`Use the base URL ending in /v1 for your ${providerLabel}-compatible API.`}
          />
        )}
        <Input
          label="API Key (for Check)"
          type="password"
          value={checkKey}
          onChange={(e) => setCheckKey(e.target.value)}
        />
        <Input
          label={isMulti ? "Model ID" : "Model ID (optional)"}
          value={checkModelId}
          onChange={(e) => setCheckModelId(e.target.value)}
          placeholder="e.g. my-model-id"
          hint={
            isMulti
              ? "Required to check each protocol endpoint."
              : "If the provider lacks /models, enter a model ID to validate with inference."
          }
        />
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Button
            onClick={handleValidate}
            disabled={
              !checkKey ||
              validating ||
              !hasRequiredEndpoints ||
              (isMulti && !checkModelId.trim())
            }
            variant="secondary"
            className="w-full sm:w-auto"
          >
            {validating ? "Checking..." : "Check"}
          </Button>
          {validationResult && (
            <>
              <Badge variant={validationResult === "failed" ? "error" : "success"}>
                {validationResult === "failed" ? "Invalid" : "Valid"}
              </Badge>
              {isMulti && validationResult !== "failed" && (
                <span className="text-sm text-text-muted">
                  {validationResult.supportsResponses
                    ? "Responses supported"
                    : "Responses will use Chat fallback"}
                </span>
              )}
            </>
          )}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            onClick={handleSubmit}
            fullWidth
            disabled={
              !formData.name.trim() ||
              !formData.prefix.trim() ||
              !hasRequiredEndpoints ||
              saving
            }
          >
            {saving ? "Saving..." : "Save"}
          </Button>
          <Button onClick={onClose} variant="ghost" fullWidth>
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
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
    type: PropTypes.string,
    transports: PropTypes.arrayOf(
      PropTypes.shape({
        format: PropTypes.string,
        baseUrl: PropTypes.string,
      }),
    ),
  }),
  onSave: PropTypes.func.isRequired,
  onClose: PropTypes.func.isRequired,
  isAnthropic: PropTypes.bool,
};
