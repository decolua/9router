"use client";

import React, { useState } from "react";
import { 
  ArrowRight, 
  PaperPlaneTilt, 
  CaretDown, 
  CaretRight, 
  FolderOpen, 
  Code, 
  Copy 
} from "@phosphor-icons/react";
import { Card, Button } from "@/shared/components";
import dynamic from "next/dynamic";

const Editor = dynamic(() => import("@monaco-editor/react"), { ssr: false });

interface Step {
  id: number;
  label: string;
  file: string;
  lang: string;
  desc: string;
}

const STEPS: Step[] = [
 { id: 1, label: "Client Request", file: "1_req_client.json", lang: "json", desc: "Raw request from client" },
 { id: 2, label: "Source Body", file: "2_req_source.json", lang: "json", desc: "After initial conversion" },
 { id: 3, label: "OpenAI Intermediate", file: "3_req_openai.json", lang: "json", desc: "source → openai" },
 { id: 4, label: "Target Request", file: "4_req_target.json", lang: "json", desc: "openai → target + URL + headers" },
 { id: 5, label: "Provider Response", file: "5_res_provider.txt", lang: "text", desc: "Raw SSE from provider" },
 { id: 6, label: "OpenAI Response", file: "6_res_openai.txt", lang: "text", desc: "target → openai (response)" },
 { id: 7, label: "Client Response", file: "7_res_client.txt", lang: "text", desc: "Final response to client" },
];

const EDITOR_OPTIONS = {
 minimap: { enabled: false },
 fontSize: 12,
 lineNumbers: "on" as const,
 scrollBeyondLastLine: false,
 wordWrap: "on" as const,
 automaticLayout: true,
};

export default function TranslatorPage() {
 const [contents, setContents] = useState<Record<number, string>>({});
 const [expanded, setExpanded] = useState<Record<number, boolean>>({ 1: true });
 const [loading, setLoading] = useState<Record<string, boolean>>({});
 const [meta, setMeta] = useState<any>(null);

 const setLoad = (key: string, val: boolean) => setLoading(prev => ({ ...prev, [key]: val }));
 const setContent = (id: number, val: string) => setContents(prev => ({ ...prev, [id]: val }));
 const toggle = (id: number) => setExpanded(prev => ({ ...prev, [id]: !prev[id] }));

 const openNext = (nextId: number) => setExpanded(() => {
 const next: Record<number, boolean> = {};
 STEPS.forEach(s => { next[s.id] = false; });
 next[nextId] = true;
 return next;
 });

 const handleLoad = async (stepId: number) => {
 const step = STEPS.find(s => s.id === stepId);
 if (!step) return;
 setLoad(`load-${stepId}`, true);
 try {
 const res = await fetch(`/api/translator/load?file=${step.file}`);
 const data = await res.json();
 if (data.success) {
 setContent(stepId, data.content);
 if (stepId === 1) await detectMeta(data.content);
 } else {
 alert(data.error || "File not found");
 }
 } catch (e: any) {
 alert(e.message);
 }
 setLoad(`load-${stepId}`, false);
 };

 const detectMeta = async (rawContent: string) => {
 try {
 const body = typeof rawContent === "string" ? JSON.parse(rawContent) : rawContent;
 const res = await fetch("/api/translator/translate", {
 method: "POST",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify({ step: 1, body })
 });
 const data = await res.json();
 if (data.success) setMeta(data.result);
 } catch { /* ignore */ }
 };

 const save = (file: string, content: string) => fetch("/api/translator/save", {
 method: "POST",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify({ file, content })
 }).catch(() => {});

 const handleToOpenAI = async () => {
 setLoad("toOpenAI", true);
 try {
 const raw = contents[1];
 if (!raw) return;
 const body = JSON.parse(raw);
 save("1_req_client.json", raw);
 save("2_req_source.json", JSON.stringify({ timestamp: new Date().toISOString(), headers: {}, body: body.body || body }, null, 2));

 const res = await fetch("/api/translator/translate", {
 method: "POST",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify({ step: 2, body })
 });
 const data = await res.json();
 if (!data.success) { alert(data.error); return; }
 const str = JSON.stringify(data.result.body, null, 2);
 setContent(3, str);
 openNext(3);
 } catch (e: any) { alert(e.message); }
 setLoad("toOpenAI", false);
 };

 const handleToTarget = async () => {
 setLoad("toTarget", true);
 try {
 const raw = contents[3];
 if (!raw) return;
 const openaiBody = JSON.parse(raw);
 save("3_req_openai.json", raw);

 const res = await fetch("/api/translator/translate", {
 method: "POST",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify({ step: 3, body: { ...openaiBody, provider: meta?.provider, model: meta?.model } })
 });
 const data = await res.json();
 if (!data.success) { alert(data.error); return; }
 const step4Content = { ...data.result, provider: meta?.provider, model: meta?.model };
 setContent(4, JSON.stringify(step4Content, null, 2));
 openNext(4);
 } catch (e: any) { alert(e.message); }
 setLoad("toTarget", false);
 };

 const handleSend = async () => {
 setLoad("send", true);
 try {
 const raw = contents[4];
 if (!raw) return;
 const step4 = JSON.parse(raw);
 save("4_req_target.json", raw);

 const provider = step4.provider || meta?.provider;
 const model = step4.model || meta?.model;

 if (!provider || !model) {
 alert("Missing provider or model. Please run step 1 first to detect them.");
 return;
 }

 const res = await fetch("/api/translator/send", {
 method: "POST",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify({ provider, model, body: step4.body || step4 })
 });

 if (!res.ok) {
 const err = await res.json().catch(() => ({ error: res.statusText }));
 alert(err.error || "Send failed");
 return;
 }

 const reader = res.body?.getReader();
 if (!reader) return;
 const decoder = new TextDecoder();
 let full = "";
 while (true) {
 const { done, value } = await reader.read();
 if (done) break;
 full += decoder.decode(value, { stream: true });
 }

 setContent(5, full);
 openNext(5);

 await fetch("/api/translator/save", {
 method: "POST",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify({ file: "5_res_provider.txt", content: full })
 });
 } catch (e: any) {
 alert(e.message);
 } finally {
 setLoad("send", false);
 }
 };

 const handleCopy = async (id: number) => {
 if (!contents[id]) return;
 await navigator.clipboard.writeText(contents[id]);
 };

 const handleFormat = (id: number) => {
 try {
 const obj = JSON.parse(contents[id]);
 setContent(id, JSON.stringify(obj, null, 2));
 } catch { /* skip */ }
 };

 return (
 <div className="p-8 space-y-3">
 <div className="flex items-center justify-between mb-2">
 <div>
 <h1 className="text-2xl font-medium text-text-main">Translator Debug</h1>
 <p className="text-sm text-text-muted mt-1">Replay request flow — matches log files</p>
 </div>
 {meta && (
 <div className="flex items-center gap-2 flex-wrap justify-end">
 <MetaBadge label="src" value={meta.sourceFormat} color="blue" />
 <ArrowRight className="size-3.5 text-text-muted" weight="bold" />
 <MetaBadge label="dst" value={meta.targetFormat} color="orange" />
 <MetaBadge label="provider" value={meta.provider} color="green" />
 <MetaBadge label="model" value={meta.model} color="purple" />
 </div>
 )}
 </div>

 {STEPS.map((step) => {
 const isExpanded = !!expanded[step.id];
 const content = contents[step.id] || "";

 return (
 <Card key={step.id}>
 <div className="p-4 space-y-3">
 <div className="flex items-center justify-between">
 <button onClick={() => toggle(step.id)} className="flex items-center gap-2 flex-1 text-left group">
 {isExpanded ? (
   <CaretDown className="size-5 text-text-muted group-hover:text-primary transition-colors" weight="bold" />
 ) : (
   <CaretRight className="size-5 text-text-muted group-hover:text-primary transition-colors" weight="bold" />
 )}
 <span className="text-xs font-mono text-text-muted/60 w-4">{step.id}</span>
 <h3 className="text-sm font-semibold text-text-main">{step.label}</h3>
 <span className="text-xs text-text-muted/60 font-mono">{step.file}</span>
 {content && <span className="text-xs text-primary">({content.length} chars)</span>}
 </button>
 {!isExpanded && (
 <div className="flex gap-1 shrink-0">
 <Button size="sm" variant="ghost" onClick={() => handleLoad(step.id)} loading={loading[`load-${step.id}`]}>Load</Button>
 </div>
 )}
 </div>

 {isExpanded && (
 <>
 <div className="border border-border/50 rounded-lg overflow-hidden">
 <Editor
 height="400px"
 defaultLanguage={step.lang === "text" ? "plaintext" : "json"}
 value={content}
 onChange={(v) => {
 setContent(step.id, v || "");
 if (step.id === 1) detectMeta(v || "");
 }}
 theme="vs-dark"
 options={EDITOR_OPTIONS}
 />
 </div>
 <div className="flex gap-2 flex-wrap">
 <Button size="sm" variant="outline" loading={loading[`load-${step.id}`]} onClick={() => handleLoad(step.id)}>Load</Button>
 <Button size="sm" variant="outline" onClick={() => handleFormat(step.id)}>Format</Button>
 <Button size="sm" variant="outline" onClick={() => handleCopy(step.id)}>Copy</Button>
 {step.id === 1 && <Button size="sm" loading={loading["toOpenAI"]} onClick={handleToOpenAI}>→ OpenAI</Button>}
 {step.id === 3 && <Button size="sm" loading={loading["toTarget"]} onClick={handleToTarget}>→ Target</Button>}
 {step.id === 4 && <Button size="sm" loading={loading["send"]} onClick={handleSend}>Send</Button>}
 </div>
 </>
 )}
 </div>
 </Card>
 );
 })}
 </div>
 );
}

function MetaBadge({ label, value, color }: { label: string, value: string, color: "blue" | "orange" | "green" | "purple" }) {
 const colors = {
 blue: "bg-primary/10 text-primary",
 orange: "bg-muted/30 text-muted-foreground",
 green: "bg-primary/10 text-primary",
 purple: "bg-primary/10 text-primary",
 };
 return (
 <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-mono ${colors[color]}`}>
 <span className="text-text-muted/70 font-sans text-xs">{label}:</span>{value}
 </span>
 );
}
