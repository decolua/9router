"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Card, Badge, Button, Input } from "@/shared/components";
import ProviderIcon from "@/shared/components/ProviderIcon";
import { MEDIA_PROVIDER_KINDS, AI_PROVIDERS, getProviderAlias } from "@/shared/constants/providers";
import { getModelsByProviderId } from "@/shared/constants/models";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import ConnectionsCard from "@/app/(dashboard)/dashboard/providers/components/ConnectionsCard";
import ModelsCard from "@/app/(dashboard)/dashboard/providers/components/ModelsCard";
import { TTS_PROVIDER_CONFIG } from "@/shared/constants/ttsProviders";
import { getTtsVoicesForModel } from "@/lib/open-sse/config/ttsModels";
import { 
  ArrowLeft, 
  Play, 
  Check, 
  Copy, 
  Download, 
  ArrowsClockwise as RefreshCw, 
  WifiHigh as WifiTetheringIcon,
  X,
  SpeakerHigh,
  Globe,
  Monitor,
  CheckCircle
} from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { translate } from "@/i18n/runtime";

interface RowProps {
  label: string;
  children: React.ReactNode;
}

function Row({ label, children }: RowProps) {
 return (
 <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-6 py-1.5">
 <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground opacity-60 w-32 shrink-0">{label}</span>
 <div className="flex-1 min-w-0">{children}</div>
 </div>
 );
}

const DEFAULT_TTS_RESPONSE_EXAMPLE = `// Audio binary stream or base64 JSON response.
{
  "format": "mp3",
  "audio": "//NExAANaAIIAUAAANNNN..."
}`;

const DEFAULT_RESPONSE_EXAMPLE = `{
  "object": "list",
  "data": [{
    "object": "embedding",
    "index": 0,
    "embedding": [0.0023, -0.0192, 0.0048, ...]
  }],
  "model": "...",
  "usage": { "prompt_tokens": 9, "total_tokens": 9 }
}`;

const KIND_EXAMPLE_CONFIG: Record<string, any> = {
 webSearch: {
 inputLabel: "Query",
 inputPlaceholder: "Latest news about AI...",
 defaultInput: "Latest news about AI?",
 bodyKey: "query",
 defaultResponse: `{\n  "results": [\n    {"title":"...","url":"...","snippet":"..."}\n  ]\n}`,
 },
 webFetch: {
 inputLabel: "Target URL",
 inputPlaceholder: "https://example.com",
 defaultInput: "https://example.com",
 bodyKey: "url",
 defaultResponse: `{\n  "content":"...",\n  "title":"...",\n  "url":"..."\n}`,
 },
 image: {
 inputLabel: "Creative Prompt",
 inputPlaceholder: "A futuristic city in cyberpunk style",
 defaultInput: "A futuristic city in cyberpunk style",
 bodyKey: "prompt",
 defaultResponse: `{\n  "data": [\n    {"url":"...","b64_json":"..."}\n  ]\n}`,
 },
 imageToText: {
 inputLabel: "Visual Asset URL",
 inputPlaceholder: "https://example.com/image.png",
 defaultInput: "https://upload.wikimedia.org/wikipedia/commons/thumb/3/3a/Cat03.jpg/1200px-Cat03.jpg",
 bodyKey: "url",
 extraBody: { prompt: "Analyze this image in depth" },
 defaultResponse: `{\n  "text": "A cat sitting on a windowsill...",\n  "model": "..."\n}`,
 },
 stt: {
 inputLabel: "Audio Stream URL",
 inputPlaceholder: "https://example.com/audio.mp3",
 defaultInput: "",
 bodyKey: "url",
 defaultResponse: `{\n  "text": "Hello world...",\n  "model": "..."\n}`,
 },
};

function EmbeddingExampleCard({ providerId }: { providerId: string }) {
 const providerAlias = getProviderAlias(providerId);
 const embeddingModels = getModelsByProviderId(providerId).filter((m) => m.type === "embedding");

 const [selectedModel, setSelectedModel] = useState(embeddingModels[0]?.id ?? "");
 const [input, setInput] = useState("The quick brown fox jumps over the lazy dog");
 const [apiKey, setApiKey] = useState("");
 const [useTunnel, setUseTunnel] = useState(false);
 const [localEndpoint, setLocalEndpoint] = useState("");
 const [tunnelEndpoint, setTunnelEndpoint] = useState("");
 const [result, setResult] = useState<any>(null);
 const [running, setRunning] = useState(false);
 const [error, setError] = useState("");
 const { copied: copiedCurl, copy: copyCurl } = useCopyToClipboard();
 const { copied: copiedRes, copy: copyRes } = useCopyToClipboard();

 useEffect(() => {
   if (typeof window !== "undefined") {
     setLocalEndpoint(window.location.origin);
   }
 fetch("/api/keys").then((r) => r.json()).then((d) => { setApiKey((d.keys || []).find((k: any) => k.isActive !== false)?.key || ""); }).catch(() => {});
 fetch("/api/tunnel/status").then((r) => r.json()).then((d) => { if (d.publicUrl) setTunnelEndpoint(d.publicUrl); }).catch(() => {});
 }, []);

 const endpoint = useTunnel ? tunnelEndpoint : localEndpoint;
 const modelFull = selectedModel ? `${providerAlias}/${selectedModel}` : "";
 const curlSnippet = `curl -X POST ${endpoint}/v1/embeddings \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer ${apiKey || "YOUR_KEY"}" \\
  -d '{"model":"${modelFull}","input":"${input}"}'`;

 const handleRun = async () => {
 if (!input.trim() || !modelFull) return;
 setRunning(true); setError(""); setResult(null);
 const start = Date.now();
 try {
 const headers: Record<string, string> = { "Content-Type": "application/json" };
 if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
 const res = await fetch("/api/v1/embeddings", { method: "POST", headers, body: JSON.stringify({ model: modelFull, input: input.trim() }) });
 const latencyMs = Date.now() - start;
 const data = await res.json();
 if (!res.ok) { setError(data?.error?.message || data?.error || `HTTP ${res.status}`); return; }
 setResult({ data, latencyMs });
 } catch (e: any) { setError(e.message || "Network error"); } finally { setRunning(false); }
 };

 const formatResultJson = (data: any) => {
 if (!data) return DEFAULT_RESPONSE_EXAMPLE;
 const clone = JSON.parse(JSON.stringify(data));
 (clone.data || []).forEach((item: any) => {
 if (Array.isArray(item.embedding) && item.embedding.length > 4) {
 item.embedding = [...item.embedding.slice(0, 4).map((v: number) => parseFloat(v.toFixed(6))), `... (${item.embedding.length} dims)`];
 }
 });
 return JSON.stringify(clone, null, 2);
 };

 const resultJson = result ? JSON.stringify(result.data, null, 2) : "";

 return (
 <Card className="p-6 border-border/50 bg-background/50 rounded-none shadow-none">
 <div className="flex items-center gap-2 mb-6">
 <Globe className="size-4 text-primary" weight="bold" />
 <h2 className="text-sm font-bold uppercase tracking-widest text-foreground">Interactive Explorer</h2>
 </div>

 <div className="flex flex-col gap-6">
 <div className="space-y-4">
 <Row label="Node Model">
 <select
 value={selectedModel}
 onChange={(e) => setSelectedModel(e.target.value)}
 className="w-full h-9 px-3 text-xs font-bold bg-muted/10 border border-border/50 rounded-none focus:outline-none focus:border-primary/50 transition-colors uppercase tracking-tight"
 >
 {embeddingModels.map((m) => (
 <option key={m.id} value={m.id}>{m.name || m.id}</option>
 ))}
 </select>
 </Row>

 <Row label="Gateway Node">
 <div className="flex items-center gap-2">
 <Input
 value={endpoint}
 readOnly
 className="flex-1 h-9 font-mono text-[11px] bg-muted/5 border-border/50 rounded-none opacity-60 tabular-nums"
 />
 {tunnelEndpoint && (
 <button
 onClick={() => setUseTunnel((v) => !v)}
 className={cn(
 "flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest px-3 py-1.5 rounded-none border transition-all h-9 shrink-0",
 useTunnel ? "bg-primary/10 border-primary/30 text-primary" : "bg-muted/10 border-border/50 text-muted-foreground opacity-60 hover:opacity-100"
 )}
 >
 <WifiTetheringIcon className="size-3.5" weight="bold" />
 Tunnel
 </button>
 )}
 </div>
 </Row>

 <Row label="Access Key">
 <Input
 type="password"
 value={apiKey}
 onChange={(e) => setApiKey(e.target.value)}
 placeholder="Establish connection key..."
 className="w-full h-9 font-mono text-[11px] bg-muted/5 border-border/50 rounded-none"
 />
 </Row>

 <Row label="Input Payload">
 <div className="relative group">
 <Input
 value={input}
 onChange={(e) => setInput(e.target.value)}
 className="w-full h-9 pr-10 text-sm bg-background border-border/60 rounded-none focus-visible:ring-0 focus-visible:border-primary/50 transition-all font-medium"
 />
 {input && (
 <button
 type="button"
 onClick={() => setInput("")}
 className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground opacity-40 hover:opacity-100 transition-opacity"
 >
 <X className="size-4" weight="bold" />
 </button>
 )}
 </div>
 </Row>
 </div>

 <div className="space-y-3">
 <div className="flex items-center justify-between px-1">
 <span className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground opacity-40">Shell Manifest (cURL)</span>
 <div className="flex items-center gap-2">
 <Button
 variant="ghost"
 size="sm"
 onClick={() => copyCurl(curlSnippet)}
 className="h-7 text-[10px] font-bold uppercase tracking-widest hover:bg-muted/50"
 >
 {copiedCurl ? <Check className="size-3.5 text-emerald-500 mr-1.5" weight="bold" /> : <Copy className="size-3.5 mr-1.5" weight="bold" />}
 {copiedCurl ? "Copied" : "Copy Source"}
 </Button>
 <Button
 onClick={handleRun}
 disabled={running || !input.trim() || !modelFull}
 className="h-7 px-4 rounded-none bg-primary text-white text-[10px] font-black uppercase tracking-[0.2em] shadow-none"
 >
 {running ? <RefreshCw className="size-3.5 animate-spin mr-1.5" weight="bold" /> : <Play className="size-3.5 mr-1.5" weight="fill" />}
 {running ? "Executing..." : "Execute"}
 </Button>
 </div>
 </div>
 <pre className="bg-black/90 p-4 rounded-none text-[11px] font-mono text-primary/80 border border-white/5 overflow-x-auto whitespace-pre leading-relaxed shadow-inner">{curlSnippet}</pre>
 </div>

 {error && (
 <div className="p-3 bg-destructive/5 border border-destructive/20 rounded-none flex items-start gap-2">
 <X className="size-4 text-destructive mt-0.5" weight="bold" />
 <p className="text-xs font-bold text-destructive uppercase tracking-wide leading-tight">{error}</p>
 </div>
 )}

 <div className="space-y-3 border-t border-border/40 pt-6">
 <div className="flex items-center justify-between px-1">
 <span className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground opacity-40">
 Telemetry Response {result && <span className="text-primary opacity-100 ml-2">· {result.latencyMs}ms LATENCY</span>}
 </span>
 {result && (
 <Button
 variant="ghost"
 size="sm"
 onClick={() => copyRes(resultJson)}
 className="h-7 text-[10px] font-bold uppercase tracking-widest hover:bg-muted/50"
 >
 {copiedRes ? <Check className="size-3.5 text-emerald-500 mr-1.5" weight="bold" /> : <Copy className="size-3.5 mr-1.5" weight="bold" />}
 {copiedRes ? "Copied" : "Copy JSON"}
 </Button>
 )}
 </div>
 <pre className="bg-muted/10 p-4 rounded-none text-[11px] font-mono text-foreground/70 border border-border/40 overflow-x-auto whitespace-pre leading-relaxed shadow-inner italic">
 {formatResultJson(result?.data)}
 </pre>
 </div>
 </div>
 </Card>
 );
}

// TTS Card
function TtsExampleCard({ providerId }: { providerId: string }) {
 const providerAlias = getProviderAlias(providerId);
 const config = (TTS_PROVIDER_CONFIG as any)[providerId] || TTS_PROVIDER_CONFIG["edge-tts"];

 const [selectedVoice, setSelectedVoice] = useState("");
 // eslint-disable-next-line @typescript-eslint/no-unused-vars
 const [selectedVoiceName, setSelectedVoiceName] = useState("");
 const [voiceId, setVoiceId] = useState("");
 const [countryVoices, setCountryVoices] = useState<any[]>([]);
 const [selectedLang, setSelectedLang] = useState("");
 const [selectedModel, setSelectedModel] = useState(() => {
 if (config.hasModelSelector && config.modelKey) {
 const models = getModelsByProviderId(config.modelKey);
 return models?.[0]?.id || "";
 }
 return "";
 });

 const [input, setInput] = useState("Hello, this is a text to speech test from the edge.");
 const [apiKey, setApiKey] = useState("");
 const [useTunnel, setUseTunnel] = useState(false);
 const [localEndpoint, setLocalEndpoint] = useState("");
 const [tunnelEndpoint, setTunnelEndpoint] = useState("");
 const [responseFormat, setResponseFormat] = useState("mp3");
 const [audioUrl, setAudioUrl] = useState("");
 const [jsonResponse, setJsonResponse] = useState<any>(null);
 const [running, setRunning] = useState(false);
 const [error, setError] = useState("");
 const [latency, setLatency] = useState<number | null>(null);
 const { copied: copiedCurl, copy: copyCurl } = useCopyToClipboard();

 const [modalOpen, setModalOpen] = useState(false);
 const [languages, setLanguages] = useState<any[]>([]);
 const [modalLoading, setModalLoading] = useState(false);
 const [modalSearch, setModalSearch] = useState("");
 // eslint-disable-next-line @typescript-eslint/no-unused-vars
 const [modalError, setModalError] = useState("");
 const [byLang, setByLang] = useState<Record<string, any>>({});

 useEffect(() => {
   if (typeof window !== "undefined") {
     setLocalEndpoint(window.location.origin);
   }
 fetch("/api/keys").then((r) => r.json()).then((d) => { setApiKey((d.keys || []).find((k: any) => k.isActive !== false)?.key || ""); }).catch(() => {});
 fetch("/api/tunnel/status").then((r) => r.json()).then((d) => { if (d.publicUrl) setTunnelEndpoint(d.publicUrl); }).catch(() => {});

 if (config.voiceSource === "hardcoded") {
 const defaultModel = config.hasModelSelector && config.modelKey ? (getModelsByProviderId(config.modelKey)?.[0]?.id || "") : "";
 const voices = (config.voicesPerModel && defaultModel) ? (getTtsVoicesForModel(providerId, defaultModel) || []) : getModelsByProviderId(config.voiceKey || providerId).filter((m) => m.type === "tts");
 if (voices.length) {
 if (config.hasBrowseButton) {
 const defaultVoice = voices.find((v: any) => v.id === "en") || voices[0];
 setSelectedLang(defaultVoice.id); setSelectedVoice(defaultVoice.id); setSelectedVoiceName(defaultVoice.name);
 setCountryVoices([{ id: defaultVoice.id, name: defaultVoice.name }]);
 } else {
 setCountryVoices(voices); setSelectedVoice(voices[0].id); setSelectedVoiceName(voices[0].name || voices[0].id);
 }
 }
 }
 }, [providerId, config]);

 useEffect(() => {
 if (!config.voicesPerModel || !selectedModel) return;
 const voices = getTtsVoicesForModel(providerId, selectedModel) || [];
 setCountryVoices(voices);
 if (voices.length) {
 setSelectedVoice(voices[0].id); setSelectedVoiceName(voices[0].name || voices[0].id);
 }
 }, [selectedModel, providerId, config]);

 const openModal = async () => {
 setModalOpen(true); setModalSearch(""); setModalError("");
 if (languages.length) return;
 setModalLoading(true);
 try {
 if (config.voiceSource === "hardcoded") {
 const voiceKey = config.voiceKey || providerId;
 const voices = getModelsByProviderId(voiceKey).filter((m) => m.type === "tts");
 const byLangMap: Record<string, any> = {};
 for (const v of voices) { if (!byLangMap[v.id]) byLangMap[v.id] = { code: v.id, name: v.name, voices: [{ id: v.id, name: v.name }] }; }
 setByLang(byLangMap); setLanguages(Object.values(byLangMap).sort((a, b) => a.name.localeCompare(b.name)));
 } else {
 const url = config.apiEndpoint || `/api/media-providers/tts/voices?provider=${providerId === "local-device" ? "local-device" : "edge-tts"}`;
 const r = await fetch(url); const d = await r.json();
 if (d.error) { setModalError(d.error); return; }
 setLanguages(d.languages || []); setByLang(d.byLang || {});
 }
 } catch (e: any) { setModalError(e.message); } finally { setModalLoading(false); }
 };

 const handlePickLanguage = (lang: any) => {
 setModalOpen(false); setSelectedLang(lang.code);
 const voices = byLang[lang.code]?.voices || [];
 setCountryVoices(voices);
 if (voices.length) {
 setSelectedVoice(voices[0].id); setSelectedVoiceName(voices[0].name);
 if (config.hasVoiceIdInput) setVoiceId(voices[0].id);
 }
 };

 const filteredLanguages = modalSearch ? languages.filter((c) => c.name.toLowerCase().includes(modalSearch.toLowerCase()) || c.code.toLowerCase().includes(modalSearch.toLowerCase())) : languages;
 const endpoint = useTunnel ? tunnelEndpoint : localEndpoint;
 const activeVoiceId = config.hasVoiceIdInput ? voiceId : selectedVoice;
 const modelFull = config.hasModelSelector && activeVoiceId && selectedModel ? `${providerAlias}/${selectedModel}/${activeVoiceId}` : activeVoiceId ? `${providerAlias}/${activeVoiceId}` : "";

 const curlSnippet = `curl -X POST ${endpoint}/v1/audio/speech${response_format_json_suffix(responseFormat)} \\
 -H "Content-Type: application/json" \\
 -H "Authorization: Bearer ${apiKey || "YOUR_KEY"}" \\
 -d '{"model":"${modelFull}","input":"${input}"}' \\
 ${responseFormat === "json" ? "" : "--output speech.mp3"}`;

 function response_format_json_suffix(fmt: string) {
     return fmt === "json" ? "?response_format=json" : "";
 }

 const handleRun = async () => {
 if (!input.trim() || !modelFull) return;
 setRunning(true); setError(""); setAudioUrl(""); setJsonResponse(null);
 const start = Date.now();
 try {
 const headers = { "Content-Type": "application/json" };
 if (apiKey) (headers as any)["Authorization"] = `Bearer ${apiKey}`;
 const url = `/api/v1/audio/speech${responseFormat === "json" ? "?response_format=json" : ""}`;
 const res = await fetch(url, { method: "POST", headers, body: JSON.stringify({ model: modelFull, input: input.trim() }) });
 setLatency(Date.now() - start);
 if (!res.ok) { const d = await res.json().catch(() => ({})); setError(d?.error?.message || d?.error || `HTTP ${res.status}`); return; }
 if (responseFormat === "json") {
 const data = await res.json(); setJsonResponse(data);
 const audioBlob = await fetch(`data:audio/mp3;base64,${data.audio}`).then(r => r.blob());
 setAudioUrl(URL.createObjectURL(audioBlob));
 } else {
 const blob = await res.blob(); setAudioUrl(URL.createObjectURL(blob));
 }
 } catch (e: any) { setError(e.message || "Network error"); } finally { setRunning(false); }
 };

 return (
 <>
 <Card className="p-6 border-border/50 bg-background/50 rounded-none shadow-none">
 <div className="flex items-center gap-2 mb-6">
 <SpeakerHigh className="size-4 text-primary" weight="bold" />
 <h2 className="text-sm font-bold uppercase tracking-widest text-foreground">Acoustic Synthesis</h2>
 </div>

 <div className="flex flex-col gap-6">
 <div className="space-y-4">
 <Row label="Node Model">
 <div className="flex flex-col gap-2">
 {config.hasModelSelector && config.modelKey && (
 <select value={selectedModel} onChange={(e) => setSelectedModel(e.target.value)} className="w-full h-9 px-3 text-xs font-bold bg-muted/10 border border-border/50 rounded-none focus:outline-none focus:border-primary/50 uppercase tracking-tight">
 {(getModelsByProviderId(config.modelKey) || []).map((m) => (<option key={m.id} value={m.id}>{m.name || m.id}</option>))}
 </select>
 )}
 <div className="flex items-center gap-2">
 {config.hasBrowseButton && (
 <button onClick={openModal} className="flex-1 h-9 px-3 text-xs font-bold border border-border/50 rounded-none bg-muted/10 font-mono truncate text-left hover:border-primary/50 transition-colors uppercase tabular-nums">
 {selectedLang ? (languages.find((l) => l.code === selectedLang)?.name || selectedLang) : "Select Spectrum"}
 </button>
 )}
 {config.hasVoiceIdInput && (
 <Input value={voiceId} onChange={(e) => { setVoiceId(e.target.value); setSelectedVoice(e.target.value); }} placeholder="Custom Voice Vector..." className="flex-1 h-9 font-mono text-[11px] bg-muted/5 border-border/50 rounded-none" />
 )}
 </div>
 </div>
 </Row>

 {countryVoices.length > 0 && (
 <Row label="Vocal Identity">
 <div className="flex flex-wrap gap-1.5">
 {countryVoices.map((v) => (
 <button key={v.id} onClick={() => { setSelectedVoice(v.id); setSelectedVoiceName(v.name); if (config.hasVoiceIdInput) setVoiceId(v.id); }} className={cn("px-2.5 py-1 rounded-none text-[10px] border font-bold uppercase tracking-widest transition-all", selectedVoice === v.id ? "bg-primary text-primary-foreground border-primary shadow-lg shadow-primary/20" : "bg-muted/10 border-border/50 text-muted-foreground opacity-60 hover:opacity-100 hover:border-border")}>
 {v.name}{v.gender ? ` · ${v.gender[0].toUpperCase()}` : ""}
 </button>
 ))}
 </div>
 </Row>
 )}

 <Row label="Input Payload">
 <div className="relative group">
 <Input value={input} onChange={(e) => setInput(e.target.value)} className="w-full h-9 pr-10 text-sm bg-background border-border/60 rounded-none focus-visible:ring-0 focus-visible:border-primary/50 transition-all font-medium" />
 {input && (<button type="button" onClick={() => setInput("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground opacity-40 hover:opacity-100"><X className="size-4" weight="bold" /></button>)}
 </div>
 </Row>

 <Row label="Stream Format">
 <select value={responseFormat} onChange={(e) => setResponseFormat(e.target.value)} className="w-full h-9 px-3 text-[10px] font-bold uppercase tracking-widest bg-muted/10 border border-border/50 rounded-none focus:outline-none focus:border-primary/50">
 <option value="mp3">Binary Octet (MP3)</option>
 <option value="json">Base64 Descriptor (JSON)</option>
 </select>
 </Row>
 </div>

 <div className="space-y-3">
 <div className="flex items-center justify-between px-1">
 <span className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground opacity-40">Shell Manifest</span>
 <div className="flex items-center gap-2">
 <Button variant="ghost" size="sm" onClick={() => copyCurl(curlSnippet)} className="h-7 text-[10px] font-bold uppercase tracking-widest hover:bg-muted/50">{copiedCurl ? <Check className="size-3.5 text-emerald-500 mr-1.5" weight="bold" /> : <Copy className="size-3.5 mr-1.5" weight="bold" />}{copiedCurl ? "Copied" : "Copy Source"}</Button>
 <Button onClick={handleRun} disabled={running || !input.trim() || !modelFull} className="h-7 px-4 rounded-none bg-primary text-white text-[10px] font-black uppercase tracking-[0.2em] shadow-none">{running ? <RefreshCw className="size-3.5 animate-spin mr-1.5" weight="bold" /> : <Play className="size-3.5 mr-1.5" weight="fill" />}{running ? "Synthesizing..." : "Execute"}</Button>
 </div>
 </div>
 <pre className="bg-black/90 p-4 rounded-none text-[11px] font-mono text-primary/80 border border-white/5 overflow-x-auto whitespace-pre leading-relaxed shadow-inner">{curlSnippet}</pre>
 </div>

 {error && (<div className="p-3 bg-destructive/5 border border-destructive/20 rounded-none flex items-start gap-2"><X className="size-4 text-destructive mt-0.5" weight="bold" /><p className="text-xs font-bold text-destructive uppercase tracking-wide leading-tight">{error}</p></div>)}

 <div className="space-y-3 border-t border-border/40 pt-6">
 <span className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground opacity-40 px-1">Acoustic Output {latency && <span className="text-primary opacity-100 ml-2">· {latency}ms SYNTHESIS</span>}</span>
 {audioUrl ? (
 <div className="flex flex-col gap-4">
 <audio controls src={audioUrl} className="w-full h-10 shadow-none border border-border/40 bg-muted/5 rounded-none" />
 <div className="flex gap-2">
 <a href={audioUrl} download="synthesis.mp3" className="flex-1 h-9 inline-flex items-center justify-center gap-2 text-[10px] font-bold uppercase tracking-widest border border-border/50 bg-background hover:bg-muted/30 transition-all rounded-none"><Download className="size-4" weight="bold" /> Download Stream</a>
 </div>
 {jsonResponse && (
 <div className="space-y-2">
 <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground opacity-40 px-1">JSON Buffer</span>
 <pre className="bg-muted/10 p-4 rounded-none text-[11px] font-mono text-foreground/70 border border-border/40 overflow-x-auto whitespace-pre leading-relaxed shadow-inner italic">{JSON.stringify({ format: jsonResponse.format, audio: jsonResponse.audio ? `${jsonResponse.audio.substring(0, 80)}...` : "" }, null, 2)}</pre>
 </div>
 )}
 </div>
 ) : (<pre className="bg-muted/10 p-4 rounded-none text-[11px] font-mono text-muted-foreground opacity-30 border border-border/40 overflow-x-auto whitespace-pre leading-relaxed shadow-inner italic">{DEFAULT_TTS_RESPONSE_EXAMPLE}</pre>)}
 </div>
 </div>
 </Card>

 {modalOpen && (
 <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200" onClick={() => setModalOpen(false)}>
 <div className="bg-background border border-border/50 rounded-none w-full max-w-sm mx-4 flex flex-col max-h-[80vh] shadow-2xl scale-100 animate-in zoom-in-95 duration-200" onClick={(e) => e.stopPropagation()}>
 <div className="flex items-center justify-between px-5 py-4 border-b border-border/50 bg-muted/5 shrink-0"><h3 className="text-xs font-bold uppercase tracking-widest text-foreground">Select Voice Spectrum</h3><button onClick={() => setModalOpen(false)} className="text-muted-foreground hover:text-foreground transition-colors"><X className="size-4" weight="bold" /></button></div>
 <div className="px-5 py-3 border-b border-border/50 bg-muted/10 shrink-0"><Input autoFocus value={modalSearch} onChange={(e) => setModalSearch(e.target.value)} placeholder="Filter locales..." className="h-9 text-xs font-bold uppercase tracking-tight rounded-none border-border/50 bg-background" /></div>
 <div className="overflow-y-auto flex-1 p-2 custom-scrollbar">
 {modalLoading ? (<p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground opacity-40 p-4 text-center animate-pulse">Syncing catalog...</p>) : (
 <div className="flex flex-col gap-0.5">
 {filteredLanguages.map((c) => (<button key={c.code} onClick={() => handlePickLanguage(c)} className={cn("flex items-center justify-between w-full px-4 py-2.5 rounded-none text-left transition-colors border border-transparent", selectedLang === c.code ? "bg-primary/10 border-primary/20" : "hover:bg-muted/40")}>
 <span className="text-xs font-bold uppercase tracking-tight text-foreground">{c.name}</span>
 <div className="flex items-center gap-3 shrink-0"><span className="text-[10px] font-medium text-muted-foreground opacity-60 tabular-nums">{c.voices.length} VOICES</span>{selectedLang === c.code && (<Check className="size-3.5 text-primary" weight="bold" />)}</div>
 </button>))}
 </div>
 )}
 </div>
 </div>
 </div>
 )}
 </>
 );
}

// Generic Example Card
function GenericExampleCard({ providerId, kind }: { providerId: string, kind: string }) {
 const providerAlias = getProviderAlias(providerId);
 const kindConfig = MEDIA_PROVIDER_KINDS.find((k) => k.id === kind);
 const exConfig = KIND_EXAMPLE_CONFIG[kind];
 if (!kindConfig || !exConfig) return null;

 const [input, setInput] = useState(exConfig.defaultInput);
 const [apiKey, setApiKey] = useState("");
 const [useTunnel, setUseTunnel] = useState(false);
 const [localEndpoint, setLocalEndpoint] = useState("");
 const [tunnelEndpoint, setTunnelEndpoint] = useState("");
 const [result, setResult] = useState<any>(null);
 const [running, setRunning] = useState(false);
 const [error, setError] = useState("");
 const { copied: copiedCurl, copy: copyCurl } = useCopyToClipboard();
 const { copied: copiedRes, copy: copyRes } = useCopyToClipboard();

 useEffect(() => {
   if (typeof window !== "undefined") {
     setLocalEndpoint(window.location.origin);
   }
 fetch("/api/keys").then((r) => r.json()).then((d) => { setApiKey((d.keys || []).find((k: any) => k.isActive !== false)?.key || ""); }).catch(() => {});
 fetch("/api/tunnel/status").then((r) => r.json()).then((d) => { if (d.publicUrl) setTunnelEndpoint(d.publicUrl); }).catch(() => {});
 }, []);

 const endpoint = useTunnel ? tunnelEndpoint : localEndpoint;
 const apiPath = kindConfig.endpoint.path;
 const requestBody = { model: `${providerAlias}/model-name`, [exConfig.bodyKey]: input, ...exConfig.extraBody };
 const curlSnippet = `curl -X ${kindConfig.endpoint.method} ${endpoint}${apiPath} \\
 -H "Content-Type: application/json" \\
 -H "Authorization: Bearer ${apiKey || "YOUR_KEY"}" \\
 -d '${JSON.stringify(requestBody)}'`;

 const handleRun = async () => {
 if (!input.trim()) return;
 setRunning(true); setError(""); setResult(null);
 const start = Date.now();
 try {
 const headers = { "Content-Type": "application/json" };
 if (apiKey) (headers as any)["Authorization"] = `Bearer ${apiKey}`;
 const body = { ...requestBody, model: `${providerAlias}/model-name` };
 const res = await fetch(`/api${apiPath}`, { method: kindConfig.endpoint.method, headers, body: JSON.stringify(body) });
 const latencyMs = Date.now() - start;
 const data = await res.json();
 if (!res.ok) { setError(data?.error?.message || data?.error || `HTTP ${res.status}`); return; }
 setResult({ data, latencyMs });
 } catch (e: any) { setError(e.message || "Network error"); } finally { setRunning(false); }
 };

 const resultJson = result ? JSON.stringify(result.data, null, 2) : "";

 return (
 <Card className="p-6 border-border/50 bg-background/50 rounded-none shadow-none">
 <div className="flex items-center gap-2 mb-6">
 <Monitor className="size-4 text-primary" weight="bold" />
 <h2 className="text-sm font-bold uppercase tracking-widest text-foreground">Interactive Explorer</h2>
 </div>
 <div className="flex flex-col gap-6">
 <div className="space-y-4">
 <Row label="Gateway Node">
 <div className="flex items-center gap-2">
 <Input value={endpoint} readOnly className="flex-1 h-9 font-mono text-[11px] bg-muted/5 border-border/50 rounded-none opacity-60 tabular-nums" />
 {tunnelEndpoint && (
 <button onClick={() => setUseTunnel((v) => !v)} className={cn("flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest px-3 py-1.5 rounded-none border transition-all h-9 shrink-0", useTunnel ? "bg-primary/10 border-primary/30 text-primary" : "bg-muted/10 border-border/50 text-muted-foreground opacity-60 hover:opacity-100")}>
 <WifiTetheringIcon className="size-3.5" weight="bold" /> Tunnel
 </button>
 )}
 </div>
 </Row>
 <Row label="Access Key">
 <Input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="Establish key..." className="w-full h-9 font-mono text-[11px] bg-muted/5 border-border/50 rounded-none" />
 </Row>
 <Row label={exConfig.inputLabel}>
 <div className="relative group">
 <Input value={input} onChange={(e) => setInput(e.target.value)} placeholder={exConfig.inputPlaceholder} className="w-full h-9 pr-10 text-sm bg-background border-border/60 rounded-none focus-visible:ring-0 focus-visible:border-primary/50 transition-all font-medium" />
 {input && (<button type="button" onClick={() => setInput("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground opacity-40 hover:opacity-100"><X className="size-4" weight="bold" /></button>)}
 </div>
 </Row>
 </div>

 <div className="space-y-3">
 <div className="flex items-center justify-between px-1"><span className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground opacity-40">Shell Manifest</span><div className="flex items-center gap-2"><Button variant="ghost" size="sm" onClick={() => copyCurl(curlSnippet)} className="h-7 text-[10px] font-bold uppercase tracking-widest hover:bg-muted/50">{copiedCurl ? <Check className="size-3.5 text-emerald-500 mr-1.5" weight="bold" /> : <Copy className="size-3.5 mr-1.5" weight="bold" />}{copiedCurl ? "Copied" : "Copy Source"}</Button><Button onClick={handleRun} disabled={running || !input.trim()} className="h-7 px-4 rounded-none bg-primary text-white text-[10px] font-black uppercase tracking-[0.2em] shadow-none">{running ? <RefreshCw className="size-3.5 animate-spin mr-1.5" weight="bold" /> : <Play className="size-3.5 mr-1.5" weight="fill" />}{running ? "Executing..." : "Execute"}</Button></div></div>
 <pre className="bg-black/90 p-4 rounded-none text-[11px] font-mono text-primary/80 border border-white/5 overflow-x-auto whitespace-pre leading-relaxed shadow-inner">{curlSnippet}</pre>
 </div>

 {error && (<div className="p-3 bg-destructive/5 border border-destructive/20 rounded-none flex items-start gap-2"><X className="size-4 text-destructive mt-0.5" weight="bold" /><p className="text-xs font-bold text-destructive uppercase tracking-wide leading-tight">{error}</p></div>)}

 <div className="space-y-3 border-t border-border/40 pt-6"><div className="flex items-center justify-between px-1"><span className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground opacity-40">Telemetry Response {result && <span className="text-primary opacity-100 ml-2">· {result.latencyMs}ms LATENCY</span>}</span>{result && (<Button variant="ghost" size="sm" onClick={() => copyRes(resultJson)} className="h-7 text-[10px] font-bold uppercase tracking-widest hover:bg-muted/50">{copiedRes ? <Check className="size-3.5 text-emerald-500 mr-1.5" weight="bold" /> : <Copy className="size-3.5 mr-1.5" weight="bold" />}{copiedRes ? "Copied" : "Copy JSON"}</Button>)}</div><pre className="bg-muted/10 p-4 rounded-none text-[11px] font-mono text-foreground/70 border border-border/40 overflow-x-auto whitespace-pre leading-relaxed shadow-inner italic">{result ? resultJson : exConfig.defaultResponse}</pre></div>
 </div>
 </Card>
 );
}

export default function MediaProviderDetailPage({ kind, providerId }: { kind: string, providerId: string }) {
 const kindConfig = MEDIA_PROVIDER_KINDS.find((k) => k.id === kind);
 if (!kindConfig) return notFound();

 const provider = (AI_PROVIDERS as any)[providerId];
 if (!provider) return notFound();

 const kinds = provider.serviceKinds ?? ["llm"];
 if (!kinds.includes(kind)) return notFound();

 return (
 <div className="mx-auto max-w-5xl flex flex-col gap-6 py-4 px-4 pb-12">
 {/* Back and Header */}
 <header className="flex flex-col gap-3 pb-6 border-b border-border/50">
 <Link href={`/dashboard/media-providers/${kind}`} className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors group">
 <ArrowLeft className="size-3.5 group-hover:-translate-x-0.5 transition-transform" weight="bold" />
 {kindConfig.label} Registry
 </Link>

 <div className="flex items-center gap-5 mt-2">
 <div className="size-14 rounded-none flex items-center justify-center shrink-0 border border-border/50 bg-muted/5 shadow-none" style={{ backgroundColor: `${provider.color}08` }}>
 <ProviderIcon src={`/providers/${provider.id}.png`} alt={provider.name} size={36} className={cn("object-contain", (provider.id === "codex" || provider.id === "openai" || provider.id === "github") && "dark:invert")} fallbackText={provider.textIcon || provider.id.slice(0, 2).toUpperCase()} fallbackColor={provider.color} />
 </div>
 <div className="flex flex-col gap-0.5">
 <h1 className="text-2xl font-bold tracking-tight uppercase leading-none">{provider.name}</h1>
 <div className="flex items-center gap-2 mt-1.5">
 {kinds.map((k: string) => (<Badge key={k} variant="outline" className={cn("h-4 px-1.5 text-[9px] font-bold uppercase border-none rounded-none tracking-widest", k === kind ? "bg-primary/10 text-primary" : "bg-muted/40 text-muted-foreground/60")}>{k}</Badge>))}
 </div>
 </div>
 </div>
 </header>

 <div className="grid grid-cols-1 gap-8">
 {/* Infrastructure Connections */}
 <div className="space-y-4">
 <div className="flex items-center gap-2 px-1"><span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground opacity-40">Infrastructure Gateway</span><div className="h-px flex-1 bg-border/40"></div></div>
 {provider.noAuth ? (
 <Card className="p-4 border-primary/20 bg-primary/5 rounded-none shadow-none"><div className="flex items-center gap-4"><div className="size-10 rounded-none bg-primary/10 text-primary border border-primary/20 flex items-center justify-center shrink-0"><CheckCircle className="size-6" weight="bold" /></div><div className="min-w-0"><p className="text-sm font-bold uppercase tracking-tight text-foreground">Stateless Protocol Active</p><p className="text-xs text-muted-foreground font-medium italic opacity-70">This infrastructure provider requires no authentication and is ready for traffic.</p></div></div></Card>
 ) : (<ConnectionsCard providerId={providerId} isOAuth={false} />)}
 </div>

 {/* Models Registry - for non-tts */}
 {kind !== "tts" && (
 <div className="space-y-4">
 <div className="flex items-center gap-2 px-1"><span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground opacity-40">Intelligence Catalog</span><div className="h-px flex-1 bg-border/40"></div></div>
 <ModelsCard providerId={providerId} kindFilter={kind} />
 </div>
 )}

 {/* Dynamic Playground */}
 <div className="space-y-4">
 <div className="flex items-center gap-2 px-1"><span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground opacity-40">Spectrum Analysis & Validation</span><div className="h-px flex-1 bg-border/40"></div></div>
 {kind === "embedding" && <EmbeddingExampleCard providerId={providerId} />}
 {kind === "tts" && <TtsExampleCard providerId={providerId} />}
 {KIND_EXAMPLE_CONFIG[kind] && <GenericExampleCard providerId={providerId} kind={kind} />}
 </div>
 </div>
 </div>
 );
}
