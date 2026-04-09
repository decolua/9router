"use client";

import { useState, useEffect, useMemo } from "react";
import PropTypes from "prop-types";
import { Modal, Button, Badge, Input } from "@/shared/components";

export default function ScanModelsModal({ isOpen, providerId, connectionId, providerName, onClose }) {
  const [scanning, setScanning] = useState(false);
  const [models, setModels] = useState([]);
  const [selectedModels, setSelectedModels] = useState(new Set());
  const [searchQuery, setSearchQuery] = useState("");
  const [error, setError] = useState("");
  const [importing, setImporting] = useState(false);
  const [importSuccess, setImportSuccess] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setModels([]);
      setSelectedModels(new Set());
      setSearchQuery("");
      setError("");
      setImportSuccess(false);
    }
  }, [isOpen]);

  const filteredModels = useMemo(() => {
    if (!searchQuery.trim()) return models;
    const query = searchQuery.toLowerCase();
    return models.filter(m =>
      m.id.toLowerCase().includes(query) ||
      (m.name && m.name.toLowerCase().includes(query))
    );
  }, [models, searchQuery]);

  const handleScan = async () => {
    if (!connectionId) {
      setError("No connection available. Please add a connection first.");
      return;
    }
    setScanning(true);
    setError("");
    setModels([]);
    try {
      const res = await fetch(`/api/providers/${connectionId}/models`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to fetch models");
        return;
      }
      if (data.models && data.models.length > 0) {
        setModels(data.models.map(m => ({
          id: m.id || m.name || m,
          name: m.name || m.id || m,
          owned_by: m.owned_by || m.owned_by || m.provider
        })));
      } else {
        setError("No models found from the provider.");
      }
      if (data.warning) {
        setError(data.warning);
      }
    } catch (err) {
      setError(err.message || "Failed to fetch models");
    } finally {
      setScanning(false);
    }
  };

  const toggleModel = (modelId) => {
    setSelectedModels((prev) => {
      const next = new Set(prev);
      if (next.has(modelId)) {
        next.delete(modelId);
      } else {
        next.add(modelId);
      }
      return next;
    });
  };

  const toggleAll = () => {
    const targetModels = filteredModels;
    if (selectedModels.size === targetModels.length && targetModels.every(m => selectedModels.has(m.id))) {
      setSelectedModels(new Set());
    } else {
      setSelectedModels(new Set(targetModels.map(m => m.id)));
    }
  };

  const handleImport = async () => {
    if (selectedModels.size === 0) return;
    setImporting(true);
    try {
      const providerAlias = providerId;
      const aliases = Array.from(selectedModels).map(modelId => ({
        model: `${providerAlias}/${modelId}`,
        alias: modelId
      }));

      const res = await fetch("/api/models/alias/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ aliases })
      });
      
      const data = await res.json();
      
      if (!res.ok) {
        setError(data.error || "Failed to import models");
      } else if (data.failed && data.failed.length > 0) {
        setError(`Failed to import ${data.failed.length} model(s)`);
      } else {
        setImportSuccess(true);
        setTimeout(() => onClose(true), 1000);
      }
    } catch (err) {
      setError(err.message || "Failed to import models");
    } finally {
      setImporting(false);
    }
  };

  return (
    <Modal isOpen={isOpen} title={`Scan Models - ${providerName || providerId}`} onClose={() => onClose(false)}>
      <div className="flex flex-col gap-4">
        {!models.length && !importSuccess && (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-text-muted">
              Scan the provider&apos;s /models endpoint to discover available models.
            </p>
            <Button onClick={handleScan} disabled={scanning} icon="search">
              {scanning ? "Scanning..." : "Scan Models"}
            </Button>
            {error && <p className="text-xs text-red-500">{error}</p>}
          </div>
        )}

        {models.length > 0 && !importSuccess && (
          <>
            <div className="flex items-center justify-between">
              <p className="text-sm text-text-muted">
                Found {models.length} model{models.length !== 1 ? "s" : ""}. Select models to import:
              </p>
              <button
                onClick={toggleAll}
                className="text-xs text-primary hover:underline"
              >
                {filteredModels.length > 0 && filteredModels.every(m => selectedModels.has(m.id)) && selectedModels.size === filteredModels.length
                  ? "Deselect All"
                  : "Select All"}
              </button>
            </div>
            <Input
              placeholder="Search models..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              icon="search"
            />
            {searchQuery && filteredModels.length === 0 && (
              <p className="text-xs text-text-muted text-center py-2">No models match "{searchQuery}"</p>
            )}
            <div className="max-h-[400px] overflow-y-auto flex flex-col gap-1 border border-border rounded-lg p-2">
              {filteredModels.map((model) => (
                <button
                  key={model.id}
                  onClick={() => toggleModel(model.id)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-md text-left text-sm transition-colors ${
                    selectedModels.has(model.id)
                      ? "bg-primary/10 border border-primary/30"
                      : "hover:bg-bg border border-transparent"
                  }`}
                >
                  <span className="material-symbols-outlined text-base">
                    {selectedModels.has(model.id) ? "check_box" : "check_box_outline_blank"}
                  </span>
                  <div className="flex-1 min-w-0">
                    <code className="text-xs font-mono">{model.id}</code>
                    {model.name && model.name !== model.id && (
                      <span className="text-xs text-text-muted ml-2">{model.name}</span>
                    )}
                  </div>
                  {model.owned_by && (
                    <Badge variant="default" size="sm">{model.owned_by}</Badge>
                  )}
                </button>
              ))}
            </div>
            {error && <p className="text-xs text-amber-500">{error}</p>}
            <div className="flex gap-2">
              <Button
                onClick={handleImport}
                disabled={selectedModels.size === 0 || importing}
                icon="download"
              >
                {importing ? "Importing..." : `Import ${selectedModels.size} Model${selectedModels.size !== 1 ? "s" : ""}`}
              </Button>
              <Button variant="ghost" onClick={() => onClose(false)}>
                Cancel
              </Button>
            </div>
          </>
        )}

        {importSuccess && (
          <div className="flex flex-col items-center gap-3 py-4">
            <span className="material-symbols-outlined text-green-500 text-[48px]">check_circle</span>
            <p className="text-sm text-text-muted">Models imported successfully!</p>
          </div>
        )}
      </div>
    </Modal>
  );
}

ScanModelsModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  providerId: PropTypes.string.isRequired,
  connectionId: PropTypes.string,
  providerName: PropTypes.string,
  onClose: PropTypes.func.isRequired,
};