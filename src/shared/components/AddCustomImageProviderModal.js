"use client";

import { useState, useEffect } from "react";
import PropTypes from "prop-types";
import { Modal, Input, Button } from "@/shared/components";

const DEFAULT_BASE_URL = "https://api.openai.com/v1";

// Add a custom image provider node (openai-compatible, chat apiType) + bind API key.
export default function AddCustomImageProviderModal({ isOpen, onClose, onCreated }) {
  const [formData, setFormData] = useState({
    name: "",
    prefix: "",
    baseUrl: DEFAULT_BASE_URL,
    apiKey: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isOpen) return;
    setError("");
    setFormData({ name: "", prefix: "", baseUrl: DEFAULT_BASE_URL, apiKey: "" });
  }, [isOpen]);

  const handleSubmit = async () => {
    if (!formData.name.trim() || !formData.prefix.trim() || !formData.baseUrl.trim()) return;
    if (!formData.apiKey.trim()) {
      setError("API Key is required");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      // 1. Create openai-compatible node
      const nodeRes = await fetch("/api/provider-nodes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formData.name,
          prefix: formData.prefix,
          baseUrl: formData.baseUrl,
          type: "openai-compatible",
          apiType: "chat",
        }),
      });
      const nodeData = await nodeRes.json();
      if (!nodeRes.ok) {
        setError(nodeData.error || "Failed to create node");
        return;
      }
      const node = nodeData.node;

      // 2. Bind API key to the node
      const connRes = await fetch("/api/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: node.id,
          name: formData.name,
          apiKey: formData.apiKey,
        }),
      });
      const connData = await connRes.json();
      if (!connRes.ok) {
        setError(connData.error || "Failed to bind API key");
        return;
      }

      onCreated?.(node);
      onClose();
    } catch (e) {
      setError("Network error");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Add Custom Image Provider">
      <div className="flex flex-col gap-3">
        <div>
          <label className="text-xs text-text-muted">Name</label>
          <Input
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            placeholder="e.g. my-relay"
          />
        </div>
        <div>
          <label className="text-xs text-text-muted">Prefix (model alias, e.g. my-relay/&lt;model&gt;)</label>
          <Input
            value={formData.prefix}
            onChange={(e) => setFormData({ ...formData, prefix: e.target.value })}
            placeholder="e.g. mr"
          />
        </div>
        <div>
          <label className="text-xs text-text-muted">Base URL</label>
          <Input
            value={formData.baseUrl}
            onChange={(e) => setFormData({ ...formData, baseUrl: e.target.value })}
            placeholder="https://api.example.com/v1"
          />
        </div>
        <div>
          <label className="text-xs text-text-muted">API Key</label>
          <Input
            type="password"
            value={formData.apiKey}
            onChange={(e) => setFormData({ ...formData, apiKey: e.target.value })}
            placeholder="sk-..."
          />
        </div>
        {error && <p className="text-xs text-red-500">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button size="sm" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSubmit} disabled={submitting}>
            {submitting ? "Adding..." : "Add Provider"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

AddCustomImageProviderModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onCreated: PropTypes.func,
};
