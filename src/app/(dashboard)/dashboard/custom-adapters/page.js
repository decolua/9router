"use client";

import { useState, useEffect } from "react";
import {
  Card,
  Badge,
  Button,
  Input,
  Select,
  Modal,
  Toggle,
} from "@/shared/components";
import { useNotificationStore } from "@/store/notificationStore";

const AUTH_TYPE_OPTIONS = [
  { value: "apikey", label: "API Key (x-api-key)" },
  { value: "bearer", label: "Bearer Token (Authorization: Bearer)" },
  { value: "cookie", label: "Cookie Header (Cookie: session_token)" },
  { value: "custom_headers", label: "Custom Headers (configured below)" },
  { value: "none", label: "No Authentication" },
];

const CATEGORY_OPTIONS = [
  { value: "custom", label: "Custom / Unofficial" },
  { value: "apikey", label: "API Key Gateway" },
  { value: "webCookie", label: "Web / Session Cookie" },
  { value: "freeTier", label: "Free / Community Tier" },
];

const TEMPLATE_PRESETS = [
  {
    label: "Simple Proxy (OpenAI format)",
    config: {
      authType: "bearer",
      format: "openai",
      headers: { "Authorization": "Bearer {{apiKey}}" },
      models: [{ id: "gpt-4o-mini", name: "GPT-4o Mini" }],
    },
  },
  {
    label: "Custom Gateway (Prompt / Completion API)",
    config: {
      authType: "apikey",
      format: "custom",
      headers: { "X-Api-Key": "{{apiKey}}" },
      requestMapping: {
        promptParam: "prompt",
        modelParam: "model",
        streamParam: "stream",
      },
      responseMapping: {
        contentPath: "result.text",
      },
      models: [{ id: "custom-v1", name: "Custom V1" }],
    },
  },
  {
    label: "Scripted JS Transformer (Custom SSE Stream)",
    config: {
      authType: "cookie",
      format: "custom",
      headers: { "Cookie": "session_id={{cookie}}" },
      transformRequest: `(context) => {
  const { model, body, headers, credentials } = context;
  const lastUserMessage = body.messages.filter(m => m.role === "user").pop();
  return {
    url: context.baseUrl + "/generate",
    headers: { ...headers, "X-Custom-Auth": credentials.apiKey },
    body: {
      query: lastUserMessage ? lastUserMessage.content : "",
      model_id: model,
    }
  };
}`,
      transformResponse: `(rawJson, state, context) => {
  return {
    id: "chatcmpl-" + Date.now(),
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: context.model,
    choices: [{
      index: 0,
      message: { role: "assistant", content: rawJson.output || rawJson.text || "" },
      finish_reason: "stop"
    }],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
  };
}`,
      transformStreamChunk: `(chunk, state, context) => {
  if (typeof chunk === "string" && chunk.startsWith("data:")) {
    const data = chunk.slice(5).trim();
    if (data === "[DONE]") return null;
    try {
      const parsed = JSON.parse(data);
      return {
        id: "chatcmpl-" + state.id,
        object: "chat.completion.chunk",
        created: Math.floor(Date.now() / 1000),
        model: context.model,
        choices: [{ index: 0, delta: { content: parsed.token || parsed.delta || "" }, finish_reason: null }]
      };
    } catch { return null; }
  }
  return null;
}`,
      models: [{ id: "web-model-pro", name: "Web Model Pro" }],
    },
  },
];

export default function CustomAdaptersPage() {
  const { addNotification } = useNotificationStore();
  const [adapters, setAdapters] = useState([]);
  const [loading, setLoading] = useState(true);

  // Modal State
  const [modalOpen, setModalOpen] = useState(false);
  const [editingAdapter, setEditingAdapter] = useState(null);
  const [activeTab, setActiveTab] = useState("general"); // general | headers | models | transformers | test

  // Form State
  const [formData, setFormData] = useState({
    id: "",
    name: "",
    prefix: "",
    baseUrl: "",
    icon: "extension",
    color: "#10a37f",
    category: "custom",
    authType: "apikey",
    description: "",
    headers: {},
    models: [{ id: "default", name: "Default Model" }],
    passthroughModels: true,
    format: "custom",
    requestMapping: null,
    responseMapping: null,
    transformRequest: "",
    transformResponse: "",
    transformStreamChunk: "",
  });

  // Header editor helper state
  const [headerEntries, setHeaderEntries] = useState([{ key: "", value: "" }]);

  // Test Playground State
  const [testModel, setTestModel] = useState("default");
  const [testPrompt, setTestPrompt] = useState("Hello! Explain how custom adapters work in 2 sentences.");
  const [testApiKey, setTestApiKey] = useState("");
  const [testCookie, setTestCookie] = useState("");
  const [testingLive, setTestingLive] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [testingInProgress, setTestingInProgress] = useState(false);

  // Load adapters from API
  const fetchAdapters = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/custom-adapters");
      const data = await res.json();
      if (res.ok && data.adapters) {
        setAdapters(data.adapters);
      }
    } catch (err) {
      console.error("Error fetching adapters:", err);
      addNotification({ type: "error", message: "Failed to load custom adapters" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAdapters();
  }, []);

  const openCreateModal = () => {
    setEditingAdapter(null);
    setFormData({
      id: `custom-${Date.now().toString(36)}`,
      name: "",
      prefix: "",
      baseUrl: "https://api.example.com/v1",
      icon: "extension",
      color: "#10a37f",
      category: "custom",
      authType: "apikey",
      description: "",
      headers: { "Authorization": "Bearer {{apiKey}}" },
      models: [{ id: "default", name: "Default Model" }],
      passthroughModels: true,
      format: "custom",
      requestMapping: null,
      responseMapping: null,
      transformRequest: "",
      transformResponse: "",
      transformStreamChunk: "",
    });
    setHeaderEntries([{ key: "Authorization", value: "Bearer {{apiKey}}" }]);
    setActiveTab("general");
    setTestResult(null);
    setModalOpen(true);
  };

  const openEditModal = (adapter) => {
    setEditingAdapter(adapter);
    const headersObj = adapter.headers || {};
    const entries = Object.entries(headersObj).map(([key, value]) => ({ key, value }));
    setHeaderEntries(entries.length ? entries : [{ key: "", value: "" }]);

    setFormData({
      id: adapter.id,
      name: adapter.name || "",
      prefix: adapter.prefix || "",
      baseUrl: adapter.baseUrl || "",
      icon: adapter.icon || "extension",
      color: adapter.color || "#10a37f",
      category: adapter.category || "custom",
      authType: adapter.authType || "apikey",
      description: adapter.description || "",
      headers: headersObj,
      models: adapter.models || [{ id: "default", name: "Default Model" }],
      passthroughModels: adapter.passthroughModels !== false,
      format: adapter.format || "custom",
      requestMapping: adapter.requestMapping || null,
      responseMapping: adapter.responseMapping || null,
      transformRequest: adapter.transformRequest || "",
      transformResponse: adapter.transformResponse || "",
      transformStreamChunk: adapter.transformStreamChunk || "",
    });
    setActiveTab("general");
    setTestResult(null);
    setModalOpen(true);
  };

  const applyPreset = (preset) => {
    const config = preset.config;
    setFormData((prev) => ({
      ...prev,
      ...config,
    }));
    const headersObj = config.headers || {};
    const entries = Object.entries(headersObj).map(([key, value]) => ({ key, value }));
    setHeaderEntries(entries.length ? entries : [{ key: "", value: "" }]);
    addNotification({ type: "success", message: `Applied template: ${preset.label}` });
  };

  const handleSave = async () => {
    if (!formData.name.trim() || !formData.prefix.trim() || !formData.baseUrl.trim()) {
      addNotification({ type: "error", message: "Name, Prefix, and Base URL are required." });
      return;
    }

    // Build headers object from entries
    const finalHeaders = {};
    for (const entry of headerEntries) {
      if (entry.key.trim()) {
        finalHeaders[entry.key.trim()] = entry.value.trim();
      }
    }

    const payload = {
      ...formData,
      headers: finalHeaders,
    };

    try {
      if (editingAdapter) {
        const res = await fetch(`/api/custom-adapters/${editingAdapter.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (res.ok) {
          addNotification({ type: "success", message: "Custom adapter updated successfully" });
          setModalOpen(false);
          fetchAdapters();
        } else {
          const errData = await res.json();
          addNotification({ type: "error", message: errData.error || "Update failed" });
        }
      } else {
        const res = await fetch("/api/custom-adapters", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (res.ok) {
          addNotification({ type: "success", message: "Custom adapter created successfully" });
          setModalOpen(false);
          fetchAdapters();
        } else {
          const errData = await res.json();
          addNotification({ type: "error", message: errData.error || "Creation failed" });
        }
      }
    } catch (err) {
      console.error("Save error:", err);
      addNotification({ type: "error", message: "Failed to save custom adapter" });
    }
  };

  const handleDelete = async (adapter) => {
    if (!confirm(`Are you sure you want to delete adapter "${adapter.name}"?`)) return;
    try {
      const res = await fetch(`/api/custom-adapters/${adapter.id}`, { method: "DELETE" });
      if (res.ok) {
        addNotification({ type: "success", message: "Adapter deleted" });
        fetchAdapters();
      } else {
        const err = await res.json();
        addNotification({ type: "error", message: err.error || "Delete failed" });
      }
    } catch (err) {
      console.error("Delete error:", err);
      addNotification({ type: "error", message: "Failed to delete adapter" });
    }
  };

  const handleTest = async (live = false) => {
    setTestingInProgress(true);
    setTestingLive(live);
    try {
      const finalHeaders = {};
      for (const entry of headerEntries) {
        if (entry.key.trim()) {
          finalHeaders[entry.key.trim()] = entry.value.trim();
        }
      }

      const testAdapterPayload = {
        ...formData,
        headers: finalHeaders,
      };

      const res = await fetch("/api/custom-adapters/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          adapter: testAdapterPayload,
          model: testModel || formData.models?.[0]?.id || "default",
          prompt: testPrompt,
          apiKey: testApiKey,
          cookie: testCookie,
          live,
        }),
      });

      const data = await res.json();
      setTestResult(data);
      if (data.success) {
        addNotification({ type: "success", message: live ? "Live inference test succeeded" : "Transformation test verified" });
      } else {
        addNotification({ type: "error", message: data.error || "Test failed" });
      }
    } catch (err) {
      setTestResult({ error: err.message });
      addNotification({ type: "error", message: `Test error: ${err.message}` });
    } finally {
      setTestingInProgress(false);
    }
  };

  return (
    <div className="flex-1 space-y-6 p-6 max-w-7xl mx-auto">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-border-subtle pb-5">
        <div>
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-primary text-[28px]">extension</span>
            <h1 className="text-2xl font-bold tracking-tight text-text-main">Custom Provider Adapters</h1>
            <Badge variant="primary" size="sm">Plugin System</Badge>
          </div>
          <p className="text-sm text-text-muted mt-1">
            Connect unofficial web endpoints, internal gateways, and custom AI APIs declaratively or with JS transformers.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={fetchAdapters} icon="refresh">
            Refresh
          </Button>
          <Button variant="primary" onClick={openCreateModal} icon="add">
            New Custom Adapter
          </Button>
        </div>
      </div>

      {/* Directory Notice */}
      <div className="rounded-xl border border-brand-500/20 bg-brand-500/5 p-4 flex items-start gap-3">
        <span className="material-symbols-outlined text-brand-500 text-[22px] mt-0.5">folder_open</span>
        <div className="text-sm">
          <p className="font-semibold text-text-main">File-based Adapters Supported</p>
          <p className="text-text-muted text-xs mt-0.5">
            You can also place <code className="px-1 py-0.5 rounded bg-surface-2 font-mono text-[11px]">.json</code> or <code className="px-1 py-0.5 rounded bg-surface-2 font-mono text-[11px]">.js</code> files directly into the <code className="px-1 py-0.5 rounded bg-surface-2 font-mono text-[11px]">custom-providers/</code> directory. They will be auto-detected and hot-reloaded without server restart.
          </p>
        </div>
      </div>

      {/* Adapters Grid */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-48 rounded-xl bg-surface-2/40 animate-pulse" />
          ))}
        </div>
      ) : adapters.length === 0 ? (
        <Card className="p-12 text-center flex flex-col items-center justify-center">
          <div className="size-16 rounded-2xl bg-surface-2 flex items-center justify-center text-text-muted mb-4">
            <span className="material-symbols-outlined text-[32px]">extension_off</span>
          </div>
          <h3 className="text-lg font-semibold text-text-main">No Custom Adapters Found</h3>
          <p className="text-sm text-text-muted max-w-md mt-1 mb-6">
            Create your first custom provider adapter to connect external microservices, private models, or unofficial web APIs.
          </p>
          <Button variant="primary" onClick={openCreateModal} icon="add">
            Create First Adapter
          </Button>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {adapters.map((adapter) => (
            <Card key={adapter.id} className="p-5 flex flex-col justify-between hover:border-brand-500/40 transition-all">
              <div>
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="flex items-center gap-3">
                    <div
                      className="size-10 rounded-xl flex items-center justify-center text-white shadow-sm"
                      style={{ backgroundColor: adapter.color || "#10a37f" }}
                    >
                      <span className="material-symbols-outlined text-[22px]">{adapter.icon || "extension"}</span>
                    </div>
                    <div>
                      <h3 className="font-semibold text-text-main text-base">{adapter.name}</h3>
                      <span className="text-xs font-mono text-text-muted">prefix: {adapter.prefix}</span>
                    </div>
                  </div>
                  <Badge variant={adapter.source === "file" ? "secondary" : "primary"} size="sm">
                    {adapter.source === "file" ? "File" : "Dashboard"}
                  </Badge>
                </div>

                <p className="text-xs text-text-muted line-clamp-2 mb-3">
                  {adapter.description || `Base URL: ${adapter.baseUrl}`}
                </p>

                <div className="space-y-1.5 py-2 border-t border-border-subtle text-xs">
                  <div className="flex items-center justify-between text-text-muted">
                    <span>Endpoint:</span>
                    <span className="font-mono text-text-main truncate max-w-[180px]">{adapter.baseUrl}</span>
                  </div>
                  <div className="flex items-center justify-between text-text-muted">
                    <span>Auth Type:</span>
                    <span className="font-medium text-text-main capitalize">{adapter.authType || "apikey"}</span>
                  </div>
                  <div className="flex items-center justify-between text-text-muted">
                    <span>Models:</span>
                    <span className="font-medium text-text-main">{adapter.models?.length || 1} declared</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-4 border-t border-border-subtle mt-4">
                <Button
                  size="sm"
                  variant="secondary"
                  icon="play_arrow"
                  onClick={() => {
                    openEditModal(adapter);
                    setActiveTab("test");
                  }}
                >
                  Test
                </Button>
                {adapter.source !== "file" && (
                  <>
                    <Button size="sm" variant="ghost" icon="edit" onClick={() => openEditModal(adapter)}>
                      Edit
                    </Button>
                    <Button size="sm" variant="ghost" className="text-red-500 hover:text-red-600" icon="delete" onClick={() => handleDelete(adapter)}>
                      Delete
                    </Button>
                  </>
                )}
                {adapter.source === "file" && (
                  <Button size="sm" variant="ghost" icon="visibility" onClick={() => openEditModal(adapter)}>
                    View
                  </Button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Editor & Testing Modal */}
      <Modal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingAdapter ? `Edit Custom Adapter (${editingAdapter.name})` : "New Custom Adapter"}
        size="lg"
      >
        <div className="flex flex-col gap-5 max-h-[75vh] overflow-y-auto pr-1">
          {/* Preset Selector */}
          {!editingAdapter && (
            <div className="bg-surface-2/60 p-3 rounded-xl border border-border-subtle flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-text-main">Quick Templates:</span>
              {TEMPLATE_PRESETS.map((preset, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => applyPreset(preset)}
                  className="px-2.5 py-1 text-xs rounded-lg bg-surface-1 hover:bg-brand-500/10 hover:text-brand-500 text-text-muted border border-border-subtle transition-all cursor-pointer"
                >
                  {preset.label}
                </button>
              ))}
            </div>
          )}

          {/* Navigation Tabs */}
          <div className="flex border-b border-border-subtle gap-4 text-sm font-medium">
            <button
              onClick={() => setActiveTab("general")}
              className={`pb-2 border-b-2 transition-all cursor-pointer ${
                activeTab === "general"
                  ? "border-primary text-primary"
                  : "border-transparent text-text-muted hover:text-text-main"
              }`}
            >
              General Info
            </button>
            <button
              onClick={() => setActiveTab("headers")}
              className={`pb-2 border-b-2 transition-all cursor-pointer ${
                activeTab === "headers"
                  ? "border-primary text-primary"
                  : "border-transparent text-text-muted hover:text-text-main"
              }`}
            >
              Auth & Headers
            </button>
            <button
              onClick={() => setActiveTab("models")}
              className={`pb-2 border-b-2 transition-all cursor-pointer ${
                activeTab === "models"
                  ? "border-primary text-primary"
                  : "border-transparent text-text-muted hover:text-text-main"
              }`}
            >
              Models
            </button>
            <button
              onClick={() => setActiveTab("transformers")}
              className={`pb-2 border-b-2 transition-all cursor-pointer ${
                activeTab === "transformers"
                  ? "border-primary text-primary"
                  : "border-transparent text-text-muted hover:text-text-main"
              }`}
            >
              Transformers (JS / Mapping)
            </button>
            <button
              onClick={() => setActiveTab("test")}
              className={`pb-2 border-b-2 transition-all cursor-pointer flex items-center gap-1 ${
                activeTab === "test"
                  ? "border-primary text-primary"
                  : "border-transparent text-text-muted hover:text-text-main"
              }`}
            >
              <span className="material-symbols-outlined text-[16px]">play_circle</span>
              Playground & Test
            </button>
          </div>

          {/* Tab 1: General */}
          {activeTab === "general" && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Input
                  label="Display Name"
                  required
                  placeholder="e.g. My Private Gateway"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  hint="Provider label shown in dashboard and model lists."
                />
                <Input
                  label="Prefix (Model Identifier)"
                  required
                  placeholder="e.g. private-gw"
                  value={formData.prefix}
                  onChange={(e) => setFormData({ ...formData, prefix: e.target.value.toLowerCase().replace(/[^a-z0-9-_]/g, "") })}
                  hint="Used in requests as prefix/model (e.g. private-gw/gpt-4o)."
                />
              </div>

              <Input
                label="Target Base URL"
                required
                placeholder="https://api.my-endpoint.com/v1"
                value={formData.baseUrl}
                onChange={(e) => setFormData({ ...formData, baseUrl: e.target.value })}
                hint="Target server endpoint. Supports {{model}} variable."
              />

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <Select
                  label="Category"
                  options={CATEGORY_OPTIONS}
                  value={formData.category}
                  onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                />
                <Input
                  label="Icon (Material Symbol)"
                  placeholder="extension"
                  value={formData.icon}
                  onChange={(e) => setFormData({ ...formData, icon: e.target.value })}
                />
                <Input
                  label="Color Theme (Hex)"
                  type="text"
                  placeholder="#10a37f"
                  value={formData.color}
                  onChange={(e) => setFormData({ ...formData, color: e.target.value })}
                />
              </div>

              <Input
                label="Description (Optional)"
                placeholder="Brief description of this custom endpoint"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              />
            </div>
          )}

          {/* Tab 2: Auth & Headers */}
          {activeTab === "headers" && (
            <div className="space-y-4">
              <Select
                label="Authentication Mode"
                options={AUTH_TYPE_OPTIONS}
                value={formData.authType}
                onChange={(e) => setFormData({ ...formData, authType: e.target.value })}
              />

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium text-text-main">Custom HTTP Headers</label>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon="add"
                    onClick={() => setHeaderEntries([...headerEntries, { key: "", value: "" }])}
                  >
                    Add Header
                  </Button>
                </div>
                <p className="text-xs text-text-muted">
                  Supports template variables like <code className="font-mono text-brand-500">{"{{apiKey}}"}</code>, <code className="font-mono text-brand-500">{"{{cookie}}"}</code>, and <code className="font-mono text-brand-500">{"{{env.VAR_NAME}}"}</code>.
                </p>

                <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                  {headerEntries.map((entry, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <input
                        type="text"
                        placeholder="Header-Name (e.g. Authorization)"
                        value={entry.key}
                        onChange={(e) => {
                          const updated = [...headerEntries];
                          updated[idx].key = e.target.value;
                          setHeaderEntries(updated);
                        }}
                        className="flex-1 py-2 px-3 text-xs bg-surface-2 rounded-lg border border-transparent focus:border-brand-500/40 text-text-main"
                      />
                      <input
                        type="text"
                        placeholder="Value (e.g. Bearer {{apiKey}})"
                        value={entry.value}
                        onChange={(e) => {
                          const updated = [...headerEntries];
                          updated[idx].value = e.target.value;
                          setHeaderEntries(updated);
                        }}
                        className="flex-1 py-2 px-3 text-xs bg-surface-2 rounded-lg border border-transparent focus:border-brand-500/40 text-text-main"
                      />
                      <button
                        type="button"
                        onClick={() => setHeaderEntries(headerEntries.filter((_, i) => i !== idx))}
                        className="p-1.5 text-text-muted hover:text-red-500 rounded-lg hover:bg-surface-2"
                      >
                        <span className="material-symbols-outlined text-[18px]">close</span>
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Tab 3: Models */}
          {activeTab === "models" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-text-main">Supported Models</label>
                <Button
                  size="sm"
                  variant="ghost"
                  icon="add"
                  onClick={() => setFormData({ ...formData, models: [...formData.models, { id: "", name: "" }] })}
                >
                  Add Model
                </Button>
              </div>

              <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                {formData.models.map((model, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <input
                      type="text"
                      placeholder="Model ID (e.g. gpt-4o, claude-3-5-sonnet)"
                      value={model.id}
                      onChange={(e) => {
                        const updated = [...formData.models];
                        updated[idx].id = e.target.value;
                        if (!updated[idx].name) updated[idx].name = e.target.value;
                        setFormData({ ...formData, models: updated });
                      }}
                      className="flex-1 py-2 px-3 text-xs bg-surface-2 rounded-lg border border-transparent focus:border-brand-500/40 text-text-main"
                    />
                    <input
                      type="text"
                      placeholder="Display Name"
                      value={model.name}
                      onChange={(e) => {
                        const updated = [...formData.models];
                        updated[idx].name = e.target.value;
                        setFormData({ ...formData, models: updated });
                      }}
                      className="flex-1 py-2 px-3 text-xs bg-surface-2 rounded-lg border border-transparent focus:border-brand-500/40 text-text-main"
                    />
                    <button
                      type="button"
                      onClick={() => setFormData({ ...formData, models: formData.models.filter((_, i) => i !== idx) })}
                      className="p-1.5 text-text-muted hover:text-red-500 rounded-lg hover:bg-surface-2"
                    >
                      <span className="material-symbols-outlined text-[18px]">close</span>
                    </button>
                  </div>
                ))}
              </div>

              <div className="pt-2">
                <Toggle
                  label="Allow Passthrough Model IDs"
                  checked={formData.passthroughModels}
                  onChange={(val) => setFormData({ ...formData, passthroughModels: val })}
                  hint="Allow any model ID sent by the client without strict catalog validation."
                />
              </div>
            </div>
          )}

          {/* Tab 4: Transformers */}
          {activeTab === "transformers" && (
            <div className="space-y-4 text-xs">
              <div className="bg-surface-2/40 p-3 rounded-lg border border-border-subtle text-text-muted">
                <span className="font-semibold text-text-main">Scripted Transformers (JS/TS):</span> Write custom logic to transform the request body, parse raw non-streaming responses, and translate streaming SSE chunks. Leave empty to use standard OpenAI pass-through.
              </div>

              <div className="space-y-1.5">
                <label className="font-semibold text-text-main">1. Request Transformer (transformRequest)</label>
                <p className="text-text-muted">Function: <code className="font-mono text-brand-500">(context) =&gt; ({`{ url?, headers?, body }`})</code></p>
                <textarea
                  rows={5}
                  value={formData.transformRequest}
                  onChange={(e) => setFormData({ ...formData, transformRequest: e.target.value })}
                  placeholder="(context) => { return { body: { prompt: context.body.messages[0].content } }; }"
                  className="w-full p-3 font-mono text-xs bg-neutral-950 text-neutral-100 rounded-lg border border-border-subtle focus:border-brand-500/50 outline-none"
                />
              </div>

              <div className="space-y-1.5">
                <label className="font-semibold text-text-main">2. Response Transformer (transformResponse)</label>
                <p className="text-text-muted">Function: <code className="font-mono text-brand-500">(rawJson, state, context) =&gt; OpenAICompletionResponse</code></p>
                <textarea
                  rows={5}
                  value={formData.transformResponse}
                  onChange={(e) => setFormData({ ...formData, transformResponse: e.target.value })}
                  placeholder="(rawJson, state, context) => { return { choices: [{ message: { role: 'assistant', content: rawJson.output } }] }; }"
                  className="w-full p-3 font-mono text-xs bg-neutral-950 text-neutral-100 rounded-lg border border-border-subtle focus:border-brand-500/50 outline-none"
                />
              </div>

              <div className="space-y-1.5">
                <label className="font-semibold text-text-main">3. Stream Chunk Transformer (transformStreamChunk)</label>
                <p className="text-text-muted">Function: <code className="font-mono text-brand-500">(rawLineOrChunk, state, context) =&gt; OpenAICompletionChunk | null</code></p>
                <textarea
                  rows={5}
                  value={formData.transformStreamChunk}
                  onChange={(e) => setFormData({ ...formData, transformStreamChunk: e.target.value })}
                  placeholder="(chunk, state, context) => { ... }"
                  className="w-full p-3 font-mono text-xs bg-neutral-950 text-neutral-100 rounded-lg border border-border-subtle focus:border-brand-500/50 outline-none"
                />
              </div>
            </div>
          )}

          {/* Tab 5: Test Playground */}
          {activeTab === "test" && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Input
                  label="API Key / Token (for testing)"
                  type="password"
                  placeholder="Enter test API key..."
                  value={testApiKey}
                  onChange={(e) => setTestApiKey(e.target.value)}
                />
                <Input
                  label="Cookie / Session (for testing)"
                  placeholder="Optional cookie string..."
                  value={testCookie}
                  onChange={(e) => setTestCookie(e.target.value)}
                />
              </div>

              <Input
                label="Test Prompt"
                value={testPrompt}
                onChange={(e) => setTestPrompt(e.target.value)}
                placeholder="What is the speed of light?"
              />

              <div className="flex items-center gap-3">
                <Button
                  variant="secondary"
                  onClick={() => handleTest(false)}
                  disabled={testingInProgress}
                  icon="build"
                >
                  Verify Transformation (Local)
                </Button>
                <Button
                  variant="primary"
                  onClick={() => handleTest(true)}
                  disabled={testingInProgress}
                  icon="send"
                >
                  {testingInProgress ? "Sending..." : "Live Request Test"}
                </Button>
              </div>

              {testResult && (
                <div className="space-y-3 pt-3 border-t border-border-subtle text-xs">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-text-main">Test Status:</span>
                    {testResult.success ? (
                      <Badge variant="success" size="sm">Success {testResult.durationMs ? `(${testResult.durationMs}ms)` : ""}</Badge>
                    ) : (
                      <Badge variant="error" size="sm">Failed</Badge>
                    )}
                  </div>

                  {testResult.transformedRequest && (
                    <div>
                      <span className="font-semibold text-text-muted block mb-1">Outbound Request Payload:</span>
                      <pre className="p-3 rounded-lg bg-neutral-950 text-green-400 font-mono text-[11px] overflow-x-auto max-h-40">
                        {JSON.stringify(testResult.transformedRequest, null, 2)}
                      </pre>
                    </div>
                  )}

                  {testResult.rawResponse && (
                    <div>
                      <span className="font-semibold text-text-muted block mb-1">Raw Upstream Response:</span>
                      <pre className="p-3 rounded-lg bg-neutral-950 text-amber-400 font-mono text-[11px] overflow-x-auto max-h-40">
                        {JSON.stringify(testResult.rawResponse, null, 2)}
                      </pre>
                    </div>
                  )}

                  {testResult.transformedResponse && (
                    <div>
                      <span className="font-semibold text-text-muted block mb-1">Final Transformed Output (OpenAI Format):</span>
                      <pre className="p-3 rounded-lg bg-neutral-950 text-sky-400 font-mono text-[11px] overflow-x-auto max-h-40">
                        {JSON.stringify(testResult.transformedResponse, null, 2)}
                      </pre>
                    </div>
                  )}

                  {testResult.error && (
                    <div className="p-3 rounded-lg bg-red-500/10 text-red-500 text-xs">
                      {testResult.error}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Modal Actions */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-border-subtle">
            <Button variant="ghost" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            {editingAdapter?.source !== "file" && (
              <Button variant="primary" onClick={handleSave}>
                {editingAdapter ? "Save Changes" : "Create Adapter"}
              </Button>
            )}
          </div>
        </div>
      </Modal>
    </div>
  );
}
