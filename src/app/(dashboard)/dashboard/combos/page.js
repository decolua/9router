"use client";

import { useState, useEffect } from "react";
import { Card, Button, Modal, Input, CardSkeleton, ModelSelectModal } from "@/shared/components";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";

// Validate combo name: only a-z, A-Z, 0-9, -, _
const VALID_NAME_REGEX = /^[a-zA-Z0-9_-]+$/;

export default function CombosPage() {
  const [combos, setCombos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingCombo, setEditingCombo] = useState(null);
  const [activeProviders, setActiveProviders] = useState([]);
  const { copied, copy } = useCopyToClipboard();

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [combosRes, providersRes] = await Promise.all([fetch("/api/combos"), fetch("/api/providers")]);
      const combosData = await combosRes.json();
      const providersData = await providersRes.json();

      if (combosRes.ok) setCombos(combosData.combos || []);
      if (providersRes.ok) {
        const active = (providersData.connections || []).filter(
          (c) => c.testStatus === "active" || c.testStatus === "success"
        );
        setActiveProviders(active);
      }
    } catch (error) {
      console.log("Error fetching data:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async (data) => {
    try {
      const res = await fetch("/api/combos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (res.ok) {
        await fetchData();
        setShowCreateModal(false);
      } else {
        const err = await res.json();
        alert(err.error || "Failed to create combo");
      }
    } catch (error) {
      console.log("Error creating combo:", error);
    }
  };

  const handleUpdate = async (id, data) => {
    try {
      const res = await fetch(`/api/combos/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (res.ok) {
        await fetchData();
        setEditingCombo(null);
      } else {
        const err = await res.json();
        alert(err.error || "Failed to update combo");
      }
    } catch (error) {
      console.log("Error updating combo:", error);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm("Delete this combo?")) return;
    try {
      const res = await fetch(`/api/combos/${id}`, { method: "DELETE" });
      if (res.ok) {
        setCombos(combos.filter((c) => c.id !== id));
      }
    } catch (error) {
      console.log("Error deleting combo:", error);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col gap-6">
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Combos</h1>
          <p className="text-sm text-text-muted mt-1">Create model combos with fallback support</p>
        </div>
        <Button icon="add" onClick={() => setShowCreateModal(true)}>
          Create Combo
        </Button>
      </div>

      {/* Combos List */}
      {combos.length === 0 ? (
        <Card>
          <div className="text-center py-12">
            <span className="material-symbols-outlined text-5xl text-text-muted mb-3 block">layers</span>
            <p className="text-text-muted mb-4">No combos yet</p>
            <Button icon="add" onClick={() => setShowCreateModal(true)}>
              Create your first combo
            </Button>
          </div>
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          {combos.map((combo) => (
            <ComboCard
              key={combo.id}
              combo={combo}
              copied={copied}
              onCopy={copy}
              onEdit={() => setEditingCombo(combo)}
              onDelete={() => handleDelete(combo.id)}
            />
          ))}
        </div>
      )}

      {/* Create Modal - Use key to force remount and reset state */}
      <ComboFormModal
        key="create"
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onSave={handleCreate}
        activeProviders={activeProviders}
      />

      {/* Edit Modal - Use key to force remount and reset state */}
      <ComboFormModal
        key={editingCombo?.id || "new"}
        isOpen={!!editingCombo}
        combo={editingCombo}
        onClose={() => setEditingCombo(null)}
        onSave={(data) => handleUpdate(editingCombo.id, data)}
        activeProviders={activeProviders}
      />
    </div>
  );
}

function ComboCard({ combo, copied, onCopy, onEdit, onDelete }) {
  return (
    <Card>
      <div className="flex items-start justify-between">
        <div className="flex-1">
          {/* Name + Copy */}
          <div className="flex items-center gap-2 mb-3">
            <span className="material-symbols-outlined text-primary">layers</span>
            <code className="text-lg font-semibold font-mono">{combo.name}</code>
            <button
              onClick={() => onCopy(combo.name, `combo-${combo.id}`)}
              className="p-1 hover:bg-sidebar rounded text-text-muted hover:text-primary"
              title="Copy combo name"
            >
              <span className="material-symbols-outlined text-sm">
                {copied === `combo-${combo.id}` ? "check" : "content_copy"}
              </span>
            </button>
          </div>

          {/* Models list */}
          <div className="flex flex-col gap-1.5">
            {combo.models.length === 0 ? (
              <p className="text-sm text-text-muted italic">No models added</p>
            ) : (
              combo.models.map((model, index) => (
                <div key={index} className="flex items-center gap-2">
                  <span className="text-xs text-text-muted w-5">{index + 1}.</span>
                  <code className="text-sm font-mono bg-sidebar px-2 py-0.5 rounded">{model}</code>
                  {index === 0 && <span className="text-xs text-primary font-medium">Primary</span>}
                  {index > 0 && <span className="text-xs text-text-muted">Fallback</span>}
                </div>
              ))
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-1">
          <button
            onClick={onEdit}
            className="p-2 hover:bg-sidebar rounded text-text-muted hover:text-primary"
            title="Edit"
          >
            <span className="material-symbols-outlined text-lg">edit</span>
          </button>
          <button onClick={onDelete} className="p-2 hover:bg-red-50 rounded text-red-500" title="Delete">
            <span className="material-symbols-outlined text-lg">delete</span>
          </button>
        </div>
      </div>
    </Card>
  );
}

function ComboFormModal({ isOpen, combo, onClose, onSave, activeProviders }) {
  // Initialize state with combo values - key prop on parent handles reset on remount
  const [name, setName] = useState(combo?.name || "");
  const [models, setModels] = useState(combo?.models || []);
  const [showModelSelect, setShowModelSelect] = useState(false);
  const [saving, setSaving] = useState(false);
  const [nameError, setNameError] = useState("");
  const [modelAliases, setModelAliases] = useState({});

  // Fetch model aliases when modal opens
  useEffect(() => {
    if (isOpen) {
      const fetchModelAliases = async () => {
        try {
          const res = await fetch("/api/models/alias");
          const data = await res.json();
          if (res.ok) setModelAliases(data.aliases || {});
        } catch (error) {
          console.log("Error fetching model aliases:", error);
        }
      };
      fetchModelAliases();
    }
  }, [isOpen]);

  const validateName = (value) => {
    if (!value.trim()) {
      setNameError("Name is required");
      return false;
    }
    if (!VALID_NAME_REGEX.test(value)) {
      setNameError("Only letters, numbers, - and _ allowed");
      return false;
    }
    setNameError("");
    return true;
  };

  const handleNameChange = (e) => {
    const value = e.target.value;
    setName(value);
    if (value) validateName(value);
    else setNameError("");
  };

  const handleAddModel = (model) => {
    if (!models.includes(model.value)) {
      setModels([...models, model.value]);
    }
  };

  const handleRemoveModel = (index) => {
    setModels(models.filter((_, i) => i !== index));
  };

  const handleModelChange = (index, value) => {
    const newModels = [...models];
    newModels[index] = value;
    setModels(newModels);
  };

  const handleMoveUp = (index) => {
    if (index === 0) return;
    const newModels = [...models];
    [newModels[index - 1], newModels[index]] = [newModels[index], newModels[index - 1]];
    setModels(newModels);
  };

  const handleMoveDown = (index) => {
    if (index === models.length - 1) return;
    const newModels = [...models];
    [newModels[index], newModels[index + 1]] = [newModels[index + 1], newModels[index]];
    setModels(newModels);
  };

  const handleSave = async () => {
    if (!validateName(name)) return;
    setSaving(true);
    await onSave({ name: name.trim(), models });
    setSaving(false);
  };

  const isEdit = !!combo;

  return (
    <>
      <Modal isOpen={isOpen} onClose={onClose} title={isEdit ? "Edit Combo" : "Create Combo"} size="md">
        <div className="flex flex-col gap-4">
          {/* Name */}
          <div>
            <Input
              label="Combo Name"
              value={name}
              onChange={handleNameChange}
              placeholder="my-combo"
              error={nameError}
            />
            <p className="text-xs text-text-muted mt-1">Only letters, numbers, - and _ allowed</p>
          </div>

          {/* Models */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium">Models</label>
              <Button size="sm" variant="secondary" icon="add" onClick={() => setShowModelSelect(true)}>
                Add Model
              </Button>
            </div>

            {models.length === 0 ? (
              <div className="text-center py-6 border border-dashed border-border rounded-lg">
                <p className="text-sm text-text-muted">No models added</p>
                <p className="text-xs text-text-muted mt-1">Click &quot;Add Model&quot; to add</p>
              </div>
            ) : (
              <div className="flex flex-col gap-2 max-h-[240px] overflow-y-auto">
                {models.map((model, index) => (
                  <div key={index} className="flex items-center gap-2">
                    {/* Priority arrows */}
                    <div className="flex flex-col gap-0">
                      <button
                        onClick={() => handleMoveUp(index)}
                        disabled={index === 0}
                        className={`p-0.5 rounded ${index === 0 ? "text-text-muted/30" : "hover:bg-surface text-text-muted hover:text-primary"}`}
                      >
                        <span className="material-symbols-outlined text-sm leading-none">keyboard_arrow_up</span>
                      </button>
                      <button
                        onClick={() => handleMoveDown(index)}
                        disabled={index === models.length - 1}
                        className={`p-0.5 rounded ${index === models.length - 1 ? "text-text-muted/30" : "hover:bg-surface text-text-muted hover:text-primary"}`}
                      >
                        <span className="material-symbols-outlined text-sm leading-none">keyboard_arrow_down</span>
                      </button>
                    </div>

                    {/* Model Input */}
                    <Input
                      value={model}
                      onChange={(e) => handleModelChange(index, e.target.value)}
                      placeholder="model-name"
                      className="flex-1"
                    />

                    {/* Remove */}
                    <button
                      onClick={() => handleRemoveModel(index)}
                      className="p-2 hover:bg-red-50 rounded text-red-500"
                    >
                      <span className="material-symbols-outlined text-sm">close</span>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-2">
            <Button onClick={handleSave} fullWidth disabled={!name.trim() || !!nameError || saving}>
              {saving ? "Saving..." : "Apply"}
            </Button>
            <Button onClick={onClose} variant="ghost" fullWidth>
              Cancel
            </Button>
          </div>
        </div>
      </Modal>

      {/* Model Select Modal */}
      <ModelSelectModal
        isOpen={showModelSelect}
        onClose={() => setShowModelSelect(false)}
        onSelect={handleAddModel}
        activeProviders={activeProviders}
        modelAliases={modelAliases}
        title="Add Model to Combo"
      />
    </>
  );
}
