"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, Button, Select, Input, Toggle } from "@/shared/components";

const PLAYGROUND_HISTORY_KEY = "playground_history_v1";
const PLAYGROUND_PREFS_KEY = "playground_prefs_v1";

const PROMPT_TEMPLATES = [
  {
    value: "",
    label: "Custom",
    prompt: "",
  },
  {
    value: "summary",
    label: "Summary",
    prompt: "Summarize the following in 3 short bullet points:",
  },
  {
    value: "debug",
    label: "Debug assistant",
    prompt: "Given this error log, explain root cause and propose a fix with minimal code changes:",
  },
  {
    value: "rewrite",
    label: "Rewrite",
    prompt: "Rewrite this text to be clear, concise, and professional:",
  },
];

function extractContent(data) {
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") return item;
        if (item?.type === "text") return item.text || "";
        return "";
      })
      .join("\n")
      .trim();
  }
  return "";
}

function parseSSEChunk(chunk, onDelta, onPacket) {
  const lines = chunk.split("\n");
  const remaining = lines.pop() || "";

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line.startsWith("data:")) continue;

    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;

    try {
      const packet = JSON.parse(payload);
      onPacket(packet);
      const delta = packet?.choices?.[0]?.delta?.content;
      if (typeof delta === "string" && delta) onDelta(delta);
    } catch {
      // ignore malformed packet
    }
  }

  return remaining;
}

export default function PlaygroundPage() {
  const [models, setModels] = useState([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [prompt, setPrompt] = useState("Write a 3-line summary about why routing fallback is useful.");
  const [template, setTemplate] = useState("");
  const [loadingModels, setLoadingModels] = useState(true);
  const [running, setRunning] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [resultText, setResultText] = useState("");
  const [rawResponse, setRawResponse] = useState("");
  const [error, setError] = useState("");
  const [latencyMs, setLatencyMs] = useState(null);
  const [streamChars, setStreamChars] = useState(0);
  const [authHeader, setAuthHeader] = useState("");
  const [history, setHistory] = useState([]);
  const [systemPrompt, setSystemPrompt] = useState("");
  const [temperature, setTemperature] = useState("0.7");
  const [topP, setTopP] = useState("1");
  const [maxTokens, setMaxTokens] = useState("512");
  const [chatSession, setChatSession] = useState([]);
  const [debugInfo, setDebugInfo] = useState(null);
  const [showDebug, setShowDebug] = useState(false);
  const [pricing, setPricing] = useState(null);
  const [batchMode, setBatchMode] = useState(false);
  const [batchPrompts, setBatchPrompts] = useState("");
  const [batchResults, setBatchResults] = useState([]);
  const [batchRunning, setBatchRunning] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const [modelsRes, settingsRes, pricingRes] = await Promise.all([
          fetch("/api/v1/models"),
          fetch("/api/settings"),
          fetch("/api/pricing").catch(() => null),
        ]);

        const modelsJson = await modelsRes.json();
        const modelList = Array.isArray(modelsJson?.data)
          ? modelsJson.data.map((item) => item.id).filter(Boolean)
          : [];

        setModels(modelList);
        if (modelList.length > 0) setSelectedModel(modelList[0]);

        if (settingsRes.ok) {
          const settings = await settingsRes.json();
          if (settings.requireApiKey) {
            const keysRes = await fetch("/api/keys");
            const keysJson = await keysRes.json();
            const activeKey = (keysJson?.keys || []).find((key) => key.isActive !== false)?.key || "";
            setAuthHeader(activeKey ? `Bearer ${activeKey}` : "");
          }
        }

        if (pricingRes?.ok) {
          const pricingData = await pricingRes.json();
          setPricing(pricingData);
        }
      } catch {
        setError("Failed to load models.");
      } finally {
        setLoadingModels(false);
      }
    };

    load();

    try {
      const saved = globalThis.localStorage?.getItem(PLAYGROUND_HISTORY_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) setHistory(parsed);
      }

      const prefsRaw = globalThis.localStorage?.getItem(PLAYGROUND_PREFS_KEY);
      if (prefsRaw) {
        const prefs = JSON.parse(prefsRaw);
        if (typeof prefs.model === "string" && prefs.model) {
          setSelectedModel(prefs.model);
        }
        if (typeof prefs.systemPrompt === "string") setSystemPrompt(prefs.systemPrompt);
        if (typeof prefs.temperature === "string") setTemperature(prefs.temperature);
        if (typeof prefs.topP === "string") setTopP(prefs.topP);
        if (typeof prefs.maxTokens === "string") setMaxTokens(prefs.maxTokens);
      }
    } catch {
      // ignore
    }
  }, []);

  const modelOptions = useMemo(
    () => models.map((id) => ({ value: id, label: id })),
    [models],
  );

  const templateOptions = useMemo(
    () => PROMPT_TEMPLATES.map((t) => ({ value: t.value, label: t.label })),
    [],
  );

  useEffect(() => {
    try {
      globalThis.localStorage?.setItem(
        PLAYGROUND_PREFS_KEY,
        JSON.stringify({
          model: selectedModel,
          systemPrompt,
          temperature,
          topP,
          maxTokens,
        }),
      );
    } catch {
      // ignore
    }
  }, [selectedModel, systemPrompt, temperature, topP, maxTokens]);

  const saveHistory = (next) => {
    setHistory(next);
    try {
      globalThis.localStorage?.setItem(PLAYGROUND_HISTORY_KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
  };

  const appendHistory = (item) => {
    setHistory((prev) => {
      const next = [item, ...prev].slice(0, 20);
      try {
        globalThis.localStorage?.setItem(PLAYGROUND_HISTORY_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  };

  const buildHeaders = () => {
    const headers = { "Content-Type": "application/json" };
    const authValue = authHeader.trim();
    if (authValue) {
      headers.Authorization = authValue.toLowerCase().startsWith("bearer ")
        ? authValue
        : `Bearer ${authValue}`;
    }
    return headers;
  };

  const estimateCost = (model, inputTokens, outputTokens) => {
    if (!pricing) return null;

    const parts = model.split("/");
    const provider = parts[0];
    const modelName = parts.slice(1).join("/");

    const providerPricing = pricing[provider];
    if (!providerPricing) return null;

    const modelPricing = providerPricing[modelName];
    if (!modelPricing) return null;

    const inputCost = (inputTokens / 1_000_000) * (modelPricing.input || 0);
    const outputCost = (outputTokens / 1_000_000) * (modelPricing.output || 0);

    return {
      inputCost,
      outputCost,
      totalCost: inputCost + outputCost,
      currency: "USD",
    };
  };

  const handleRun = async () => {
    if (!selectedModel || !prompt.trim() || running) return;

    setRunning(true);
    setError("");
    setLatencyMs(null);
    setStreamChars(0);
    setResultText("");
    setRawResponse("");
    setDebugInfo(null);

    const parsedTemperature = Number.parseFloat(temperature);
    const parsedTopP = Number.parseFloat(topP);
    const parsedMaxTokens = Number.parseInt(maxTokens, 10);

    const messages = [
      ...(systemPrompt.trim() ? [{ role: "system", content: systemPrompt.trim() }] : []),
      ...chatSession,
      { role: "user", content: prompt.trim() },
    ];

    const requestBody = {
      model: selectedModel,
      stream: streaming,
      max_tokens: Number.isFinite(parsedMaxTokens) && parsedMaxTokens > 0 ? parsedMaxTokens : 512,
      temperature: Number.isFinite(parsedTemperature) ? parsedTemperature : 0.7,
      top_p: Number.isFinite(parsedTopP) ? parsedTopP : 1,
      messages,
    };

    const headers = buildHeaders();

    try {
      const start = performance.now();
      const res = await fetch("/api/v1/chat/completions", {
        method: "POST",
        headers,
        body: JSON.stringify(requestBody),
      });

      const debug = {
        requestHeaders: headers,
        requestBody,
        responseStatus: res.status,
        responseHeaders: Object.fromEntries(res.headers.entries()),
      };

      if (!streaming) {
        const data = await res.json().catch(() => ({}));
        const elapsed = Math.round(performance.now() - start);
        setLatencyMs(elapsed);
        setRawResponse(JSON.stringify(data, null, 2));

        debug.responseBody = data;
        const cost = estimateCost(
          selectedModel,
          data?.usage?.prompt_tokens || 0,
          data?.usage?.completion_tokens || 0
        );
        if (cost) debug.estimatedCost = cost;
        setDebugInfo(debug);

        if (!res.ok) {
          const message = data?.error?.message || data?.error || data?.message || `HTTP ${res.status}`;
          setError(String(message));
          appendHistory({
            id: Date.now(),
            model: selectedModel,
            prompt: prompt.trim(),
            resultText: "",
            error: String(message),
            latencyMs: elapsed,
            createdAt: new Date().toISOString(),
          });
          return;
        }

        const extracted = extractContent(data) || "No text content returned.";
        setResultText(extracted);
        setChatSession((prev) => [
          ...prev,
          { role: "user", content: prompt.trim() },
          { role: "assistant", content: extracted },
        ]);
        appendHistory({
          id: Date.now(),
          model: selectedModel,
          prompt: prompt.trim(),
          resultText: extracted,
          error: "",
          latencyMs: elapsed,
          createdAt: new Date().toISOString(),
        });
        return;
      }

      if (!res.ok || !res.body) {
        const fallback = await res.text().catch(() => "");
        const message = fallback || `HTTP ${res.status}`;
        setError(message);
        setRawResponse(fallback);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let lastPacket = null;
      let streamedText = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        buffer = parseSSEChunk(
          buffer,
          (delta) => {
            streamedText += delta;
            setResultText((prev) => prev + delta);
            setStreamChars((prev) => prev + delta.length);
          },
          (packet) => {
            lastPacket = packet;
          },
        );
      }

      const elapsed = Math.round(performance.now() - start);
      setLatencyMs(elapsed);
      setRawResponse(lastPacket ? JSON.stringify(lastPacket, null, 2) : "[No terminal packet]");

      debug.responseBody = lastPacket;
      const cost = estimateCost(
        selectedModel,
        lastPacket?.usage?.prompt_tokens || 0,
        lastPacket?.usage?.completion_tokens || 0
      );
      if (cost) debug.estimatedCost = cost;
      setDebugInfo(debug);

      setChatSession((prev) => [
        ...prev,
        { role: "user", content: prompt.trim() },
        { role: "assistant", content: streamedText },
      ]);
      appendHistory({
        id: Date.now(),
        model: selectedModel,
        prompt: prompt.trim(),
        resultText: streamedText,
        error: "",
        latencyMs: elapsed,
        createdAt: new Date().toISOString(),
      });
    } catch (err) {
      setError(err?.message || "Request failed.");
      setResultText("");
      setRawResponse("");
    } finally {
      setRunning(false);
    }
  };

  const handleBatchRun = async () => {
    if (!selectedModel || !batchPrompts.trim() || batchRunning) return;

    const prompts = batchPrompts.split("\n").map(p => p.trim()).filter(Boolean);
    if (prompts.length === 0) return;

    setBatchRunning(true);
    setBatchResults([]);

    const results = [];
    for (let i = 0; i < prompts.length; i++) {
      const promptText = prompts[i];
      const start = performance.now();

      try {
        const res = await fetch("/api/v1/chat/completions", {
          method: "POST",
          headers: buildHeaders(),
          body: JSON.stringify({
            model: selectedModel,
            stream: false,
            max_tokens: 512,
            messages: [{ role: "user", content: promptText }],
          }),
        });

        const data = await res.json().catch(() => ({}));
        const elapsed = Math.round(performance.now() - start);
        const extracted = extractContent(data) || "No content";

        results.push({
          id: Date.now() + i,
          prompt: promptText,
          result: extracted,
          latencyMs: elapsed,
          error: res.ok ? "" : (data?.error?.message || `HTTP ${res.status}`),
          tokens: data?.usage || {},
        });
      } catch (err) {
        results.push({
          id: Date.now() + i,
          prompt: promptText,
          result: "",
          latencyMs: Math.round(performance.now() - start),
          error: err?.message || "Request failed",
          tokens: {},
        });
      }

      setBatchResults([...results]);
    }

    setBatchRunning(false);
  };

  const handleApplyTemplate = () => {
    const selected = PROMPT_TEMPLATES.find((item) => item.value === template);
    if (selected?.prompt) setPrompt(selected.prompt);
  };

  const handleCopyCurl = async () => {
    const auth = authHeader.trim() ? `-H 'Authorization: ${authHeader.trim()}' \\\n  ` : "";
    const curl = `curl ${globalThis.location.origin}/api/v1/chat/completions \\
  -X POST \\
  -H 'Content-Type: application/json' \\
  ${auth}-d '${JSON.stringify({ model: selectedModel, stream: streaming, messages: [{ role: "user", content: prompt.trim() }] })}'`;
    await navigator.clipboard.writeText(curl);
  };

  const handleCopyJs = async () => {
    const js = `const res = await fetch("${globalThis.location.origin}/api/v1/chat/completions", {\n  method: "POST",\n  headers: {\n    "Content-Type": "application/json",\n    Authorization: "${authHeader.trim()}"\n  },\n  body: JSON.stringify({\n    model: "${selectedModel}",\n    stream: ${streaming},\n    messages: [{ role: "user", content: ${JSON.stringify(prompt.trim())} }]\n  })\n});\nconst data = await res.json();\nconsole.log(data);`;
    await navigator.clipboard.writeText(js);
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
      {/* Left Column - Input Controls */}
      <div className="flex flex-col gap-6">
        <Card title="Playground" subtitle="Quickly test providers and models" icon="experiment">
        <div className="flex flex-col gap-4">
          <Select
            label="Model"
            options={modelOptions}
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
            placeholder={loadingModels ? "Loading models..." : "Select a model"}
            disabled={loadingModels || modelOptions.length === 0 || running}
          />

          <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-3 items-end">
            <Select
              label="Prompt Template"
              options={templateOptions}
              value={template}
              onChange={(e) => setTemplate(e.target.value)}
              placeholder="Choose a template"
              disabled={running}
            />
            <Button variant="secondary" onClick={handleApplyTemplate} disabled={!template || running}>Apply</Button>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-text-main">Prompt</label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={8}
              disabled={running}
              className="w-full py-2 px-3 text-sm text-text-main bg-white dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-md placeholder-text-muted/60 focus:ring-1 focus:ring-primary/30 focus:border-primary/50 focus:outline-none transition-all shadow-inner disabled:opacity-50 disabled:cursor-not-allowed"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-text-main">System Prompt (optional)</label>
            <textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              rows={3}
              disabled={running}
              className="w-full py-2 px-3 text-sm text-text-main bg-white dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-md placeholder-text-muted/60 focus:ring-1 focus:ring-primary/30 focus:border-primary/50 focus:outline-none transition-all shadow-inner disabled:opacity-50 disabled:cursor-not-allowed"
              placeholder="You are a concise assistant..."
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Input
              label="Temperature"
              value={temperature}
              onChange={(e) => setTemperature(e.target.value)}
              disabled={running}
            />
            <Input
              label="Top P"
              value={topP}
              onChange={(e) => setTopP(e.target.value)}
              disabled={running}
            />
            <Input
              label="Max Tokens"
              value={maxTokens}
              onChange={(e) => setMaxTokens(e.target.value)}
              disabled={running}
            />
          </div>

          <Input
            label="Authorization (optional)"
            placeholder="Bearer sk-..."
            value={authHeader}
            onChange={(e) => setAuthHeader(e.target.value)}
            disabled={running}
            hint="Auto-filled when requireApiKey is enabled and an active key exists."
          />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Toggle
              checked={streaming}
              onChange={setStreaming}
              label="Streaming"
              description="Enable SSE streaming for live output"
              disabled={running}
            />
            <Toggle
              checked={batchMode}
              onChange={setBatchMode}
              label="Batch Mode"
              description="Run multiple prompts sequentially"
              disabled={running}
            />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              icon="play_arrow"
              onClick={handleRun}
              loading={running}
              disabled={!selectedModel || !prompt.trim() || loadingModels || batchMode}
            >
              Run
            </Button>
            <Button variant="outline" onClick={handleCopyCurl} disabled={!selectedModel || !prompt.trim()}>Copy cURL</Button>
            <Button variant="outline" onClick={handleCopyJs} disabled={!selectedModel || !prompt.trim()}>Copy JS</Button>
            <Button
              variant="ghost"
              onClick={() => setShowDebug(!showDebug)}
              disabled={!debugInfo}
            >
              {showDebug ? "Hide" : "Show"} Debug
            </Button>
            {latencyMs !== null && (
              <span className="text-xs text-text-muted">Latency: {latencyMs}ms</span>
            )}
            {streaming && streamChars > 0 && (
              <span className="text-xs text-text-muted">Streamed chars: {streamChars}</span>
            )}
            {debugInfo?.estimatedCost && (
              <span className="text-xs text-text-muted">
                Est. cost: ${debugInfo.estimatedCost.totalCost.toFixed(6)}
              </span>
            )}
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}
        </div>
      </Card>

        {batchMode && (
          <Card title="Batch Evaluation" subtitle="Run multiple prompts sequentially" icon="playlist_play">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-text-main">Prompts (one per line)</label>
              <textarea
                value={batchPrompts}
                onChange={(e) => setBatchPrompts(e.target.value)}
                rows={6}
                disabled={batchRunning}
                placeholder="Enter prompts, one per line..."
                className="w-full py-2 px-3 text-sm text-text-main bg-white dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-md placeholder-text-muted/60 focus:ring-1 focus:ring-primary/30 focus:border-primary/50 focus:outline-none transition-all shadow-inner disabled:opacity-50 disabled:cursor-not-allowed"
              />
            </div>
            <Button
              icon="play_arrow"
              onClick={handleBatchRun}
              loading={batchRunning}
              disabled={!selectedModel || !batchPrompts.trim() || loadingModels}
            >
              Run Batch
            </Button>
            {batchResults.length > 0 && (
              <div className="flex flex-col gap-2">
                <p className="text-sm font-medium text-text-main">
                  Results: {batchResults.length} prompts
                  {batchResults.length > 0 && ` • Avg latency: ${Math.round(batchResults.reduce((sum, r) => sum + r.latencyMs, 0) / batchResults.length)}ms`}
                </p>
                {batchResults.map((result) => (
                  <div
                    key={result.id}
                    className="p-3 rounded-lg border border-black/10 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.02]"
                  >
                    <div className="flex items-center justify-between gap-3 mb-2">
                      <p className="text-xs text-text-muted truncate flex-1">{result.prompt}</p>
                      <p className="text-xs text-text-muted">{result.latencyMs}ms</p>
                    </div>
                    {result.error ? (
                      <p className="text-sm text-red-500">{result.error}</p>
                    ) : (
                      <p className="text-sm text-text-main line-clamp-3">{result.result}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>
        )}
      </div>

      {/* Right Column - Output & Results */}
      <div className="flex flex-col gap-6">

      {!batchMode && (
        <>
          <Card title="Output" icon="chat">
            <pre className="text-sm text-text-main whitespace-pre-wrap break-words">{resultText || "No output yet."}</pre>
          </Card>

          {showDebug && debugInfo && (
            <Card title="Debug Panel" subtitle="Request/response details" icon="bug_report">
              <div className="flex flex-col gap-3 text-xs">
                <div>
                  <p className="font-medium text-text-main mb-1">Request Headers</p>
                  <pre className="text-text-muted whitespace-pre-wrap break-words">{JSON.stringify(debugInfo.requestHeaders, null, 2)}</pre>
                </div>
                <div>
                  <p className="font-medium text-text-main mb-1">Response Status</p>
                  <p className="text-text-muted">{debugInfo.responseStatus}</p>
                </div>
                <div>
                  <p className="font-medium text-text-main mb-1">Response Headers</p>
                  <pre className="text-text-muted whitespace-pre-wrap break-words">{JSON.stringify(debugInfo.responseHeaders, null, 2)}</pre>
                </div>
                {debugInfo.estimatedCost && (
                  <div>
                    <p className="font-medium text-text-main mb-1">Estimated Cost</p>
                    <p className="text-text-muted">
                      Input: ${debugInfo.estimatedCost.inputCost.toFixed(6)} •
                      Output: ${debugInfo.estimatedCost.outputCost.toFixed(6)} •
                      Total: ${debugInfo.estimatedCost.totalCost.toFixed(6)}
                    </p>
                  </div>
                )}
              </div>
            </Card>
          )}
        </>
      )}

      {!batchMode && (
        <>
          <Card
            title="Chat Session"
            subtitle="Multi-turn context for follow-up prompts"
            icon="forum"
            action={(
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setChatSession([])}
                disabled={chatSession.length === 0 || running}
              >
                Clear
              </Button>
            )}
          >
            {chatSession.length === 0 ? (
              <p className="text-sm text-text-muted">No chat turns yet.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {chatSession.map((msg, idx) => (
                  <div
                    key={`${msg.role}-${idx}`}
                    className="p-3 rounded-lg border border-black/10 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.02]"
                  >
                    <p className="text-xs uppercase tracking-wide text-text-muted mb-1">{msg.role}</p>
                    <pre className="text-sm text-text-main whitespace-pre-wrap break-words">{msg.content}</pre>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card title="Raw Response" icon="code">
            <pre className="text-xs text-text-muted whitespace-pre-wrap break-words overflow-x-auto">{rawResponse || "No response yet."}</pre>
          </Card>
        </>
      )}

        <Card title="Recent History" icon="history">
        <div className="flex flex-col gap-2">
          {history.length === 0 ? (
            <p className="text-sm text-text-muted">No history yet.</p>
          ) : (
            history.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setSelectedModel(item.model || selectedModel);
                  setPrompt(item.prompt || "");
                }}
                className="w-full text-left p-3 rounded-lg border border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs text-text-muted">{new Date(item.createdAt).toLocaleString()}</p>
                  <p className="text-xs text-text-muted">{item.latencyMs ?? "-"}ms</p>
                </div>
                <p className="text-sm font-medium text-text-main truncate">{item.model}</p>
                <p className="text-xs text-text-muted truncate">{item.prompt}</p>
              </button>
            ))
          )}
        </div>
      </Card>
      </div>
    </div>
  );
}
