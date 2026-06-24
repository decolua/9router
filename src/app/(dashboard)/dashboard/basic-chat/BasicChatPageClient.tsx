"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ComponentType } from "react";
import type { JsonValue } from "open-sse/types/executor.js";
import { Badge as _Badge, Button as _Button } from "@/shared/components";
import { getModelsByProviderId } from "@/shared/constants/models";
import { isAnthropicCompatibleProvider, isOpenAICompatibleProvider } from "@/shared/constants/providers";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children?: ReactNode; variant?: string; size?: string;
  icon?: string; iconRight?: string; loading?: boolean; fullWidth?: boolean; className?: string;
}
interface BadgeProps {
  children?: ReactNode; variant?: string; size?: string; dot?: boolean; icon?: string; className?: string;
}
const Button = _Button as ComponentType<ButtonProps>;
const Badge  = _Badge  as ComponentType<BadgeProps>;

interface ChatAttachment {
  id: string;
  name: string;
  type: string;
  size: number;
  dataUrl: string;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  attachments?: ChatAttachment[];
  createdAt: string;
  status?: "streaming" | "done" | "error";
}

interface ChatSession {
  id: string;
  title: string;
  providerId: string;
  providerName: string;
  modelId: string;
  modelName: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
}

interface ChatModel {
  id: string;
  requestModel: string;
  name: string;
  providerId: string;
  providerName: string;
  source: "static" | "live";
}

interface ProviderGroup {
  providerId: string;
  providerName: string;
  providerType: string;
  connections: Record<string, JsonValue>[];
  models: ChatModel[];
}

interface ProviderConnection {
  id: string;
  provider?: string;
  name?: string;
  isActive?: boolean;
  quotaInfos?: JsonValue[];
  quotaPlan?: string | null;
  quotaMessage?: string | null;
}

const STORAGE_KEYS = {
  sessions: "basic-chat.sessions",
  activeSessionId: "basic-chat.activeSessionId",
  activeProviderId: "basic-chat.activeProviderId",
  draft: "basic-chat.draft",
};

function createId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `chat_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function safeParse<T>(value: string | null, fallback: T): T {
  try {
    return JSON.parse(value ?? "") as T;
  } catch {
    return fallback;
  }
}

function textValue(value: JsonValue): string {
  if (typeof value === "string") return value;
  if (value == null) return "";
  if (Array.isArray(value)) return (value as JsonValue[]).map(textValue).filter(Boolean).join(" ");
  if (typeof value === "object") {
    const obj = value as Record<string, JsonValue>;
    if (typeof obj["message"] === "string") return obj["message"];
    if (typeof obj["error"] === "string") return obj["error"];
    try { return JSON.stringify(value); } catch { return String(value); }
  }
  return String(value);
}

function humanize(value = "") {
  return String(value)
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .trim() || "Unknown";
}

function formatRelativeTime(value: string | number | null | undefined): string {
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

function buildUserContent(message: ChatMessage): string | Array<Record<string, JsonValue>> {
  const text = textValue(message.content).trim();
  const attachments = Array.isArray(message.attachments) ? message.attachments : [];
  if (attachments.length === 0) return text;
  const content: Array<Record<string, JsonValue>> = [];
  if (text) content.push({ type: "text", text });
  for (const attachment of attachments) {
    if (attachment?.dataUrl) content.push({ type: "image_url", image_url: { url: attachment.dataUrl } });
  }
  return content.length > 0 ? content : text;
}

function readAssistantText(chunk: Record<string, JsonValue>): string {
  if (!chunk || typeof chunk !== "object") return "";
  const choices = chunk["choices"] as Array<Record<string, JsonValue>> | undefined;
  const choice = choices?.[0];
  const delta = (choice?.["delta"] as Record<string, JsonValue>) ?? {};
  const choiceMsg = choice?.["message"] as Record<string, JsonValue> | undefined;
  const pieces = [delta["content"], choiceMsg?.["content"], chunk["output_text"], chunk["text"]]
    .map((v) => textValue(v ?? null)).filter(Boolean);
  return (pieces[0] as string) ?? "";
}

async function fileToDataUrl(file: File): Promise<string> {
  const { promise, resolve, reject } = Promise.withResolvers<string>();
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result ?? ""));
  reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"));
  reader.readAsDataURL(file);
  return promise;
}

function cloneSession(session: ChatSession): ChatSession {
  return {
    ...session,
    messages: Array.isArray(session.messages) ? session.messages.map((message) => ({ ...message })) : [],
  };
}

function getProviderLabel(connection: ProviderConnection): string {
  return connection?.name ?? humanize(connection?.provider ?? connection?.id ?? "provider");
}

function normalizeStaticModel(model: { id?: string; name?: string }, connection: ProviderConnection): ChatModel | null {
  if (!model?.id) return null;
  return {
    id: `${connection.provider}/${model.id}`,
    requestModel: `${connection.provider}/${model.id}`,
    name: model.name ?? model.id,
    providerId: connection.provider ?? "",
    providerName: getProviderLabel(connection),
    source: "static",
  };
}

function normalizeLiveModel(model: JsonValue, connection: ProviderConnection): ChatModel | null {
  const m = model !== null && typeof model === "object" && !Array.isArray(model) ? model as Record<string, JsonValue> : null;
  const rawId = typeof model === "string" ? model : String(m?.["id"] ?? m?.["name"] ?? m?.["model"] ?? "");
  if (!rawId) return null;
  const displayName = typeof model === "string" ? model : String(m?.["name"] ?? m?.["displayName"] ?? rawId);
  let requestModel = rawId;
  const isCompatible = isOpenAICompatibleProvider(connection.provider ?? "") || isAnthropicCompatibleProvider(connection.provider ?? "");
  if (isCompatible && !rawId.includes("/")) requestModel = `${connection.provider}/${rawId}`;
  return { id: requestModel, requestModel, name: displayName, providerId: connection.provider ?? "", providerName: getProviderLabel(connection), source: "live" };
}

function parseProviderModelsPayload(data: Record<string, JsonValue>): JsonValue[] {
  if (Array.isArray(data?.["models"])) return data["models"] as JsonValue[];
  if (Array.isArray(data?.["data"])) return data["data"] as JsonValue[];
  if (Array.isArray(data?.["results"])) return data["results"] as JsonValue[];
  if (Array.isArray(data)) return data as JsonValue[];
  return [];
}

function dedupeModels(models: ChatModel[]): ChatModel[] {
  const map = new Map<string, ChatModel>();
  for (const model of models) {
    if (!model?.id) continue;
    if (!map.has(model.id)) map.set(model.id, model);
  }
  return Array.from(map.values());
}

export default function BasicChatPageClient() {
  const [providerGroups, setProviderGroups] = useState<ProviderGroup[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [sessions, setSessions] = useState<ChatSession[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const saved = safeParse<ChatSession[]>(globalThis.localStorage.getItem(STORAGE_KEYS.sessions), []);
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
  const [activeProviderId, setActiveProviderId] = useState(() => {
    if (typeof window === "undefined") return "";
    return globalThis.localStorage.getItem(STORAGE_KEYS.activeProviderId) || "";
  });
  const [activeModelId, setActiveModelId] = useState("");
  const [draft, setDraft] = useState(() => {
    if (typeof window === "undefined") return "";
    return globalThis.localStorage.getItem(STORAGE_KEYS.draft) || "";
  });
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [streamingMessageId, setStreamingMessageId] = useState("");
  const [streamingText, setStreamingText] = useState("");
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const initializedRef = useRef(false);
  const modelMenuRef = useRef<HTMLDivElement>(null);
  const historyMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadData() {
      setLoadingData(true);
      setLoadError("");

      try {
        const providersRes = await fetch("/api/providers", { cache: "no-store" });
        const providersData = await providersRes.json().catch(() => ({})) as Record<string, JsonValue>;
        const connections = (Array.isArray(providersData["connections"])
          ? (providersData["connections"] as unknown as ProviderConnection[]).filter((connection) => connection?.isActive !== false)
          : []) as ProviderConnection[];

        if (connections.length === 0) {
          if (!cancelled) {
            setProviderGroups([]);
            setLoadError("No providers connected yet.");
          }
          return;
        }

        const providerMap = new Map();

        for (const connection of connections) {
          const providerId = connection.provider || connection.id;
          const providerName = getProviderLabel(connection);
          const providerType = isOpenAICompatibleProvider(providerId)
            ? "openai-compatible"
            : isAnthropicCompatibleProvider(providerId)
              ? "anthropic-compatible"
              : providerId;

          if (!providerMap.has(providerId)) {
            providerMap.set(providerId, {
              providerId,
              providerName,
              providerType,
              connections: [],
              models: [],
            });
          }

          const group = providerMap.get(providerId);
          group.providerName = group.providerName || providerName;
          group.providerType = group.providerType || providerType;
          group.connections.push(connection);

          const staticModels = getModelsByProviderId(providerId)
            .map((model: { id?: string; name?: string }) => normalizeStaticModel(model, connection))
            .filter((m: ChatModel | null): m is ChatModel => m !== null);
        }

        const liveResults = await Promise.all(
          connections.map(async (connection) => {
            try {
              const response = await fetch(`/api/providers/${connection.id}/models`, { cache: "no-store" });
              const data = await response.json().catch(() => ({})) as Record<string, JsonValue>;
              if (!response.ok) return { connection, models: [] as ChatModel[] };
              const models = parseProviderModelsPayload(data)
                .map((model) => normalizeLiveModel(model, connection))
                .filter((m): m is ChatModel => m !== null);
              return { connection, models };
            } catch {
              return { connection, models: [] };
            }
          })
        );

        for (const result of liveResults) {
          const providerId = result.connection.provider || result.connection.id;
          const group = providerMap.get(providerId);
          if (!group) continue;
          group.models.push(...result.models);
        }

        const normalized = Array.from(providerMap.values())
          .map((group) => ({
            ...group,
            models: dedupeModels(group.models).sort((a, b) => a.name.localeCompare(b.name)),
          }))
          .filter((group) => group.models.length > 0)
          .sort((a, b) => a.providerName.localeCompare(b.providerName));

        if (!cancelled) {
          setProviderGroups(normalized);
          if (normalized.length === 0) {
            setLoadError("Providers connected but no models available.");
          }
        }
      } catch (error) {
        if (!cancelled) {
          setLoadError(textValue((error as Error)?.message ?? null) || "Failed to load providers/models.");
          setProviderGroups([]);
        }
      } finally {
        if (!cancelled) setLoadingData(false);
      }
    }

    loadData();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (modelMenuRef.current && !modelMenuRef.current.contains(event.target as Node | null)) {
        setModelMenuOpen(false);
      }
      if (historyMenuRef.current && !historyMenuRef.current.contains(event.target as Node | null)) {
        setHistoryOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const modelIndex = useMemo(() => {
    const map = new Map<string, ChatModel>();
    for (const group of providerGroups) {
      for (const model of group.models) {
        map.set(model.id, { ...model, providerId: group.providerId, providerName: group.providerName });
      }
    }
    return map;
  }, [providerGroups]);

  const activeProviderGroup = useMemo(() => {
    return providerGroups.find((group) => group.providerId === activeProviderId) || providerGroups[0] || null;
  }, [providerGroups, activeProviderId]);

  const activeModel = useMemo(() => {
    if (activeModelId && modelIndex.has(activeModelId)) return modelIndex.get(activeModelId);
    if (activeSessionId) {
      const session = sessions.find((item) => item.id === activeSessionId);
      if (session?.modelId && modelIndex.has(session.modelId)) return modelIndex.get(session.modelId);
    }
    return activeProviderGroup?.models?.[0] || null;
  }, [activeModelId, modelIndex, activeProviderGroup, sessions, activeSessionId]);

  const currentSession = useMemo(() => sessions.find((session) => session.id === activeSessionId) || null, [sessions, activeSessionId]);
  const currentMessages = currentSession?.messages || [];
  const sessionItems = useMemo(() => [...sessions].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()), [sessions]);
  const canSend = !isSending && !!activeModel && (draft.trim().length > 0 || attachments.length > 0);

  useEffect(() => {
    try {
      globalThis.localStorage.setItem(STORAGE_KEYS.sessions, JSON.stringify(sessions));
      globalThis.localStorage.setItem(STORAGE_KEYS.activeSessionId, activeSessionId);
      globalThis.localStorage.setItem(STORAGE_KEYS.activeProviderId, activeProviderId);
      globalThis.localStorage.setItem(STORAGE_KEYS.draft, draft);
    } catch {
      // Ignore storage errors.
    }
  }, [sessions, activeSessionId, activeProviderId, draft]);

  useEffect(() => {
    if (loadingData || initializedRef.current) return;
    if (providerGroups.length === 0) return;

    const savedProvider = providerGroups.find((group) => group.providerId === activeProviderId) ?? providerGroups[0];
    const savedModel = (activeModelId && modelIndex.has(activeModelId)
      ? modelIndex.get(activeModelId)
      : savedProvider?.models[0]) ?? savedProvider?.models[0];

    if (sessions.length > 0) {
      const session = sessions.find((item) => item.id === activeSessionId) || sessions[0];
      const sessionModel = session?.modelId && modelIndex.has(session.modelId)
        ? modelIndex.get(session.modelId)
        : savedModel;
      Promise.resolve().then(() => {
        if (initializedRef.current) return;
        initializedRef.current = true;
        setActiveSessionId(session?.id ?? "");
        setActiveProviderId(sessionModel?.providerId ?? savedProvider?.providerId ?? "");
        setActiveModelId(sessionModel?.id ?? savedModel?.id ?? "");
      });
      return;
    }

    const session = {
      id: createId(),
      title: "New chat",
      providerId: savedProvider?.providerId ?? "",
      providerName: savedProvider?.providerName ?? "",
      modelId: savedModel?.id ?? "",
      modelName: savedModel?.name ?? "",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messages: [],
    };

    Promise.resolve().then(() => {
      if (initializedRef.current) return;
      initializedRef.current = true;
      setSessions([session]);
      setActiveSessionId(session.id);
      setActiveProviderId(savedProvider?.providerId ?? "");
      setActiveModelId(savedModel?.id ?? "");
    });
  }, [loadingData, providerGroups, modelIndex, sessions, activeSessionId, activeProviderId, activeModelId]);

  const updateSession = (sessionId: string, updater: (s: ChatSession) => ChatSession) => {
    setSessions((prev) => prev.map((session) => (session.id === sessionId ? updater(cloneSession(session)) : session)));
  };

  const ensureSessionForModel = (model: ChatModel | null | undefined): ChatSession | null => {
    if (!model) return null;
    return {
      id: createId(),
      title: "New chat",
      providerId: model.providerId,
      providerName: model.providerName,
      modelId: model.id,
      modelName: model.name,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messages: [],
    };
  };

  const handleNewChat = () => {
    if (!activeModel) return;
    const session = ensureSessionForModel(activeModel);
    if (!session) return;
    setSessions((prev) => [session, ...prev]);
    setActiveSessionId(session.id);
    setActiveProviderId(session.providerId);
    setActiveModelId(session.modelId);
    setDraft("");
    setAttachments([]);
    setStreamingMessageId("");
    setStreamingText("");
  };

  const handleSelectSession = (sessionId: string) => {
    const session = sessions.find((item) => item.id === sessionId);
    if (!session) return;
    setActiveSessionId(sessionId);
    setActiveProviderId(session.providerId || activeProviderId);
    setActiveModelId(session.modelId || activeModelId);
    setHistoryOpen(false);
  };

  const handleDeleteCurrentChat = () => {
    if (!activeSessionId) return;
    const nextSessions = sessions.filter((session) => session.id !== activeSessionId);
    const fallback = nextSessions[0] || null;
    setSessions(nextSessions);
    if (fallback) {
      setActiveSessionId(fallback.id);
      setActiveProviderId(fallback.providerId);
      setActiveModelId(fallback.modelId);
    } else {
      setActiveSessionId("");
      setActiveProviderId("");
      setActiveModelId("");
    }
  };

  const handleSelectProvider = (providerId: string) => {
    const group = providerGroups.find((item) => item.providerId === providerId);
    if (!group || group.models.length === 0) return;
    const nextModel = group.models[0];
    if (!nextModel) return;

    const current = sessions.find((session) => session.id === activeSessionId);
    if (current && current.messages.length > 0) {
      const session = ensureSessionForModel(nextModel);
      if (!session) return;
      setSessions((prev) => [session, ...prev]);
      setActiveSessionId(session.id);
    } else if (current) {
      setSessions((prev) => prev.map((item) => (item.id === current.id ? {
        ...item,
        providerId: group.providerId,
        providerName: group.providerName,
        modelId: nextModel.id,
        modelName: nextModel.name,
      } : item)));
      setActiveSessionId(current.id);
    }

    setActiveProviderId(group.providerId);
    setActiveModelId(nextModel.id);
    setModelMenuOpen(false);
  };

  const handleSelectModel = (modelId: string) => {
    const model = modelIndex.get(modelId);
    if (!model) return;

    const current = sessions.find((session) => session.id === activeSessionId);
    if (current && current.messages.length > 0) {
      const session = ensureSessionForModel(model);
      if (!session) return;
      setSessions((prev) => [session, ...prev]);
      setActiveSessionId(session.id);
    } else if (current) {
      setSessions((prev) => prev.map((item) => (item.id === current.id ? {
        ...item,
        providerId: model.providerId,
        providerName: model.providerName,
        modelId: model.id,
        modelName: model.name,
      } : item)));
      setActiveSessionId(current.id);
    } else {
      const session = ensureSessionForModel(model);
      if (!session) return;
      setSessions((prev) => [session, ...prev]);
      setActiveSessionId(session.id);
    }

    setActiveProviderId(model.providerId);
    setActiveModelId(model.id);
    setModelMenuOpen(false);
  };

  const handleAttachFiles = async (event: React.ChangeEvent<HTMLInputElement>) => {
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

  const removeAttachment = (attachmentId: string) => {
    setAttachments((prev) => prev.filter((attachment) => attachment.id !== attachmentId));
  };

  const handleStop = () => {
    abortRef.current?.abort();
  };

  const finalizeSessionTitle = (sessionId: string, titleSeed: string) => {
    const title = makeSessionTitle(titleSeed);
    updateSession(sessionId, (session) => ({
      ...session,
      title: session.title === "New chat" ? title : session.title,
      updatedAt: new Date().toISOString(),
    }));
  };

  const sendMessage = async () => {
    const model = activeModel || activeProviderGroup?.models?.[0] || null;
    if (!model) return;

    const userText = draft.trim();
    if (!userText && attachments.length === 0) return;

    let sessionId = activeSessionId;
    let session: ChatSession | null | undefined = sessions.find((item) => item.id === sessionId);
    if (!session) {
      session = ensureSessionForModel(model);
      if (!session) return;
      sessionId = session.id;
      setSessions((prev) => [session!, ...prev]);
      setActiveSessionId(sessionId);
    }

    const userMessage: ChatMessage = {
      id: createId(),
      role: "user",
      content: userText,
      attachments: attachments.map((attachment) => ({
        id: attachment.id,
        name: attachment.name,
        type: attachment.type,
        size: attachment.size,
        dataUrl: attachment.dataUrl,
      })),
      createdAt: new Date().toISOString(),
    };

    const assistantMessageId = createId();
    const assistantMessage: ChatMessage = {
      id: assistantMessageId,
      role: "assistant",
      content: "",
      createdAt: new Date().toISOString(),
      status: "streaming",
    };

    const nextMessages = [...(session.messages || []), userMessage, assistantMessage];
    setSessions((prev) => prev.map((item) => (item.id === sessionId ? {
      ...item,
      providerId: model.providerId,
      providerName: model.providerName,
      modelId: model.id,
      modelName: model.name,
      messages: nextMessages,
      updatedAt: new Date().toISOString(),
      title: item.title === "New chat" ? makeSessionTitle(userText) : item.title,
    } : item)));
    setDraft("");
    setAttachments([]);
    setIsSending(true);
    setStreamingMessageId(assistantMessageId);
    setStreamingText("");
    abortRef.current?.abort();
    abortRef.current = new AbortController();

    const requestMessages = nextMessages
      .filter((message) => !(message.role === "assistant" && message.id === assistantMessageId))
      .map((message) => ({
        role: message.role,
        content: message.role === "user" ? buildUserContent(message) : message.content,
      }));

    try {
      const response = await fetch("/api/dashboard/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify({
          model: model.requestModel || model.id,
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
        updateSession(sessionId, (currentSession) => ({
          ...currentSession,
          messages: currentSession.messages.map((message) => (message.id === assistantMessageId ? { ...message, content: fallbackText, status: "done" } : message)),
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
            updateSession(sessionId, (currentSession) => ({
              ...currentSession,
              messages: currentSession.messages.map((message) => (message.id === assistantMessageId ? { ...message, content: assistantText, status: "streaming" } : message)),
              updatedAt: new Date().toISOString(),
            }));
          } catch {
            // Ignore malformed chunks.
          }
        }
      }

      updateSession(sessionId, (currentSession) => ({
        ...currentSession,
        messages: currentSession.messages.map((message) => (message.id === assistantMessageId ? { ...message, content: assistantText || message.content, status: "done" } : message)),
        updatedAt: new Date().toISOString(),
      }));
      finalizeSessionTitle(sessionId, userText);
    } catch (error) {
      if ((error as Error).name !== "AbortError") {
        const errorText = textValue((error as Error)?.message ?? error);
        updateSession(sessionId, (currentSession) => ({
          ...currentSession,
          messages: currentSession.messages.map((message) => (message.id === assistantMessageId ? { ...message, content: message.content || `Error: ${errorText}`, status: "error" } : message)),
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

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (canSend) sendMessage();
    }
  };

  const modelLabel = activeModel ? `${activeModel.name}` : "Select model";
  const modelSubLabel = activeModel ? activeModel.requestModel : "Choose from connected providers";

  return (
    <div className="relative flex-1 flex flex-col h-full min-h-0 min-w-0 bg-[#212121] text-white overflow-hidden">
      <div className="relative mx-auto flex flex-1 h-full min-h-0 w-full max-w-4xl flex-col">
        <div className="flex shrink-0 items-center justify-between gap-3 px-4 py-3 lg:px-6">
          <div ref={modelMenuRef} className="relative">
            <button
              type="button"
              onClick={() => setModelMenuOpen((value) => !value)}
              className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-left transition hover:bg-white/8"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-white">{modelLabel}</span>
                  <span className="material-symbols-outlined text-[18px] text-white/70">expand_more</span>
                </div>
                <p className="truncate text-xs text-white/55">{modelSubLabel}</p>
              </div>
            </button>

            {modelMenuOpen ? (
              <div className="absolute left-0 top-[calc(100%+10px)] z-30 w-[min(520px,calc(100vw-2rem))] overflow-hidden rounded-[20px] border border-white/10 bg-[#262626] shadow-2xl shadow-black/50">
                <div className="border-b border-white/10 px-4 py-3">
                  <p className="text-xs uppercase tracking-[0.22em] text-white/45">Models</p>
                  <p className="text-sm text-white/75">Only from connected providers</p>
                </div>
                <div className="max-h-[60vh] overflow-y-auto p-2 custom-scrollbar">
                  {providerGroups.map((group) => (
                    <div key={group.providerId} className="mb-2 rounded-[16px] border border-white/10 bg-black/20 p-2">
                      <div className="flex items-center justify-between px-2 py-2">
                        <p className="text-sm font-semibold text-white">{group.providerName}</p>
                        <Badge size="sm" variant="default">{group.models.length}</Badge>
                      </div>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {group.models.map((model) => {
                          const isActive = model.id === activeModelId;
                          return (
                            <button
                              key={model.id}
                              type="button"
                              onClick={() => handleSelectModel(model.id)}
                              className={`rounded-[14px] border px-3 py-3 text-left transition ${isActive ? "border-blue-400/40 bg-blue-500/15" : "border-white/10 bg-white/5 hover:bg-white/8"}`}
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-medium text-white">{model.name}</p>
                                  <p className="truncate text-[11px] text-white/45">{model.requestModel}</p>
                                </div>
                                {isActive ? <span className="material-symbols-outlined text-[18px] text-blue-300">check_circle</span> : null}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setHistoryOpen((value) => !value)}
              className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/80 transition hover:bg-white/8"
            >
              History
            </button>
            <Button variant="ghost" size="sm" icon="delete" onClick={handleDeleteCurrentChat} disabled={!activeSessionId || sessions.length === 0}>
              Clear
            </Button>
          </div>
        </div>

        {historyOpen ? (
          <div ref={historyMenuRef} className="absolute right-4 top-[72px] z-20 w-[min(360px,calc(100vw-2rem))] rounded-[20px] border border-white/10 bg-[#262626] p-2 shadow-2xl shadow-black/50 lg:right-6">
            <div className="px-3 py-2">
              <p className="text-xs uppercase tracking-[0.22em] text-white/45">Recent chats</p>
            </div>
            <div className="max-h-[48vh] space-y-2 overflow-y-auto p-1 custom-scrollbar">
              {sessionItems.length === 0 ? (
                <div className="rounded-[16px] border border-dashed border-white/10 bg-white/5 p-4 text-sm text-white/55">
                  No conversations yet.
                </div>
              ) : sessionItems.map((session) => {
                const isActive = session.id === activeSessionId;
                const latestMessage = [...(session.messages || [])].reverse().find((message) => message.role === "user") || session.messages?.[0];
                return (
                  <button
                    key={session.id}
                    type="button"
                    onClick={() => handleSelectSession(session.id)}
                    className={`w-full rounded-[16px] border px-3 py-3 text-left transition ${isActive ? "border-blue-400/40 bg-blue-500/15" : "border-white/10 bg-white/5 hover:bg-white/8"}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-white">{session.title}</p>
                        <p className="mt-1 truncate text-xs text-white/50">{textValue(latestMessage?.content ?? null) || "Empty chat"}</p>
                      </div>
                      <span className="text-[10px] text-white/40 shrink-0">{formatRelativeTime(session.updatedAt)}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        {loadError ? (
          <div className="mt-4 rounded-[18px] border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-rose-100">
            <div className="flex items-start gap-3">
              <span className="material-symbols-outlined text-[20px]">error</span>
              <p className="text-sm leading-6">{loadError}</p>
            </div>
          </div>
        ) : null}

        <div className="flex flex-1 flex-col min-h-0">
          <div className="flex-1 overflow-y-auto py-4 custom-scrollbar">
            {currentMessages.length === 0 ? (
              <div className="flex min-h-[50vh] items-center justify-center px-4 text-center">
                <div className="max-w-xl space-y-4">
                  <div className="mx-auto flex size-16 items-center justify-center rounded-[20px] border border-white/10 bg-white/5 text-white/80">
                    <span className="material-symbols-outlined text-[30px]">chat</span>
                  </div>
                  <div className="space-y-2">
                    <h2 className="text-2xl font-semibold text-white">Start a conversation</h2>
                    <p className="text-sm leading-6 text-white/60">
                      Simple chat interface to interact with any AI model from connected providers. Select a model and start chatting!
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
                    <div className={`max-w-[min(88%,42rem)] ${isUser ? "rounded-3xl bg-[#2f2f2f] px-5 py-3.5 text-white" : "text-white/90"}`}>
                      <div className="mb-1 flex items-center justify-between gap-3">
                        <span className="text-xs font-semibold">{isUser ? "You" : activeModel?.name || "Assistant"}</span>
                      </div>

                      {message.attachments?.length ? (
                        <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3 mt-2">
                          {message.attachments.map((attachment) => (
                            <a key={attachment.id} href={attachment.dataUrl} target="_blank" rel="noreferrer" className="overflow-hidden rounded-[18px] border border-white/10 bg-black/20">
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

          <div className="shrink-0 pt-2">
            {attachments.length > 0 ? (
              <div className="mx-auto mb-3 flex w-full max-w-3xl flex-wrap gap-2 px-4">
                {attachments.map((attachment) => (
                  <div key={attachment.id} className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2">
                    <span className="text-xs text-white/80 max-w-[12rem] truncate">{attachment.name}</span>
                    <button type="button" onClick={() => removeAttachment(attachment.id)} className="text-white/55 hover:text-white" aria-label="Remove attachment">
                      <span className="material-symbols-outlined text-[18px]">close</span>
                    </button>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="mx-auto w-full max-w-3xl px-4 pb-2">
              <div className="rounded-[26px] bg-[#2f2f2f] px-3 pt-3 pb-2 shadow-[0_0_15px_rgba(0,0,0,0.10)] ring-1 ring-white/5">
                <textarea
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Message AI"
                  rows={1}
                  className="w-full resize-none bg-transparent px-2 text-[15px] leading-6 text-white outline-none placeholder:text-white/40 custom-scrollbar max-h-[25vh] overflow-y-auto"
                />

                <div className="mt-2 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => fileInputRef.current?.click()} disabled={!activeModel || loadingData} className="p-2 text-white/50 hover:text-white transition rounded-full hover:bg-white/5">
                      <span className="material-symbols-outlined text-[20px]">attach_file</span>
                    </button>
                    <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleAttachFiles} />
                    <span className="text-xs font-medium text-white/30 truncate max-w-[120px]">{activeModel ? activeModel.name : "No model"}</span>
                  </div>

                  <div className="flex items-center gap-2">
                    {isSending ? (
                      <button type="button" onClick={handleStop} className="p-2 text-white bg-white/10 hover:bg-white/20 transition rounded-full h-8 w-8 flex items-center justify-center">
                        <span className="material-symbols-outlined text-[16px]">stop</span>
                      </button>
                    ) : null}
                    <button onClick={sendMessage} disabled={!canSend} className={`h-8 w-8 rounded-full flex items-center justify-center transition ${canSend ? 'bg-white text-black hover:opacity-90' : 'bg-white/10 text-white/30 cursor-not-allowed'}`}>
                      <span className="material-symbols-outlined text-[16px]">arrow_upward</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <p className="mx-auto mt-2 max-w-3xl px-4 pb-4 text-center text-[11px] text-white/30">
            Model list is filtered from connected providers.
          </p>
        </div>
      </div>
    </div>
  );
}
