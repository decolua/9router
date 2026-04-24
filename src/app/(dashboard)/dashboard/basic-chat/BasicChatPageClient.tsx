"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { 
  Chat, 
  Plus, 
  Trash, 
  Paperclip, 
  StopCircle, 
  ClockCounterClockwise as History, 
  CaretDown, 
  Check,
  Image as ImageIcon,
  X,
  ArrowUp,
  Cpu
} from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { 
 DropdownMenu, 
 DropdownMenuContent, 
 DropdownMenuItem, 
 DropdownMenuTrigger,
 DropdownMenuLabel,
 DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { getModelsByProviderId } from "@/shared/constants/models";
import { isAnthropicCompatibleProvider, isOpenAICompatibleProvider } from "@/shared/constants/providers";

const STORAGE_KEYS = {
 sessions: "basic-chat.sessions",
 activeSessionId: "basic-chat.activeSessionId",
 activeProviderId: "basic-chat.activeProviderId",
 draft: "basic-chat.draft",
};

interface Attachment {
  id: string;
  name: string;
  type: string;
  dataUrl: string;
}

interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: any;
  attachments?: Attachment[];
  createdAt: string;
  status?: "streaming" | "done" | "error";
}

interface Session {
  id: string;
  title: string;
  providerId: string;
  providerName: string;
  modelId: string;
  modelName: string;
  createdAt: string;
  updatedAt: string;
  messages: Message[];
}

interface ModelItem {
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
  connections: any[];
  models: ModelItem[];
}

// --- Utilities ---
function createId() {
 if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
 return `chat_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function safeParse(value: string | null, fallback: any) {
 if (!value) return fallback;
 try { return JSON.parse(value); } catch { return fallback; }
}

function textValue(value: any): string {
 if (typeof value === "string") return value;
 if (value == null) return "";
 if (Array.isArray(value)) return value.map(textValue).filter(Boolean).join("");
 if (typeof value === "object") {
 if (typeof value.message === "string") return value.message;
 if (typeof value.error === "string") return value.error;
 if (typeof value.text === "string") return value.text;
 try { return JSON.stringify(value); } catch { return String(value); }
 }
 return String(value);
}

function humanize(value = "") {
 return String(value).replace(/[-_]/g, " ").replace(/\b\w/g, c => c.toUpperCase()).trim() || "Unknown";
}

function formatRelativeTime(value: string) {
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

function buildUserContent(message: Message) {
 const text = textValue(message.content).trim();
 const attachments = Array.isArray(message.attachments) ? message.attachments : [];
 if (attachments.length === 0) return text;
 const content: any[] = [];
 if (text) content.push({ type: "text", text });
 for (const attachment of attachments) {
 if (attachment?.dataUrl) content.push({ type: "image_url", image_url: { url: attachment.dataUrl } });
 }
 return content.length > 0 ? content : text;
}

function readAssistantText(chunk: any) {
 if (!chunk || typeof chunk !== "object") return "";
 const choice = chunk.choices?.[0];
 const delta = choice?.delta || {};
 const pieces = [delta.content, choice?.message?.content, chunk.output_text, chunk.text].map(textValue).filter(Boolean);
 return pieces[0] || "";
}

async function fileToDataUrl(file: File): Promise<string> {
 return await new Promise((resolve, reject) => {
 const reader = new FileReader();
 reader.onload = () => resolve(String(reader.result || ""));
 reader.onerror = () => reject(reader.error || new Error("Failed to read file"));
 reader.readAsDataURL(file);
 });
}

function getProviderLabel(connection: any) {
 return connection?.name || humanize(connection?.provider || connection?.id || "provider");
}

function normalizeStaticModel(model: any, connection: any): ModelItem | null {
 if (!model?.id) return null;
 return { id: `${connection.provider}/${model.id}`, requestModel: `${connection.provider}/${model.id}`, name: model.name || model.id, providerId: connection.provider, providerName: getProviderLabel(connection), source: "static" };
}

function normalizeLiveModel(model: any, connection: any): ModelItem | null {
 const rawId = typeof model === "string" ? model : model?.id || model?.name || model?.model || "";
 if (!rawId) return null;
 const displayName = typeof model === "string" ? model : model?.name || model?.displayName || rawId;
 let requestModel = rawId;
 const isCompatible = isOpenAICompatibleProvider(connection.provider) || isAnthropicCompatibleProvider(connection.provider);
 if (isCompatible && !rawId.includes("/")) requestModel = `${connection.provider}/${rawId}`;
 return { id: requestModel, requestModel, name: displayName, providerId: connection.provider, providerName: getProviderLabel(connection), source: "live" };
}

function parseProviderModelsPayload(data: any) {
 if (Array.isArray(data?.models)) return data.models;
 if (Array.isArray(data?.data)) return data.data;
 if (Array.isArray(data?.results)) return data.results;
 if (Array.isArray(data)) return data;
 return [];
}

function dedupeModels(models: ModelItem[]) {
 const map = new Map();
 for (const model of models) { if (model?.id && !map.has(model.id)) map.set(model.id, model); }
 return Array.from(map.values()) as ModelItem[];
}

interface BasicChatPageClientProps {
  initialData?: {
    providerGroups: ProviderGroup[];
  };
}

export default function BasicChatPageClient({ initialData }: BasicChatPageClientProps) {
 const [providerGroups, setProviderGroups] = useState<ProviderGroup[]>(initialData?.providerGroups || []);
 // eslint-disable-next-line @typescript-eslint/no-unused-vars
 const [loadingData, setLoadingData] = useState(!initialData?.providerGroups);
 // eslint-disable-next-line @typescript-eslint/no-unused-vars
 const [loadError, setLoadError] = useState("");
 const [sessions, setSessions] = useState<Session[]>([]);
 const [activeSessionId, setActiveSessionId] = useState("");
 // eslint-disable-next-line @typescript-eslint/no-unused-vars
 const [activeProviderId, setActiveProviderId] = useState("");
 const [activeModelId, setActiveModelId] = useState("");
 const [draft, setDraft] = useState("");
 const [attachments, setAttachments] = useState<Attachment[]>([]);
 const [isSending, setIsSending] = useState(false);
 // eslint-disable-next-line @typescript-eslint/no-unused-vars
 const [streamingMessageId, setStreamingMessageId] = useState("");
 const [streamingText, setStreamingText] = useState("");
 const [isHydrated, setIsHydrated] = useState(false);
 
 const fileInputRef = useRef<HTMLInputElement>(null);
 const abortRef = useRef<AbortController | null>(null);
 const scrollRef = useRef<HTMLDivElement>(null);

 useEffect(() => {
 try {
 const savedSessions = safeParse(globalThis.localStorage.getItem(STORAGE_KEYS.sessions), []);
 setSessions(Array.isArray(savedSessions) ? savedSessions.map((s: any) => ({ ...s, messages: Array.isArray(s.messages) ? s.messages : [] })) : []);
 setActiveSessionId(globalThis.localStorage.getItem(STORAGE_KEYS.activeSessionId) || "");
 setActiveProviderId(globalThis.localStorage.getItem(STORAGE_KEYS.activeProviderId) || "");
 setDraft(globalThis.localStorage.getItem(STORAGE_KEYS.draft) || "");
 } catch { } finally { setIsHydrated(true); }
 }, []);

 useEffect(() => {
 let cancelled = false;
 async function loadData() {
 setLoadingData(true);
 setLoadError("");
 try {
 const providersRes = await fetch("/api/providers", { cache: "no-store" });
 const providersData = await providersRes.json().catch(() => ({}));
 const connections = Array.isArray(providersData.connections) ? providersData.connections.filter((c: any) => c?.isActive !== false) : [];
 if (connections.length === 0) {
 if (!cancelled) { setProviderGroups([]); setLoadError("No providers connected."); }
 return;
 }
 const providerMap = new Map<string, ProviderGroup>();
 for (const connection of connections) {
 const providerId = connection.provider || connection.id;
 if (!providerMap.has(providerId)) {
 providerMap.set(providerId, { providerId, providerName: getProviderLabel(connection), providerType: providerId, connections: [], models: [] });
 }
 const group = providerMap.get(providerId)!;
 group.connections.push(connection);
 group.models.push(...(getModelsByProviderId(providerId).map(m => normalizeStaticModel(m, connection)).filter(Boolean) as ModelItem[]));
 }
 const liveResults = await Promise.all(connections.map(async (c: any) => {
 try {
 const res = await fetch(`/api/providers/${c.id}/models`, { cache: "no-store" });
 const data = await res.json().catch(() => ({}));
 return { connection: c, models: res.ok ? (parseProviderModelsPayload(data).map((m: any) => normalizeLiveModel(m, c)).filter(Boolean) as ModelItem[]) : [] };
 } catch { return { connection: c, models: [] }; }
 }));
 for (const result of liveResults) {
 const group = providerMap.get(result.connection.provider || result.connection.id);
 if (group) group.models.push(...result.models);
 }
 const normalized = Array.from(providerMap.values()).map(g => ({ ...g, models: dedupeModels(g.models).sort((a, b) => a.name.localeCompare(b.name)) })).filter(g => g.models.length > 0).sort((a, b) => a.providerName.localeCompare(b.providerName));
 if (!cancelled) setProviderGroups(normalized);
 } catch (error: any) {
 if (!cancelled) { setLoadError(error?.message || "Failed to load providers."); setProviderGroups([]); }
 } finally { if (!cancelled) setLoadingData(false); }
 }
 loadData();
 return () => { cancelled = true; };
 }, []);

 const modelIndex = useMemo(() => {
 const map = new Map<string, ModelItem>();
 for (const group of providerGroups) { for (const model of group.models) { map.set(model.id, { ...model, providerId: group.providerId, providerName: group.providerName }); } }
 return map;
 }, [providerGroups]);

 const activeModel = useMemo(() => {
 if (activeModelId && modelIndex.has(activeModelId)) return modelIndex.get(activeModelId);
 if (activeSessionId) {
 const session = sessions.find(s => s.id === activeSessionId);
 if (session?.modelId && modelIndex.has(session.modelId)) return modelIndex.get(session.modelId);
 }
 return providerGroups[0]?.models?.[0] || null;
 }, [activeModelId, modelIndex, providerGroups, sessions, activeSessionId]);

 const currentSession = useMemo(() => sessions.find(s => s.id === activeSessionId) || null, [sessions, activeSessionId]);
 const currentMessages = currentSession?.messages || [];
 const sessionItems = useMemo(() => [...sessions].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()), [sessions]);
 const canSend = !isSending && !!activeModel && (draft.trim().length > 0 || attachments.length > 0);

 useEffect(() => {
 if (!isHydrated) return;
 localStorage.setItem(STORAGE_KEYS.sessions, JSON.stringify(sessions));
 localStorage.setItem(STORAGE_KEYS.activeSessionId, activeSessionId);
 localStorage.setItem(STORAGE_KEYS.activeProviderId, activeProviderId);
 localStorage.setItem(STORAGE_KEYS.draft, draft);
 }, [isHydrated, sessions, activeSessionId, activeProviderId, draft]);

 const handleNewChat = () => {
 if (!activeModel) return;
 const session: Session = { id: createId(), title: "New chat", providerId: activeModel.providerId, providerName: activeModel.providerName, modelId: activeModel.id, modelName: activeModel.name, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), messages: [] };
 setSessions(prev => [session, ...prev]);
 setActiveSessionId(session.id);
 setDraft("");
 setAttachments([]);
 };

 const handleSelectModel = (modelId: string) => {
 const model = modelIndex.get(modelId);
 if (!model) return;
 const current = sessions.find(s => s.id === activeSessionId);
 if (current && current.messages.length > 0) {
 const session: Session = { id: createId(), title: "New chat", providerId: model.providerId, providerName: model.providerName, modelId: model.id, modelName: model.name, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), messages: [] };
 setSessions(prev => [session, ...prev]);
 setActiveSessionId(session.id);
 } else if (current) {
 setSessions(prev => prev.map(s => s.id === current.id ? { ...s, providerId: model.providerId, providerName: model.providerName, modelId: model.id, modelName: model.name } : s));
 }
 setActiveProviderId(model.providerId);
 setActiveModelId(model.id);
 };

 const sendMessage = async () => {
 const model = activeModel;
 if (!model || (!draft.trim() && attachments.length === 0)) return;
 let sessionId = activeSessionId;
 let session = sessions.find(s => s.id === sessionId);
 if (!session) {
 const newSession: Session = { id: createId(), title: "New chat", providerId: model.providerId, providerName: model.providerName, modelId: model.id, modelName: model.name, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), messages: [] };
 session = newSession;
 sessionId = session.id;
 setSessions(prev => [newSession, ...prev]);
 setActiveSessionId(sessionId);
 }
 const userMessage: Message = { id: createId(), role: "user", content: draft.trim(), attachments: attachments.map(a => ({ id: a.id, name: a.name, type: a.type, dataUrl: a.dataUrl })), createdAt: new Date().toISOString() };
 const assistantMessageId = createId();
 const assistantMessage: Message = { id: assistantMessageId, role: "assistant", content: "", createdAt: new Date().toISOString(), status: "streaming" };
 const nextMessages = [...(session.messages || []), userMessage, assistantMessage];
 setSessions(prev => prev.map(s => s.id === sessionId ? { ...s, messages: nextMessages, updatedAt: new Date().toISOString(), title: s.title === "New chat" ? makeSessionTitle(draft) : s.title } : s));
 setDraft(""); setAttachments([]); setIsSending(true); setStreamingMessageId(assistantMessageId); setStreamingText("");
 abortRef.current = new AbortController();
 try {
 const res = await fetch("/api/dashboard/chat/completions", { method: "POST", headers: { "Content-Type": "application/json", Accept: "text/event-stream" }, body: JSON.stringify({ model: model.requestModel || model.id, messages: nextMessages.filter(m => m.id !== assistantMessageId).map(m => ({ role: m.role, content: m.role === "user" ? buildUserContent(m) : m.content })), stream: true }), signal: abortRef.current.signal });
 if (!res.ok) throw new Error("Request failed");
 const reader = res.body?.getReader();
 if (!reader) return;
 const decoder = new TextDecoder();
 let assistantText = "";
 while (true) {
 const { value, done } = await reader.read();
 if (done) break;
 const lines = decoder.decode(value, { stream: true }).split(/\r?\n/);
 for (const line of lines) {
 if (!line.trim().startsWith("data:")) continue;
 const payload = line.trim().slice(5).trim();
 if (payload === "[DONE]") continue;
 try {
 const text = readAssistantText(JSON.parse(payload));
 if (text) {
 assistantText += text;
 setStreamingText(assistantText);
 setSessions(prev => prev.map(s => s.id === sessionId ? { ...s, messages: s.messages.map(m => m.id === assistantMessageId ? { ...m, content: assistantText } : m) } : s));
 }
 } catch {}
 }
 }
 setSessions(prev => prev.map(s => s.id === sessionId ? { ...s, messages: s.messages.map(m => m.id === assistantMessageId ? { ...m, status: "done" } : m) } : s));
 } catch (e: any) {
 if (e.name !== "AbortError") setLoadError(e.message);
 } finally { setIsSending(false); setStreamingMessageId(""); setStreamingText(""); }
 };

 // --- Render ---

 return (
 <div className="flex flex-col h-full bg-background overflow-hidden relative border-l border-border/50 rounded-none">
 {/* Top Header */}
 <header className="h-14 border-b border-border/50 flex items-center justify-between px-4 bg-muted/10 shrink-0">
 <div className="flex items-center gap-2 min-w-0">
 <DropdownMenu>
 <DropdownMenuTrigger render={
 <Button variant="ghost" size="sm" className="h-9 px-3 gap-2 font-bold uppercase tracking-widest rounded-none hover:bg-muted/30">
 <Cpu className="size-4 text-primary" weight="bold" />
 <span className="truncate max-w-[200px]">{activeModel?.name || "Select Model"}</span>
 <CaretDown className="size-3.5 opacity-40" weight="bold" />
 </Button>
 } />
 <DropdownMenuContent align="start" className="w-[320px] max-h-[60vh] p-0 overflow-hidden rounded-none border-border/50 shadow-none">
 <ScrollArea className="h-full">
 {providerGroups.map(group => (
 <div key={group.providerId} className="p-0">
 <DropdownMenuLabel className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground opacity-40 px-3 py-2 bg-muted/5 border-b border-border/40">{group.providerName}</DropdownMenuLabel>
 {group.models.map(m => (
 <DropdownMenuItem key={m.id} onClick={() => handleSelectModel(m.id)} className="rounded-none gap-3 py-2.5 cursor-pointer focus:bg-primary/5 focus:text-primary px-3">
 <div className="flex-1 min-w-0">
 <p className="text-xs font-bold truncate">{m.name}</p>
 <p className="text-[10px] text-muted-foreground truncate opacity-70 font-mono">{m.requestModel}</p>
 </div>
 {m.id === (activeModel?.id || activeModelId) && <Check className="size-3.5 text-primary" weight="bold" />}
 </DropdownMenuItem>
 ))}
 <DropdownMenuSeparator className="mx-0 h-px bg-border/20"/>
 </div>
 ))}
 </ScrollArea>
 </DropdownMenuContent>
 </DropdownMenu>
 </div>

 <div className="flex items-center gap-1">
 <DropdownMenu>
 <DropdownMenuTrigger render={
 <Button variant="ghost" size="icon" className="size-9 rounded-none"><History className="size-4" weight="bold" /></Button>
 } />
 <DropdownMenuContent align="end" className="w-[300px] rounded-none border-border/50 shadow-none p-0 overflow-hidden">
 <DropdownMenuLabel className="text-[10px] font-bold uppercase tracking-widest px-3 py-2 bg-muted/5 border-b border-border/40">Recent Conversations</DropdownMenuLabel>
 <ScrollArea className="h-[400px]">
 {sessionItems.length === 0 ? (
 <div className="p-8 text-center opacity-30 text-[10px] font-bold uppercase tracking-widest">No history</div>
 ) : sessionItems.map(s => (
 <DropdownMenuItem key={s.id} onClick={() => setActiveSessionId(s.id)} className="px-3 py-3 flex flex-col items-start gap-1 rounded-none cursor-pointer border-b border-border/20 last:border-0">
 <span className="text-xs font-bold truncate w-full tracking-tight">{s.title}</span>
 <span className="text-[10px] text-muted-foreground/60 font-bold uppercase tracking-widest">{formatRelativeTime(s.updatedAt)} ago</span>
 </DropdownMenuItem>
 ))}
 </ScrollArea>
 </DropdownMenuContent>
 </DropdownMenu>
 <Button variant="ghost" size="icon" className="size-9 rounded-none" onClick={handleNewChat} title="New Chat"><Plus className="size-4" weight="bold" /></Button>
 <Button variant="ghost" size="icon" className="size-9 rounded-none text-destructive/60 hover:bg-destructive/10 hover:text-destructive" onClick={() => { if(confirm("Terminate session?")) setSessions(prev => prev.filter(s => s.id !== activeSessionId)); }} title="Terminate"><Trash className="size-4" weight="bold" /></Button>
 </div>
 </header>

 {/* Messages */}
 <main className="flex-1 overflow-hidden relative flex flex-col bg-background/50">
 <ScrollArea className="flex-1 px-4 py-8" ref={scrollRef}>
 <div className="max-w-3xl mx-auto space-y-10">
 {currentMessages.length === 0 ? (
 <div className="py-20 flex flex-col items-center justify-center text-center gap-6 opacity-10 grayscale">
 <div className="size-16 rounded-none border-2 border-dashed border-muted-foreground flex items-center justify-center"><Chat className="size-8" weight="bold" /></div>
 <div className="space-y-1">
 <h2 className="text-lg font-black uppercase tracking-[0.2em]">Ready to link</h2>
 <p className="text-xs font-bold uppercase tracking-widest">Select an infrastructure model to initiate session.</p>
 </div>
 </div>
 ) : (
   <>
   {currentMessages.map(m => {
 const isUser = m.role === "user";
 return (
 <div key={m.id} className={cn("flex flex-col gap-2.5", isUser ? "items-end" : "items-start")}>
 <div className="flex items-center gap-2 px-1">
 <span className="text-[10px] font-black uppercase tracking-widest opacity-30">{isUser ? "USER" : activeModel?.name || "AI"}</span>
 </div>
 <div className={cn(
 "max-w-[90%] rounded-none p-4 text-[14px] leading-relaxed shadow-none border",
 isUser ? "bg-primary text-primary-foreground font-medium border-primary" : "bg-muted/30 border-border/50 text-foreground"
 )}>
 {m.attachments && m.attachments.length > 0 && (
 <div className="mb-4 grid grid-cols-2 gap-2">
 {m.attachments.map(a => <img key={a.id} src={a.dataUrl} alt={a.name} className="rounded-none border border-border/50 max-h-40 object-cover w-full shadow-none" />)}
 </div>
 )}
 <div className="whitespace-pre-wrap break-words">{textValue(m.content) || (m.role === 'assistant' && m.status === 'streaming' ? streamingText : "")}</div>
 {m.status === 'streaming' && !streamingText && <span className="animate-pulse font-black">▋</span>}
 </div>
 </div>
 );
 })}
 <div className="h-10" />
   </>
 )}
 </div>
 </ScrollArea>
 </main>

 {/* Input Area */}
 <footer className="p-4 pt-0 shrink-0 bg-background/80 backdrop-blur-md border-t border-border/50">
 <div className="max-w-3xl mx-auto">
 {attachments.length > 0 && (
 <div className="flex flex-wrap gap-2 py-3 border-b border-border/40 mb-3">
 {attachments.map(a => (
 <div key={a.id} className="h-8 px-2 rounded-none bg-muted border border-border/50 flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest">
 <ImageIcon className="size-3.5 opacity-50" weight="bold" />
 <span className="truncate max-w-[120px]">{a.name}</span>
 <button onClick={() => setAttachments(prev => prev.filter(x => x.id !== a.id))} className="hover:text-destructive transition-colors"><X className="size-3.5" weight="bold" /></button>
 </div>
 ))}
 </div>
 )}
 
 <div className="relative mt-4">
 <textarea
 className="w-full bg-muted/20 border border-border/60 rounded-none px-4 py-4 pr-14 min-h-[60px] max-h-[250px] text-sm focus:border-primary/50 focus:bg-muted/40 outline-none resize-none transition-all custom-scrollbar font-medium"
 placeholder="Execute prompt..."
 rows={1}
 value={draft}
 onChange={e => setDraft(e.target.value)}
 onKeyDown={e => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), canSend && sendMessage())}
 />
 <div className="absolute right-3 bottom-3 flex items-center gap-2">
 <Button variant="ghost" size="icon" className="size-8 rounded-none text-muted-foreground hover:text-foreground opacity-50 hover:opacity-100" onClick={() => fileInputRef.current?.click()}><Paperclip className="size-4" weight="bold" /></Button>
 <input ref={fileInputRef} type="file" multiple className="hidden" onChange={async e => {
 const files = Array.from(e.target.files || []);
 const next = await Promise.all(files.filter(f => f.type.startsWith('image/')).map(async f => ({ id: createId(), name: f.name, type: f.type, dataUrl: await fileToDataUrl(f) })));
 setAttachments(p => [...p, ...next]); e.target.value = "";
 }} />
 <Button 
 size="icon"
 className={cn("size-9 rounded-none shadow-none transition-all", canSend ? "bg-primary text-primary-foreground" : "bg-muted border border-border/50 text-muted-foreground/30")} 
 onClick={isSending ? () => abortRef.current?.abort() : sendMessage}
 disabled={!canSend && !isSending}
 >
 {isSending ? <StopCircle className="size-5 animate-pulse" weight="fill" /> : <ArrowUp className="size-5" weight="bold" />}
 </Button>
 </div>
 </div>
 <div className="flex items-center justify-center gap-4 py-4 opacity-30">
 <span className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground">Infrastructure Node v0.3.96</span>
 <span className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground">Real-time Telemetry</span>
 </div>
 </div>
 </footer>
 </div>
 );
}
