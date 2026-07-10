"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Badge, Button } from "@/shared/components";

const STORAGE_KEYS = {
  sessions: "basic-chat.sessions",
  activeSessionId: "basic-chat.activeSessionId",
  selectedProvider: "basic-chat.selectedProvider",
  selectedModelId: "basic-chat.selectedModelId",
  selectedApiKey: "basic-chat.selectedApiKey",
  draft: "basic-chat.draft",
};

function createId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `chat_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function safeParse(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function textValue(value) {
  if (typeof value === "string") return value;
  if (value == null) return "";
  if (Array.isArray(value)) return value.map(textValue).filter(Boolean).join(" ");
  if (typeof value === "object") {
    if (typeof value.message === "string") return value.message;
    if (typeof value.error === "string") return value.error;
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function humanize(value = "") {
  return String(value)
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .trim() || "Unknown";
}

function formatRelativeTime(value) {
  if (!value) return "Now";
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return "Now";
  const diffMinutes = Math.max(1, Math.round((Date.now() - time) / 60000));
  if (diffMinutes < 60) return `${diffMinutes}m`;
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h`;
  return `${Math.round(diffHours / 24)}d`;
}

function makeSessionTitle(text = "") {
  const normalized = textValue(text).replace(/\s+/g, " ").trim();
  if (!normalized) return "New chat";
  return normalized.length > 52 ? `${normalized.slice(0, 52).trimEnd()}…` : normalized;
}

function buildUserContent(message) {
  const text = textValue(message.content).trim();
  const attachments = Array.isArray(message.attachments) ? message.attachments : [];

  if (attachments.length === 0) return text;

  const content = [];
  if (text) content.push({ type: "text", text });

  for (const attachment of attachments) {
    if (attachment?.dataUrl) {
      content.push({ type: "image_url", image_url: { url: attachment.dataUrl } });
    }
  }

  return content.length > 0 ? content : text;
}

function readAssistantText(chunk) {
  if (!chunk || typeof chunk !== "object") return "";
  const choice = chunk.choices?.[0];
  const delta = choice?.delta || {};
  const pieces = [delta.content, choice?.message?.content, chunk.output_text, chunk.text]
    .map(textValue)
    .filter(Boolean);
  return pieces[0] || "";
}

async function fileToDataUrl(file) {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

function cloneSession(session) {
  return {
    ...session,
    messages: Array.isArray(session.messages) ? session.messages.map((message) => ({ ...message })) : [],
  };
}

export default function BasicChatPageClient() {
  // ---- Model & Provider State ----
  const [providerGroups, setProviderGroups] = useState([]);
  const [allModels, setAllModels] = useState([]);
  const [loadingData, setLoadingData] = useState(true);
  const [loadError, setLoadError] = useState("");

  // ---- API Key State ----
  const [apiKeys, setApiKeys] = useState([]);
  const [selectedApiKey, setSelectedApiKey] = useState(() => {
    if (typeof window === "undefined") return "";
    return globalThis.localStorage.getItem(STORAGE_KEYS.selectedApiKey) || "";
  });

  // ---- Selection State ----
  const [selectedProvider, setSelectedProvider] = useState(() => {
    if (typeof window === "undefined") return "";
    return globalThis.localStorage.getItem(STORAGE_KEYS.selectedProvider) || "";
  });
  const [selectedModelId, setSelectedModelId] = useState(() => {
    if (typeof window === "undefined") return "";
    return globalThis.localStorage.getItem(STORAGE_KEYS.selectedModelId) || "";
  });

  // ---- Chat State ----
  const [sessions, setSessions] = useState(() => {
    if (typeof window === "undefined") return [];
    try {
      const saved = safeParse(globalThis.localStorage.getItem(STORAGE_KEYS.sessions), []);
      return Array.isArray(saved) ? saved.map((session) => ({
        ...session,
        messages: Array.isArray(session.messages) ? session.messages : [],
      })) : [];
    } catch { return []; }
  });
  const [activeSessionId, setActiveSessionId] = useState(() => {
    if (typeof window === "undefined") return "";
    return globalThis.localStorage.getItem(STORAGE_KEYS.activeSessionId) || "";
  });
  const [draft, setDraft] = useState(() => {
    if (typeof window === "undefined") return "";
    return globalThis.localStorage.getItem(STORAGE_KEYS.draft) || "";
  });
  const [attachments, setAttachments] = useState([]);
  const [isSending, setIsSending] = useState(false);
  const [streamingMessageId, setStreamingMessageId] = useState("");
  const [streamingText, setStreamingText] = useState("");
  const [isHydrated, setIsHydrated] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const fileInputRef = useRef(null);
  const abortRef = useRef(null);
  const initializedRef = useRef(false);
  const modelMenuRef = useRef(null);
  const historyMenuRef = useRef(null);

  useEffect(() => {
    setIsHydrated(true);
  }, []);

  // ---- Load Models & API Keys ----
  useEffect(() => {
    let cancelled = false;

    async function loadData() {
      setLoadingData(true);
      setLoadError("");

      try {
        // Load models from dashboard API (JWT protected, internally calls buildModelsList)
        const modelsRes = await fetch("/api/dashboard/models", { cache: "no-store" });
        const modelsData = await modelsRes.json().catch(() => ({}));
        const models = Array.isArray(modelsData.data) ? modelsData.data : [];

        if (models.length === 0) {
          if (!cancelled) {
            setProviderGroups([]);
            setLoadError("No models available. Connect a provider first.");
          }
          return;
        }

        // Group models by owned_by (provider alias)
        const groupMap = new Map();
        for (const model of models) {
          if (!model?.id) continue;
          const provider = model.owned_by || model.id.split("/")[0] || "unknown";
          if (!groupMap.has(provider)) {
            groupMap.set(provider, {
              providerId: provider,
              providerName: humanize(provider),
              models: [],
            });
          }
          groupMap.get(provider).models.push({
            id: model.id,
            name: model.id.split("/").pop() || model.id,
            fullId: model.id,
          });
        }

        const groups = Array.from(groupMap.values())
          .map((g) => ({
            ...g,
            models: g.models.sort((a, b) => a.name.localeCompare(b.name)),
          }))
          .sort((a, b) => a.providerName.localeCompare(b.providerName));

        // Load API keys
        let keys = [];
        try {
          const keysRes = await fetch("/api/keys", { cache: "no-store" });
          const keysData = await keysRes.json().catch(() => ({}));
          keys = Array.isArray(keysData.keys) ? keysData.keys : [];
        } catch {
          // Ignore API key fetch errors
        }

        if (!cancelled) {
          setProviderGroups(groups);
          setAllModels(models);
          setApiKeys(keys);

          // Restore or default selections
          const savedProvider = groups.find((g) => g.providerId === selectedProvider);
          const defaultProvider = savedProvider || groups[0];
          const defaultModel = defaultProvider.models.find((m) => m.id === selectedModelId)
            || defaultProvider.models[0];

          if (!selectedProvider && defaultProvider) {
            setSelectedProvider(defaultProvider.providerId);
          }
          if (!selectedModelId && defaultModel) {
            setSelectedModelId(defaultModel.id);
          }
          if (!selectedApiKey && keys.length > 0) {
            setSelectedApiKey(keys[0].key);
          }
        }
      } catch (error) {
        if (!cancelled) {
          setLoadError(textValue(error?.message) || "Failed to load models.");
          setProviderGroups([]);
        }
      } finally {
        if (!cancelled) setLoadingData(false);
      }
    }

    loadData();
    return () => { cancelled = true; };
  }, []);

  // ---- Click outside handlers ----
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (modelMenuRef.current && !modelMenuRef.current.contains(event.target)) {
        setModelMenuOpen(false);
      }
      if (historyMenuRef.current && !historyMenuRef.current.contains(event.target)) {
        setHistoryOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // ---- Persist to localStorage ----
  useEffect(() => {
    if (!isHydrated) return;
    try {
      globalThis.localStorage.setItem(STORAGE_KEYS.sessions, JSON.stringify(sessions));
      globalThis.localStorage.setItem(STORAGE_KEYS.activeSessionId, activeSessionId);
      globalThis.localStorage.setItem(STORAGE_KEYS.selectedProvider, selectedProvider);
      globalThis.localStorage.setItem(STORAGE_KEYS.selectedModelId, selectedModelId);
      globalThis.localStorage.setItem(STORAGE_KEYS.selectedApiKey, selectedApiKey);
      globalThis.localStorage.setItem(STORAGE_KEYS.draft, draft);
    } catch {
      // Ignore storage errors
    }
  }, [isHydrated, sessions, activeSessionId, selectedProvider, selectedModelId, selectedApiKey, draft]);

  // ---- Computed ----
  const currentProvider = useMemo(() => {
    return providerGroups.find((g) => g.providerId === selectedProvider) || providerGroups[0] || null;
  }, [providerGroups, selectedProvider]);

  const currentModel = useMemo(() => {
    if (!currentProvider) return null;
    return currentProvider.models.find((m) => m.id === selectedModelId) || currentProvider.models[0] || null;
  }, [currentProvider, selectedModelId]);

  const currentSession = useMemo(() => sessions.find((s) => s.id === activeSessionId) || null, [sessions, activeSessionId]);
  const currentMessages = currentSession?.messages || [];
  const sessionItems = useMemo(() => [...sessions].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()), [sessions]);
  const canSend = !isSending && !!currentModel && !!selectedApiKey && (draft.trim().length > 0 || attachments.length > 0);

  // ---- Initialize session ----
  useEffect(() => {
    if (!isHydrated || loadingData || initializedRef.current) return;
    if (!currentModel) return;

    initializedRef.current = true;

    if (sessions.length === 0) {
      const session = {
        id: createId(),
        title: "New chat",
        modelId: currentModel.id,
        modelName: currentModel.name,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        messages: [],
      };
      setSessions([session]);
      setActiveSessionId(session.id);
    }
  }, [isHydrated, loadingData, currentModel, sessions]);

  // ---- Session helpers ----
  const updateSession = (sessionId, updater) => {
    setSessions((prev) => prev.map((session) => (session.id === sessionId ? updater(cloneSession(session)) : session)));
  };

  const ensureSessionForModel = (model) => {
    if (!model) return null;
    return {
      id: createId(),
      title: "New chat",
      modelId: model.id,
      modelName: model.name,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messages: [],
    };
  };

  const handleNewChat = () => {
    if (!currentModel) return;
    const session = ensureSessionForModel(currentModel);
    if (!session) return;
    setSessions((prev) => [session, ...prev]);
    setActiveSessionId(session.id);
    setDraft("");
    setAttachments([]);
    setStreamingMessageId("");
    setStreamingText("");
  };

  const handleSelectSession = (sessionId) => {
    const session = sessions.find((item) => item.id === sessionId);
    if (!session) return;
    setActiveSessionId(sessionId);
    setHistoryOpen(false);
  };

  const handleDeleteCurrentChat = () => {
    if (!activeSessionId) return;
    const nextSessions = sessions.filter((session) => session.id !== activeSessionId);
    const fallback = nextSessions[0] || null;
    setSessions(nextSessions);
    if (fallback) {
      setActiveSessionId(fallback.id);
    } else {
      setActiveSessionId("");
      const newSession = currentModel ? ensureSessionForModel(currentModel) : null;
      if (newSession) {
        setSessions([newSession]);
        setActiveSessionId(newSession.id);
      }
    }
  };

  const handleDeleteSession = (sessionId, event) => {
    event.stopPropagation(); // Prevent selection
    const nextSessions = sessions.filter((s) => s.id !== sessionId);
    setSessions(nextSessions);
    if (sessionId === activeSessionId) {
      const fallback = nextSessions[0] || null;
      if (fallback) {
        setActiveSessionId(fallback.id);
      } else {
        setActiveSessionId("");
        const newSession = currentModel ? ensureSessionForModel(currentModel) : null;
        if (newSession) {
          setSessions([newSession]);
          setActiveSessionId(newSession.id);
        }
      }
    }
  };

  // ---- Provider & Model Selection ----
  const handleSelectProvider = (providerId) => {
    const group = providerGroups.find((g) => g.providerId === providerId);
    if (!group || group.models.length === 0) return;

    setSelectedProvider(providerId);
    setSelectedModelId(group.models[0].id);

    // Create new session for new provider
    const session = ensureSessionForModel(group.models[0]);
    if (session) {
      setSessions((prev) => [session, ...prev]);
      setActiveSessionId(session.id);
    }
    setModelMenuOpen(false);
  };

  const handleSelectModel = (modelId) => {
    const model = currentProvider?.models.find((m) => m.id === modelId);
    if (!model) return;

    setSelectedModelId(modelId);

    const current = sessions.find((s) => s.id === activeSessionId);
    if (current && current.messages.length > 0) {
      const session = ensureSessionForModel(model);
      if (session) {
        setSessions((prev) => [session, ...prev]);
        setActiveSessionId(session.id);
      }
    } else if (current) {
      setSessions((prev) => prev.map((s) => (s.id === current.id ? { ...s, modelId: model.id, modelName: model.name } : s)));
    }
    setModelMenuOpen(false);
  };

  // ---- Attachments ----
  const handleAttachFiles = async (event) => {
    const files = Array.from(event.target.files || []);
    if (files.length === 0) return;
    const images = files.filter((file) => file.type.startsWith("image/"));
    if (images.length === 0) {
      event.target.value = "";
      return;
    }
    const converted = await Promise.all(images.map(async (file) => ({
      id: createId(),
      name: file.name,
      type: file.type,
      size: file.size,
      dataUrl: await fileToDataUrl(file),
    })));
    setAttachments((prev) => [...prev, ...converted]);
    event.target.value = "";
  };

  const removeAttachment = (attachmentId) => {
    setAttachments((prev) => prev.filter((a) => a.id !== attachmentId));
  };

  const handleStop = () => {
    abortRef.current?.abort();
  };

  // ---- Send Message ----
  const sendMessage = async () => {
    const model = currentModel;
    if (!model) return;
    if (!selectedApiKey) {
      setLoadError("Please select an API key");
      return;
    }

    const userText = draft.trim();
    if (!userText && attachments.length === 0) return;

    let sessionId = activeSessionId;
    let session = sessions.find((s) => s.id === sessionId);
    if (!session) {
      session = ensureSessionForModel(model);
      if (!session) return;
      sessionId = session.id;
      setSessions((prev) => [session, ...prev]);
      setActiveSessionId(sessionId);
    }

    const userMessage = {
      id: createId(),
      role: "user",
      content: userText,
      attachments: attachments.map((a) => ({ id: a.id, name: a.name, type: a.type, dataUrl: a.dataUrl })),
      createdAt: new Date().toISOString(),
    };

    const assistantMessageId = createId();
    const assistantMessage = {
      id: assistantMessageId,
      role: "assistant",
      content: "",
      createdAt: new Date().toISOString(),
      status: "streaming",
    };

    const nextMessages = [...(session.messages || []), userMessage, assistantMessage];
    setSessions((prev) => prev.map((s) => (s.id === sessionId ? {
      ...s,
      modelId: model.id,
      modelName: model.name,
      messages: nextMessages,
      updatedAt: new Date().toISOString(),
      title: s.title === "New chat" ? makeSessionTitle(userText) : s.title,
    } : s)));
    setDraft("");
    setAttachments([]);
    setIsSending(true);
    setStreamingMessageId(assistantMessageId);
    setStreamingText("");
    abortRef.current?.abort();
    abortRef.current = new AbortController();

    const requestMessages = nextMessages
      .filter((m) => !(m.role === "assistant" && m.id === assistantMessageId))
      .map((m) => ({
        role: m.role,
        content: m.role === "user" ? buildUserContent(m) : m.content,
      }));

    try {
      const response = await fetch("/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
          Authorization: `Bearer ${selectedApiKey}`,
        },
        body: JSON.stringify({
          model: model.id,
          messages: requestMessages,
          stream: true,
        }),
        signal: abortRef.current.signal,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(textValue(errorData.error || errorData.message || `Request failed (${response.status})`));
      }

      const reader = response.body?.getReader();
      if (!reader) {
        const data = await response.json().catch(() => ({}));
        const fallbackText = textValue(data?.choices?.[0]?.message?.content || data?.output_text || data?.error || data?.message || "");
        updateSession(sessionId, (s) => ({
          ...s,
          messages: s.messages.map((m) => (m.id === assistantMessageId ? { ...m, content: fallbackText, status: "done" } : m)),
          updatedAt: new Date().toISOString(),
        }));
        return;
      }

      const decoder = new TextDecoder();
      let buffer = "";
      let assistantText = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;

          const payload = trimmed.slice(5).trim();
          if (!payload || payload === "[DONE]") continue;

          try {
            const chunk = JSON.parse(payload);
            const text = readAssistantText(chunk);
            if (!text) continue;

            assistantText += text;
            setStreamingText(assistantText);
            updateSession(sessionId, (s) => ({
              ...s,
              messages: s.messages.map((m) => (m.id === assistantMessageId ? { ...m, content: assistantText, status: "streaming" } : m)),
              updatedAt: new Date().toISOString(),
            }));
          } catch {
            // Ignore malformed chunks
          }
        }
      }

      updateSession(sessionId, (s) => ({
        ...s,
        messages: s.messages.map((m) => (m.id === assistantMessageId ? { ...m, content: assistantText || m.content, status: "done" } : m)),
        updatedAt: new Date().toISOString(),
      }));
    } catch (error) {
      if (error.name !== "AbortError") {
        const errorText = textValue(error?.message || error);
        updateSession(sessionId, (s) => ({
          ...s,
          messages: s.messages.map((m) => (m.id === assistantMessageId ? { ...m, content: m.content || `Error: ${errorText}`, status: "error" } : m)),
          updatedAt: new Date().toISOString(),
        }));
        setLoadError(errorText || "Failed to send message.");
      }
    } finally {
      setIsSending(false);
      setStreamingMessageId("");
      setStreamingText("");
      abortRef.current = null;
    }
  };

  const handleKeyDown = (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (canSend) sendMessage();
    }
  };

  const modelLabel = currentModel ? currentModel.name : "Select model";
  const modelSubLabel = currentModel ? currentModel.id : "";

  return (
    <div className="relative flex-1 flex flex-col h-full min-h-0 min-w-0 bg-surface-1 text-text-main overflow-hidden">
      <div className="relative mx-auto flex flex-1 h-full min-h-0 w-full max-w-4xl flex-col">
        {/* Header: Provider + Model + API Key selectors */}
        <div className="flex shrink-0 items-center justify-between gap-3 px-4 py-3 lg:px-6">
          <div ref={modelMenuRef} className="relative flex items-center gap-3">
            {/* Provider selector */}
            <div className="flex flex-col gap-1">
              <span className="text-xs text-text-muted">Provider</span>
              {currentProvider ? (
                <select
                  value={selectedProvider}
                  onChange={(e) => handleSelectProvider(e.target.value)}
                  className="rounded-xl border border-border-subtle bg-surface-2 px-3 py-2 text-sm text-text-main outline-none cursor-pointer hover:bg-surface-3"
                >
                  {providerGroups.map((group) => (
                    <option key={group.providerId} value={group.providerId} className="bg-surface-2 text-text-main">
                      {group.providerName} ({group.models.length})
                    </option>
                  ))}
                </select>
              ) : (
                <span className="text-sm text-text-muted">Loading...</span>
              )}
            </div>

            {/* Model selector */}
            <div className="flex flex-col gap-1">
              <span className="text-xs text-text-muted">Model</span>
              {currentProvider ? (
                <select
                  value={selectedModelId}
                  onChange={(e) => handleSelectModel(e.target.value)}
                  className="rounded-xl border border-border-subtle bg-surface-2 px-3 py-2 text-sm text-text-main outline-none cursor-pointer hover:bg-surface-3 min-w-[140px]"
                >
                  {currentProvider.models.map((model) => (
                    <option key={model.id} value={model.id} className="bg-surface-2 text-text-main">
                      {model.name}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="text-sm text-text-muted">-</span>
              )}
            </div>

            {/* API Key selector */}
            <div className="flex flex-col gap-1">
              <span className="text-xs text-text-muted">API Key</span>
              {apiKeys.length > 0 ? (
                <select
                  value={selectedApiKey}
                  onChange={(e) => setSelectedApiKey(e.target.value)}
                  className="rounded-xl border border-border-subtle bg-surface-2 px-3 py-2 text-sm text-text-main outline-none cursor-pointer hover:bg-surface-3 min-w-[100px]"
                >
                  {apiKeys.map((key) => (
                    <option key={key.id} value={key.key} className="bg-surface-2 text-text-main">
                      {key.name || `sk-...${key.key.slice(-4)}`}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="text-sm text-amber-400">Create a key first</span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setHistoryOpen((v) => !v)}
              className="rounded-2xl border border-border-subtle bg-surface-2 px-4 py-3 text-sm text-text-secondary transition hover:bg-surface-3"
            >
              History
            </button>
            <Button variant="ghost" size="sm" icon="delete" onClick={handleDeleteCurrentChat} disabled={!activeSessionId || sessions.length === 0}>
              Clear
            </Button>
          </div>
        </div>

        {/* History panel */}
        {historyOpen ? (
          <div ref={historyMenuRef} className="absolute right-4 top-[72px] z-20 w-[min(360px,calc(100vw-2rem))] rounded-[20px] border border-border-subtle bg-surface-2 p-2 shadow-2xl shadow-black/50 lg:right-6">
            <div className="px-3 py-2">
              <p className="text-xs uppercase tracking-[0.22em] text-text-muted">Recent chats</p>
            </div>
            <div className="max-h-[48vh] space-y-2 overflow-y-auto p-1 custom-scrollbar">
              {sessionItems.length === 0 ? (
                <div className="rounded-[16px] border border-dashed border-border-subtle bg-surface-2 p-4 text-sm text-text-muted">
                  No conversations yet.
                </div>
              ) : sessionItems.map((session) => {
                const isActive = session.id === activeSessionId;
                const latestMessage = [...(session.messages || [])].reverse().find((m) => m.role === "user") || session.messages?.[0];
                return (
                  <div
                    key={session.id}
                    className={`w-full rounded-[16px] border px-3 py-3 transition ${isActive ? "border-blue-400/40 bg-blue-500/15" : "border-border-subtle bg-surface-2 hover:bg-surface-3"}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <button
                        type="button"
                        onClick={() => handleSelectSession(session.id)}
                        className="min-w-0 flex-1 text-left"
                      >
                        <p className="truncate text-sm font-medium text-text-main">{session.title}</p>
                        <p className="mt-1 truncate text-xs text-text-muted">{textValue(latestMessage?.content) || "Empty chat"}</p>
                      </button>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-[10px] text-text-muted">{formatRelativeTime(session.updatedAt)}</span>
                        <button
                          type="button"
                          onClick={(e) => handleDeleteSession(session.id, e)}
                          className="p-1 text-text-muted hover:text-red-400 transition"
                          title="Delete"
                        >
                          <span className="material-symbols-outlined text-[16px]">delete</span>
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

        {/* Error display */}
        {loadError ? (
          <div className="mt-4 rounded-[18px] border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-rose-100">
            <div className="flex items-start gap-3">
              <span className="material-symbols-outlined text-[20px]">error</span>
              <p className="text-sm leading-6">{loadError}</p>
            </div>
          </div>
        ) : null}

        {/* Messages area */}
        <div className="flex flex-1 flex-col min-h-0">
          <div className="flex-1 overflow-y-auto py-4 custom-scrollbar">
            {currentMessages.length === 0 ? (
              <div className="flex min-h-[50vh] items-center justify-center px-4 text-center">
                <div className="max-w-xl space-y-4">
                  <div className="mx-auto flex size-16 items-center justify-center rounded-[20px] border border-border-subtle bg-surface-2 text-text-secondary">
                    <span className="material-symbols-outlined text-[30px]">chat</span>
                  </div>
                  <div className="space-y-2">
                    <h2 className="text-2xl font-semibold text-text-main">Test Your Models</h2>
                    <p className="text-sm leading-6 text-text-muted">
                      Select a provider, model, and API key to test. Models come from /v1/models endpoint.
                    </p>
                  </div>
                </div>
              </div>
            ) : null}

            <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4">
              {currentMessages.map((message) => {
                const isUser = message.role === "user";
                const isAssistant = message.role === "assistant";
                const isStreaming = isAssistant && message.id === streamingMessageId && message.status === "streaming";
                const content = textValue(message.content) || (isAssistant ? streamingText : "");

                return (
                  <div key={message.id} className={`flex w-full ${isUser ? "justify-end" : "justify-start"} mb-6`}>
                    <div className={`max-w-[min(88%,42rem)] ${isUser ? "rounded-3xl bg-surface-2 px-5 py-3.5 text-text-main" : "text-text-secondary"}`}>
                      <div className="mb-1 flex items-center justify-between gap-3">
                        <span className="text-xs font-semibold">{isUser ? "You" : currentModel?.name || "Assistant"}</span>
                      </div>

                      {message.attachments?.length ? (
                        <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3 mt-2">
                          {message.attachments.map((attachment) => (
                            <a key={attachment.id} href={attachment.dataUrl} target="_blank" rel="noreferrer" className="overflow-hidden rounded-[18px] border border-border-subtle bg-surface-3">
                              <img src={attachment.dataUrl} alt={attachment.name} className="h-28 w-full object-cover" />
                            </a>
                          ))}
                        </div>
                      ) : null}

                      <div className="whitespace-pre-wrap break-words text-[15px] leading-7">
                        {content}
                        {isAssistant && isStreaming && !streamingText ? <span className="inline-block animate-pulse">▋</span> : null}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Input area */}
          <div className="shrink-0 pt-2">
            {attachments.length > 0 ? (
              <div className="mx-auto mb-3 flex w-full max-w-3xl flex-wrap gap-2 px-4">
                {attachments.map((attachment) => (
                  <div key={attachment.id} className="flex items-center gap-2 rounded-full border border-border-subtle bg-surface-2 px-3 py-2">
                    <span className="text-xs text-text-secondary max-w-[12rem] truncate">{attachment.name}</span>
                    <button type="button" onClick={() => removeAttachment(attachment.id)} className="text-text-muted hover:text-text-main" aria-label="Remove attachment">
                      <span className="material-symbols-outlined text-[18px]">close</span>
                    </button>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="mx-auto w-full max-w-3xl px-4 pb-2">
              <div className="rounded-[26px] bg-surface-2 px-3 pt-3 pb-2 shadow-[0_0_15px_rgba(0,0,0,0.10)] ring-1 ring-white/5">
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Message AI"
                  rows={1}
                  className="w-full resize-none bg-transparent px-2 text-[15px] leading-6 text-text-main outline-none placeholder:text-text-muted custom-scrollbar max-h-[25vh] overflow-y-auto"
                />

                <div className="mt-2 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => fileInputRef.current?.click()} disabled={!currentModel || loadingData} className="p-2 text-text-muted hover:text-text-main transition rounded-full hover:bg-surface-2">
                      <span className="material-symbols-outlined text-[20px]">attach_file</span>
                    </button>
                    <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleAttachFiles} />
                    <span className="text-xs font-medium text-text-muted truncate max-w-[120px]">{currentModel ? currentModel.id : "No model"}</span>
                  </div>

                  <div className="flex items-center gap-2">
                    {isSending ? (
                      <button type="button" onClick={handleStop} className="p-2 text-text-main bg-surface-3 hover:bg-surface-4 transition rounded-full h-8 w-8 flex items-center justify-center">
                        <span className="material-symbols-outlined text-[16px]">stop</span>
                      </button>
                    ) : null}
                    <button onClick={sendMessage} disabled={!canSend} className={`h-8 w-8 rounded-full flex items-center justify-center transition ${canSend ? 'bg-white text-black hover:opacity-90' : 'bg-surface-3 text-text-muted cursor-not-allowed'}`}>
                      <span className="material-symbols-outlined text-[16px]">arrow_upward</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <p className="mx-auto mt-2 max-w-3xl px-4 pb-4 text-center text-[11px] text-text-muted">
            Models from providers & combos • API key required for testing
          </p>
        </div>
      </div>
    </div>
  );
}