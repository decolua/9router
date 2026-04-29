"use client";

import { useState } from "react";
import { Card, Button } from "@/shared/components";
import dynamic from "next/dynamic";

const Editor = dynamic(() => import("@monaco-editor/react"), { ssr: false });

// 7 steps matching requestLogger files exactly
const STEPS = [
  { id: 1, label: "Client Request",         file: "1_req_client.json",  lang: "json", desc: "Raw request from client" },
  { id: 2, label: "Source Body",            file: "2_req_source.json",  lang: "json", desc: "After initial conversion" },
  { id: 3, label: "OpenAI Intermediate",    file: "3_req_openai.json",  lang: "json", desc: "source → openai" },
  { id: 4, label: "Target Request",         file: "4_req_target.json",  lang: "json", desc: "openai → target + URL + headers" },
  { id: 5, label: "Provider Response",      file: "5_res_provider.txt", lang: "text", desc: "Raw SSE from provider" },
  { id: 6, label: "OpenAI Response",        file: "6_res_openai.txt",   lang: "text", desc: "target → openai (response)" },
  { id: 7, label: "Client Response",        file: "7_res_client.txt",   lang: "text", desc: "Final response to client" },
];

const EDITOR_OPTIONS = {
  minimap: { enabled: false },
  fontSize: 12,
  lineNumbers: "on",
  scrollBeyondLastLine: false,
  wordWrap: "on",
  automaticLayout: true,
};

export default function TranslatorPage() {
  const [contents, setContents] = useState({});
  const [expanded, setExpanded] = useState({ 1: true });
  const [loading, setLoading] = useState({});
  // Detected from step 1: { provider, model, sourceFormat, targetFormat }
  const [meta, setMeta] = useState(null);

  const setLoad = (key, val) => setLoading(prev => ({ ...prev, [key]: val }));
  const setContent = (id, val) => setContents(prev => ({ ...prev, [id]: val }));
  const toggle = (id) => setExpanded(prev => ({ ...prev, [id]: !prev[id] }));

  const openNext = (nextId) => setExpanded(prev => {
    const next = {};
    STEPS.forEach(s => { next[s.id] = false; });
    next[nextId] = true;
    return next;
  });

  // Load file from logs/translator/
  const handleLoad = async (stepId) => {
    const step = STEPS.find(s => s.id === stepId);
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
    } catch (e) {
      alert(e.message);
    }
    setLoad(`load-${stepId}`, false);
  };

  // Step 1: detect provider/format from model field
  const detectMeta = async (rawContent) => {
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

  const save = (file, content) => fetch("/api/translator/save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file, content })
  }).catch(() => {});

  // Step 1 → Step 3: source → OpenAI intermediate
  const handleToOpenAI = async () => {
    setLoad("toOpenAI", true);
    try {
      const raw = contents[1];
      const body = JSON.parse(raw);
      // Save input: 1_req_client.json + 2_req_source.json (body only)
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
    } catch (e) { alert(e.message); }
    setLoad("toOpenAI", false);
  };

  // Step 3 → Step 4: OpenAI → target + build URL/headers
  const handleToTarget = async () => {
    setLoad("toTarget", true);
    try {
      const raw = contents[3];
      const openaiBody = JSON.parse(raw);
      // Save input: 3_req_openai.json
      save("3_req_openai.json", raw);

      const res = await fetch("/api/translator/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ step: 3, body: { ...openaiBody, provider: meta?.provider, model: meta?.model } })
      });
      const data = await res.json();
      if (!data.success) { alert(data.error); return; }
      // Embed provider + model so Send works even without meta
      const step4Content = { ...data.result, provider: meta?.provider, model: meta?.model };
      setContent(4, JSON.stringify(step4Content, null, 2));
      openNext(4);
    } catch (e) { alert(e.message); }
    setLoad("toTarget", false);
  };

  // Step 4 → Step 5: send to provider via executor
  const handleSend = async () => {
    setLoad("send", true);
    try {
      const raw = contents[4];
      const step4 = JSON.parse(raw);
      // Save input: 4_req_target.json
      save("4_req_target.json", raw);

      // Read provider/model from step4 content (embedded during build), fallback to meta
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

      // Accumulate streaming response
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let full = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        full += decoder.decode(value, { stream: true });
      }

      setContent(5, full);
      openNext(5);

      // Save to logs/translator/5_res_provider.txt
      await fetch("/api/translator/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file: "5_res_provider.txt", content: full })
      });
    } catch (e) {
      alert(e.message);
    } finally {
      setLoad("send", false);
    }
  };

  const handleCopy = async (id) => {
    if (!contents[id]) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(contents[id]).catch(() => {
        const textarea = document.createElement("textarea");
        textarea.value = contents[id];
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      });
    } else {
      const textarea = document.createElement("textarea");
      textarea.value = contents[id];
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    }
  };

  const handleFormat = (id) => {
    try {
      const obj = JSON.parse(contents[id]);
      setContent(id, JSON.stringify(obj, null, 2));
    } catch { /* not JSON, skip */ }
  };

  // Render action button per step
  const getAction = (stepId) => {
    if (stepId === 1) return <Button size="sm" icon="arrow_forward" loading={loading["toOpenAI"]} onClick={handleToOpenAI}>→ OpenAI</Button>;
    if (stepId === 3) return <Button size="sm" icon="arrow_forward" loading={loading["toTarget"]} onClick={handleToTarget}>→ Target</Button>;
    if (stepId === 4) return <Button size="sm" icon="send" loading={loading["send"]} onClick={handleSend}>Send</Button>;
    return null;
  };

  return (
    <div className="p-8 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div>
          <h1 className="text-2xl font-bold text-text-main">Translator Debug</h1>
          <p className="text-sm text-text-muted mt-1">Replay request flow — matches log files</p>
        </div>
        {meta && (
          <div className="flex items-center gap-2 flex-wrap justify-end">
            <MetaBadge label="src" value={meta.sourceFormat} color="blue" />
            <span className="material-symbols-outlined text-text-muted text-[14px]">arrow_forward</span>
            <MetaBadge label="dst" value={meta.targetFormat} color="orange" />
            <MetaBadge label="provider" value={meta.provider} color="green" />
            <MetaBadge label="model" value={meta.model} color="purple" />
          </div>
        )}
      </div>

      {STEPS.map((step) => {
        const action = getAction(step.id);
        const isExpanded = !!expanded[step.id];
        const content = contents[step.id] || "";

        return (
          <Card key={step.id}>
            <div className="p-4 space-y-3">
              {/* Step header */}
              <div className="flex items-center justify-between">
                <button onClick={() => toggle(step.id)} className="flex items-center gap-2 flex-1 text-left group">
                  <span className="material-symbols-outlined text-[20px] text-text-muted group-hover:text-primary transition-colors">
                    {isExpanded ? "expand_more" : "chevron_right"}
                  </span>
                  <span className="text-xs font-mono text-text-muted/60 w-4">{step.id}</span>
                  <h3 className="text-sm font-semibold text-text-main">{step.label}</h3>
                  <span className="text-xs text-text-muted/60 font-mono">{step.file}</span>
                  {content && <span className="text-xs text-green-500">({content.length} chars)</span>}
                </button>
                {!isExpanded && (
                  <div className="flex gap-1 shrink-0">
                    <Button size="sm" variant="ghost" icon="folder_open" loading={loading[`load-${step.id}`]} onClick={() => handleLoad(step.id)} />
                    {action}
                  </div>
                )}
              </div>

              {/* Expanded content */}
              {isExpanded && (
                <>
                  <div className="border border-border rounded-lg overflow-hidden">
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
                    <Button size="sm" variant="outline" icon="folder_open" loading={loading[`load-${step.id}`]} onClick={() => handleLoad(step.id)}>Load</Button>
                    <Button size="sm" variant="outline" icon="data_object" onClick={() => handleFormat(step.id)}>Format</Button>
                    <Button size="sm" variant="outline" icon="content_copy" onClick={() => handleCopy(step.id)}>Copy</Button>
                    {action}
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

function MetaBadge({ label, value, color }) {
  const colors = {
    blue: "bg-blue-500/10 text-blue-500",
    orange: "bg-orange-500/10 text-orange-500",
    green: "bg-green-500/10 text-green-500",
    purple: "bg-purple-500/10 text-purple-500",
  };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-mono ${colors[color]}`}>
      <span className="text-text-muted/70 font-sans text-[10px]">{label}:</span>{value}
    </span>
  );
}
