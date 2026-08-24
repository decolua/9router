"use client";

import { useEffect, useMemo, useState } from "react";
import { Button, DropdownSelect, Input, Modal } from "@/shared/components";
import { useNotificationStore } from "@/store/notificationStore";
import { parseJudgeResult } from "@/shared/utils/judgeResult.js";

const createId = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const SESSION_STORAGE_KEY = "9router:expert-panel-sessions";

function createSession(index = 1) {
  const now = new Date().toISOString();
  return {
    id: createId(),
    title: `新会话 ${index}`,
    panels: [],
    prompt: "",
    judgeModel: "",
    judgeSummary: "",
    judgeStartedAt: null,
    judgeLatencyMs: null,
    createdAt: now,
    updatedAt: now,
  };
}

function normalizeStoredSession(session, index) {
  if (!session || typeof session !== "object") return createSession(index + 1);
  return {
    ...createSession(index + 1),
    ...session,
    panels: Array.isArray(session.panels) ? session.panels.map((panel) => ({
      ...panel,
      status: panel.status === "streaming" ? "idle" : panel.status,
      startedAt: null,
    })) : [],
  };
}

function readAssistantText(chunk) {
  const content = chunk?.choices?.[0]?.delta?.content ?? chunk?.choices?.[0]?.message?.content ?? chunk?.output_text ?? chunk?.text;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((part) => part?.text || part?.content || "").join("");
  if (typeof chunk?.output_text === "string") return chunk.output_text;
  if (Array.isArray(chunk?.output)) {
    return chunk.output.flatMap((item) => item?.content || []).map((part) => part?.text || "").join("");
  }
  return "";
}

async function requestModel(model, messages, onChunk, stream = true) {
  const requestMessages = messages.map(({ role, content }) => ({ role, content }));
  const response = await fetch("/api/dashboard/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: stream ? "text/event-stream" : "application/json" },
    body: JSON.stringify({ model, messages: requestMessages, stream }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data?.error?.message || data?.error || data?.message || `请求失败（${response.status}）`);
  }
  if (!stream) {
    const data = await response.json();
    return readAssistantText(data);
  }
  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let buffer = "";
  let result = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";
    for (const line of lines) {
      const payload = line.trim().startsWith("data:") ? line.trim().slice(5).trim() : "";
      if (!payload || payload === "[DONE]") continue;
      try {
        const text = readAssistantText(JSON.parse(payload));
        if (text) {
          result += text;
          onChunk?.(result);
        }
      } catch {}
    }
  }
  return result;
}

const formatMessageTime = (value) => value ? new Date(value).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }) : "";

export default function ExpertPanelPage() {
  const notify = useNotificationStore();
  const [models, setModels] = useState([]);
  const [panels, setPanels] = useState([]);
  const [prompt, setPrompt] = useState("");
  const [modelPicker, setModelPicker] = useState(null);
  const [pickerSearch, setPickerSearch] = useState("");
  const [pickerSelection, setPickerSelection] = useState([]);
  const [judgeModel, setJudgeModel] = useState("");
  const [sending, setSending] = useState(false);
  const [judging, setJudging] = useState(false);
  const [judgeSummary, setJudgeSummary] = useState("");
  const [judgeStartedAt, setJudgeStartedAt] = useState(null);
  const [judgeLatencyMs, setJudgeLatencyMs] = useState(null);
  const [chatFilter, setChatFilter] = useState("all");
  const [sessions, setSessions] = useState([]);
  const [activeSessionId, setActiveSessionId] = useState("");
  const [sessionTitle, setSessionTitle] = useState("");
  const [sessionsReady, setSessionsReady] = useState(false);

  useEffect(() => {
    const timeout = setTimeout(() => {
      let restored = [];
      let restoredActiveId = "";
      try {
        const saved = JSON.parse(localStorage.getItem(SESSION_STORAGE_KEY) || "null");
        restored = Array.isArray(saved?.sessions) ? saved.sessions.map(normalizeStoredSession) : [];
        restoredActiveId = saved?.activeSessionId || "";
      } catch {}
      if (!restored.length) restored = [createSession(1)];
      const active = restored.find((session) => session.id === restoredActiveId) || restored[0];
      setSessions(restored);
      setActiveSessionId(active.id);
      setSessionTitle(active.title);
      setPanels(active.panels);
      setPrompt(active.prompt || "");
      setJudgeModel(active.judgeModel || "");
      setJudgeSummary(active.judgeSummary || "");
      setJudgeStartedAt(active.judgeStartedAt || null);
      setJudgeLatencyMs(active.judgeLatencyMs || null);
      setSessionsReady(true);
    }, 0);
    return () => clearTimeout(timeout);
  }, []);

  useEffect(() => {
    if (!sessionsReady || !activeSessionId) return undefined;
    const timeout = setTimeout(() => {
      setSessions((current) => {
        const savedSession = {
          id: activeSessionId,
          title: sessionTitle || "未命名会话",
          panels: panels.map((panel) => ({ ...panel, status: panel.status === "streaming" ? "idle" : panel.status, startedAt: null })),
          prompt,
          judgeModel,
          judgeSummary,
          judgeStartedAt,
          judgeLatencyMs,
          createdAt: current.find((session) => session.id === activeSessionId)?.createdAt || new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        const next = current.some((session) => session.id === activeSessionId)
          ? current.map((session) => session.id === activeSessionId ? savedSession : session)
          : [...current, savedSession];
        localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({ activeSessionId, sessions: next }));
        return next;
      });
    }, 250);
    return () => clearTimeout(timeout);
  }, [activeSessionId, judgeLatencyMs, judgeModel, judgeStartedAt, judgeSummary, panels, prompt, sessionTitle, sessionsReady]);

  useEffect(() => {
    let cancelled = false;
    const mergeModels = (items) => {
      if (cancelled) return;
      setModels((current) => {
        const merged = new Map(current.map((item) => [item.value, item]));
        for (const model of items.filter(Boolean)) merged.set(model.value, model);
        return [...merged.values()].sort((a, b) => `${a.provider}/${a.label}`.localeCompare(`${b.provider}/${b.label}`));
      });
    };

    Promise.all([
      fetch("/api/models", { cache: "no-store" }),
      fetch("/api/providers", { cache: "no-store" }),
      fetch("/api/combos", { cache: "no-store" }),
      fetch("/api/models/custom", { cache: "no-store" }),
    ])
      .then(async ([catalogResponse, providerResponse, comboResponse, customResponse]) => {
        const [catalogData, providerData, comboData, customData] = await Promise.all([
          catalogResponse.json().catch(() => ({})),
          providerResponse.json().catch(() => ({})),
          comboResponse.json().catch(() => ({})),
          customResponse.json().catch(() => ({})),
        ]);
        const configuredProviders = new Set((providerData.connections || []).filter((connection) => connection.isActive !== false || connection.autoDisabled === true || connection.autoDisabledReason).map((connection) => connection.provider));
        const providerNames = new Map((providerData.connections || []).map((connection) => [connection.provider, connection.providerName || connection.name || connection.provider]));
        const catalogModels = (catalogData.models || [])
          .filter((model) => configuredProviders.has(model.provider))
          .map((model) => ({ value: model.routedModel || model.fullModel, label: model.alias || model.model || model.routedModel || model.fullModel, provider: providerNames.get(model.provider) || model.provider }));
        const combos = (comboData.combos || []).map((combo) => ({ value: combo.name, label: combo.name, provider: "模型组合" }));
        const customModels = (customData.models || [])
          .filter((model) => (model.kind || model.type || "llm") === "llm" && configuredProviders.has(model.providerAlias))
          .map((model) => ({ value: `${model.providerAlias}/${model.id}`, label: model.name || model.id, provider: providerNames.get(model.providerAlias) || model.providerAlias }));
        const mappedModelsResponse = await fetch("/api/v1/models", { cache: "no-store" }).catch(() => null);
        const mappedModelsData = mappedModelsResponse?.ok ? await mappedModelsResponse.json().catch(() => ({})) : {};
        const mappedModels = (mappedModelsData.data || []).map((model) => ({ value: model.id, label: model.id, provider: model.owned_by || String(model.id).split("/")[0] || "其他" }));
        mergeModels([...(mappedModels.length ? mappedModels : catalogModels), ...customModels, ...combos]);
      })
      .catch(() => {});

    return () => { cancelled = true; };
  }, []);

  const panelModelIds = useMemo(() => new Set(panels.map((panel) => panel.model)), [panels]);
  const modelLabelMap = useMemo(() => new Map(models.map((model) => [model.value, model.label])), [models]);
  const modelProviderMap = useMemo(() => new Map(models.map((model) => [model.value, model.provider || "其他"])), [models]);
  const chatEntries = useMemo(() => {
    const entries = [];
    const seenUsers = new Set();
    for (const panel of panels) {
      for (const message of panel.messages || []) {
        if (message.role === "user") {
          const key = `${message.timestamp || ""}|${message.content || ""}`;
          if (seenUsers.has(key)) continue;
          seenUsers.add(key);
          entries.push({ kind: "user", message });
        } else {
          entries.push({ kind: "assistant", panel, message });
        }
      }
      if (panel.response && panel.status !== "done") {
        entries.push({ kind: "assistant", panel, message: { role: "assistant", content: panel.response, timestamp: panel.startedAt ? new Date(panel.startedAt).toISOString() : new Date().toISOString(), latencyMs: null, pending: true } });
      }
    }
    return entries.sort((left, right) => new Date(left.message.timestamp || 0) - new Date(right.message.timestamp || 0));
  }, [panels]);
  const visiblePickerModels = useMemo(() => {
    const query = pickerSearch.trim().toLowerCase();
    const candidates = modelPicker === "judge"
      ? models.filter((model) => model.provider !== "模型组合")
      : models.filter((model) => !panelModelIds.has(model.value));
    return candidates.filter((model) => (!query || `${model.provider} ${model.label}`.toLowerCase().includes(query)));
  }, [modelPicker, models, panelModelIds, pickerSearch]);

  const visibleChatEntries = useMemo(() => {
    if (chatFilter === "all" || chatFilter === "judge") return chatEntries;
    return chatEntries.filter((entry) => entry.kind === "user" || entry.panel?.model === chatFilter);
  }, [chatEntries, chatFilter]);

  const openPicker = (mode) => {
    setPickerSelection([]);
    setModelPicker(mode);
  };

  const applySession = (session) => {
    setActiveSessionId(session.id);
    setSessionTitle(session.title);
    setPanels(session.panels || []);
    setPrompt(session.prompt || "");
    setJudgeModel(session.judgeModel || "");
    setJudgeSummary(session.judgeSummary || "");
    setJudgeStartedAt(session.judgeStartedAt || null);
    setJudgeLatencyMs(session.judgeLatencyMs || null);
  };

  const snapshotCurrentSession = () => sessions.map((session) => session.id === activeSessionId ? {
    ...session,
    title: sessionTitle || "未命名会话",
    panels: panels.map((panel) => ({ ...panel, status: panel.status === "streaming" ? "idle" : panel.status, startedAt: null })),
    prompt,
    judgeModel,
    judgeSummary,
    judgeStartedAt,
    judgeLatencyMs,
    updatedAt: new Date().toISOString(),
  } : session);

  const switchSession = (sessionId) => {
    if (sending || judging || sessionId === activeSessionId) return;
    const next = snapshotCurrentSession();
    const target = next.find((session) => session.id === sessionId);
    if (!target) return;
    setSessions(next);
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({ activeSessionId: target.id, sessions: next }));
    applySession(target);
  };

  const addSession = () => {
    if (sending || judging) return;
    const session = createSession(sessions.length + 1);
    const next = [...snapshotCurrentSession(), session];
    setSessions(next);
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({ activeSessionId: session.id, sessions: next }));
    applySession(session);
  };

  const deleteSession = () => {
    if (sending || judging || !activeSessionId) return;
    if (!window.confirm(`删除会话“${sessionTitle}”？`)) return;
    let next = snapshotCurrentSession().filter((session) => session.id !== activeSessionId);
    if (!next.length) next = [createSession(1)];
    const target = next[0];
    setSessions(next);
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({ activeSessionId: target.id, sessions: next }));
    applySession(target);
  };

  const confirmModels = () => {
    const selected = pickerSelection;
    if (modelPicker === "judge") {
      setJudgeModel(selected[0] || "");
    } else {
      setPanels((current) => [...current, ...selected.map((model) => ({ id: createId(), model, messages: [], response: "", status: "idle", score: null, comment: "", latencyMs: null, startedAt: null, judgeTimestamp: null, judgeLatencyMs: null }))]);
    }
    setModelPicker(null);
  };

  const updatePanel = (id, values) => setPanels((current) => current.map((panel) => panel.id === id ? { ...panel, ...values } : panel));

  const sendPrompt = async () => {
    const text = prompt.trim();
    if (!text || panels.length === 0 || sending) return;
    if (/^新会话\s*\d*$/.test(sessionTitle)) setSessionTitle(text.slice(0, 24));
    setPrompt("");
    setSending(true);
    setJudgeSummary("");
    setJudgeStartedAt(null);
    setJudgeLatencyMs(null);
    const requestMessages = new Map(panels.map((panel) => [
      panel.id,
      [...panel.messages, { role: "user", content: text, timestamp: new Date().toISOString() }],
    ]));
    setPanels((current) => current.map((panel) => ({
      ...panel,
      messages: requestMessages.get(panel.id) || panel.messages,
      status: "streaming",
      response: "",
      score: null,
      comment: "",
      judgeTimestamp: null,
      judgeLatencyMs: null,
      latencyMs: null,
      startedAt: Date.now(),
    })));
    await Promise.all(panels.map(async (panel) => {
      const messages = requestMessages.get(panel.id) || panel.messages;
      const startedAt = Date.now();
      try {
        const response = await requestModel(panel.model, messages, (partial) => updatePanel(panel.id, { response: partial }));
        const latencyMs = Date.now() - startedAt;
        updatePanel(panel.id, { response, status: "done", latencyMs, messages: [...messages, { role: "assistant", content: response, timestamp: new Date().toISOString(), latencyMs }] });
      } catch (error) {
        const message = error.message || "请求失败";
        updatePanel(panel.id, { status: "error", response: message, latencyMs: Date.now() - startedAt });
        notify.error(`${panel.model}：${message}`);
      }
    }));
    setSending(false);
  };

  const runJudge = async () => {
    if (!judgeModel || judging || panels.length === 0 || panels.some((panel) => panel.status !== "done")) return;
    setJudging(true);
    setJudgeSummary("");
    const judgeStartedAtValue = new Date().toISOString();
    const judgeStartedMs = Date.now();
    setJudgeStartedAt(judgeStartedAtValue);
    setJudgeLatencyMs(null);
    try {
      const candidates = panels.map((panel) => ({ model: panel.model, response: panel.response }));
      const judgePrompt = `你是严格的回答质量裁判。请根据正确性、完整性、相关性和清晰度，为每个候选回复评分。只返回 JSON，不要附加说明。格式：{"scores":[{"model":"模型名","score":0,"comment":"简短评语"}],"summary":"总体结论"}\n\n候选回复：\n${JSON.stringify(candidates, null, 2)}`;
      const resultText = await requestModel(judgeModel, [{ role: "user", content: judgePrompt }], null, false);
      const result = parseJudgeResult(resultText);
      const scoreMap = new Map((result.scores || []).map((item) => [String(item.model).trim().toLowerCase(), item]));
      setPanels((current) => current.map((panel, index) => {
        const score = scoreMap.get(panel.model.toLowerCase())
          || result.scores.find((item) => panel.model.toLowerCase().endsWith(String(item.model).toLowerCase()))
          || (result.scores.length === current.length ? result.scores[index] : null);
        return score ? { ...panel, score: Number(score.score), comment: score.comment || "", judgeTimestamp: judgeStartedAtValue, judgeLatencyMs: Date.now() - judgeStartedMs } : panel;
      }));
      setJudgeSummary(result.summary || "评分完成");
      setJudgeLatencyMs(Date.now() - judgeStartedMs);
      notify.success(result.summary || "评分完成");
    } catch (error) {
      setJudgeSummary(error.message || "评分失败");
      setJudgeLatencyMs(Date.now() - judgeStartedMs);
      notify.error(error.message || "评分失败");
    } finally {
      setJudging(false);
    }
  };

  const clearSession = () => {
    if (sending || judging || panels.length === 0) return;
    setPanels((current) => current.map((panel) => ({ ...panel, messages: [], response: "", status: "idle", score: null, comment: "", latencyMs: null, startedAt: null, judgeTimestamp: null, judgeLatencyMs: null })));
    setPrompt("");
    setJudgeSummary("");
    setJudgeStartedAt(null);
    setJudgeLatencyMs(null);
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-bg-base" data-i18n-skip>
      <div className="flex flex-wrap items-end gap-3 border-b border-border bg-surface/90 px-4 py-3 lg:px-8">
        <DropdownSelect className="w-56" value={activeSessionId} onChange={switchSession} options={sessions.map((session) => ({ value: session.id, label: session.title }))} placeholder="选择会话" buttonClassName="h-9" />
        <Button icon="note_add" size="md" variant="secondary" disabled={!sessionsReady || sending || judging} onClick={addSession}>新建会话</Button>
        <Button icon="delete" size="md" variant="ghost" disabled={!sessionsReady || sending || judging} onClick={deleteSession}>删除会话</Button>
        {judgeSummary && <p className="min-w-0 flex-1 text-sm text-text-muted">{judgeSummary}</p>}
      </div>

      <div className="min-h-0 flex-1 px-4 py-4 lg:px-8 lg:py-6 custom-scrollbar">
        <div className="mx-0 grid h-full min-h-0 w-full grid-cols-1 gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
          <aside className="flex min-h-0 flex-col overflow-visible rounded-md border border-border bg-surface shadow-sm">
            <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
              <Input icon="search" placeholder="搜索提供商或模型" value={pickerSearch} onChange={(event) => setPickerSearch(event.target.value)} />
              <Button icon="add" variant="secondary" disabled={sending} onClick={() => openPicker("multiple")}>增加模型</Button>
              <div className="min-h-0 flex-1 overflow-y-auto rounded-md border border-border bg-bg-subtle p-2 custom-scrollbar">
                <div className="mb-2 text-xs font-semibold text-text-muted">已选专家模型</div>
                {panels.length ? panels.map((panel) => {
                  const panelDone = panel.status === "done";
                  const panelError = panel.status === "error";
                  return <div key={panel.id} className={`flex items-center justify-between gap-2 border-b border-border/60 px-2 py-2 last:border-b-0 ${panelDone ? "bg-success/5" : panelError ? "bg-error/5" : ""}`}><span className="min-w-0 truncate text-xs" title={panel.model}><span className="font-medium text-text-muted">{modelProviderMap.get(panel.model) || "其他"}</span><span className="mx-1 text-text-muted">/</span><span className="font-mono">{modelLabelMap.get(panel.model) || panel.model}</span></span><span className={`inline-flex shrink-0 items-center gap-1 text-[10px] ${panelDone ? "text-success" : panelError ? "text-error" : panel.status === "streaming" ? "text-primary" : "text-text-muted"}`}><span className={`material-symbols-outlined text-[14px] ${panel.status === "streaming" ? "animate-spin" : ""}`}>{panelDone ? "check_circle" : panelError ? "error" : panel.status === "streaming" ? "progress_activity" : "schedule"}</span>{panelDone ? "已完成" : panelError ? "失败" : panel.status === "streaming" ? "生成中" : "待发送"}</span><button type="button" disabled={sending} onClick={() => setPanels((current) => current.filter((item) => item.id !== panel.id))} className="shrink-0 rounded p-1 text-text-muted hover:bg-bg-hover hover:text-red-500 disabled:opacity-40" title="移除模型" aria-label="移除模型"><span className="material-symbols-outlined text-[16px]">close</span></button></div>;
                }) : <p className="p-4 text-center text-xs text-text-muted">尚未添加模型</p>}
              </div>
            </div>
            <div className="shrink-0 border-t border-border p-3">
              <div className="mb-2 text-xs font-semibold text-text-muted">裁判设置</div>
              <Button className="w-full justify-between" variant="secondary" disabled={sending} onClick={() => openPicker("judge")}>{judgeModel ? `${modelProviderMap.get(judgeModel) || "其他"} / ${modelLabelMap.get(judgeModel) || judgeModel}` : "选择裁判模型"}<span className="material-symbols-outlined text-[18px]">expand_more</span></Button>
              <Button className="mt-2 w-full" variant="secondary" loading={judging} disabled={!judgeModel || panels.length === 0 || panels.some((panel) => panel.status !== "done")} onClick={runJudge}>开始评分</Button>
            </div>
          </aside>

          <section className="flex min-h-0 flex-col overflow-hidden rounded-md border border-border bg-surface shadow-sm">
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-2">
              <span className="max-w-40 truncate text-sm font-semibold text-text-main">群聊</span>
              <div className="flex min-w-0 flex-1 items-center justify-end gap-3 overflow-x-auto text-xs text-text-muted" role="radiogroup" aria-label="群聊筛选">
                <label className="flex shrink-0 items-center gap-1.5 whitespace-nowrap"><input type="radio" name="chat-filter" value="all" checked={chatFilter === "all"} onChange={(event) => setChatFilter(event.target.value)} />所有模型</label>
                {panels.map((panel) => <label key={panel.id} className="flex max-w-48 shrink-0 items-center gap-1.5 whitespace-nowrap"><input type="radio" name="chat-filter" value={panel.model} checked={chatFilter === panel.model} onChange={(event) => setChatFilter(event.target.value)} /><span className="truncate">{modelProviderMap.get(panel.model) || "其他"} / {modelLabelMap.get(panel.model) || panel.model}</span></label>)}
                <label className="flex shrink-0 items-center gap-1.5 whitespace-nowrap"><input type="radio" name="chat-filter" value="judge" checked={chatFilter === "judge"} onChange={(event) => setChatFilter(event.target.value)} />裁判</label>
              </div>
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 text-sm leading-6 custom-scrollbar">
            {visibleChatEntries.map((entry, index) => {
              if (entry.kind === "user") return chatFilter === "judge" ? null : <div key={`user-${index}`} className="flex max-w-[92%] flex-col items-end gap-1 self-end"><div className="whitespace-pre-wrap break-words rounded-md bg-primary px-3 py-2 text-white">{entry.message.content}</div><span className="px-1 text-[10px] text-text-muted">{formatMessageTime(entry.message.timestamp)}</span></div>;
              const panel = entry.panel;
              const assistantMessages = (panel.messages || []).filter((message) => message.role === "assistant");
              const isLatest = entry.message.pending || assistantMessages[assistantMessages.length - 1] === entry.message;
              if (chatFilter === "judge") {
                if (!isLatest || (panel.score === null && !panel.comment)) return null;
                return <div key={`${panel.id}-${index}`} className="flex max-w-[94%] flex-col items-start gap-1 self-start rounded-md border border-amber-500/20 bg-amber-500/5 px-3 py-2"><div className="flex items-center gap-2"><span className="rounded bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-600">裁判</span><span className="font-mono text-[10px] text-text-muted">{modelProviderMap.get(panel.model) || "其他"} / {modelLabelMap.get(panel.model) || panel.model}</span></div><div className="text-sm">评分 {panel.score ?? "-"}</div>{panel.comment && <p className="text-text-muted">评语：{panel.comment}</p>}<span className="text-[10px] text-text-muted">{panel.judgeTimestamp ? formatMessageTime(panel.judgeTimestamp) : ""}{panel.judgeLatencyMs != null ? ` · ${panel.judgeLatencyMs} ms` : ""}</span></div>;
              }
              return <div key={`${panel.id}-${index}`} className="flex max-w-[94%] flex-col items-start gap-1 self-start"><div className="flex items-center gap-2"><span className="rounded bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">专家</span><span className="font-mono text-[10px] font-medium text-text-muted">{modelProviderMap.get(panel.model) || "其他"} / {modelLabelMap.get(panel.model) || panel.model}</span></div><div className={`whitespace-pre-wrap break-words rounded-md border px-3 py-2 ${panel.status === "error" ? "border-red-500/30 bg-red-500/5 text-red-500" : "border-border bg-surface-2 text-text-main"}`}>{entry.message.content}</div><span className="px-1 text-[10px] text-text-muted">{formatMessageTime(entry.message.timestamp)}{entry.message.latencyMs != null ? ` · ${entry.message.latencyMs} ms` : ""}{entry.message.pending ? " · 生成中" : ""}</span>{isLatest && (panel.score !== null || panel.comment) && <div className="ml-2 border-l-2 border-primary/30 pl-3 text-xs text-text-muted"><div className="mb-1 flex items-center gap-2"><span className="rounded bg-amber-500/10 px-2 py-0.5 font-semibold text-amber-600">裁判</span><span>评分 {panel.score ?? "-"}</span></div>{panel.comment && <p><span className="font-medium text-text-main">评语：</span>{panel.comment}</p>}<div className="mt-1 text-[10px]">{panel.judgeTimestamp ? formatMessageTime(panel.judgeTimestamp) : ""}{panel.judgeLatencyMs != null ? ` · ${panel.judgeLatencyMs} ms` : ""}</div></div>}</div>;
            })}
            {!visibleChatEntries.length && panels.length === 0 && <p className="flex flex-1 items-center justify-center text-center text-text-muted">请先添加模型</p>}
            {!visibleChatEntries.length && panels.length > 0 && <p className="flex flex-1 items-center justify-center text-center text-text-muted">等待发送提示词</p>}
            {chatFilter === "judge" && !panels.some((panel) => panel.score !== null || panel.comment) && <p className="flex flex-1 items-center justify-center text-center text-text-muted">暂无裁判结果</p>}
            {judgeSummary && (chatFilter === "all" || chatFilter === "judge") && <article className="self-start rounded-md border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-sm"><div className="mb-1 flex items-center gap-2"><span className="rounded bg-amber-500/10 px-2 py-0.5 text-xs font-semibold text-amber-600">裁判</span><span className="font-medium">裁判综评</span></div><p className="whitespace-pre-wrap text-text-muted">{judgeSummary}</p><div className="mt-2 text-[10px] text-text-muted">{judgeStartedAt ? formatMessageTime(judgeStartedAt) : ""}{judgeLatencyMs != null ? ` · ${judgeLatencyMs} ms` : ""}</div></article>}
            </div>
            <div className="shrink-0 border-t border-border bg-surface px-4 py-3">
              <div className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-stretch gap-2">
                <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); sendPrompt(); } }} placeholder={panels.length ? "向专家团发送提示词" : "请先添加模型"} disabled={panels.length === 0 || sending} className="h-[80px] min-w-0 resize-none rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15 disabled:opacity-60" />
                <div className="grid h-[80px] w-32 grid-rows-2 gap-2">
                  <Button className="h-full" icon="delete_sweep" disabled={panels.length === 0 || sending || judging} onClick={clearSession}>清空会话</Button>
                  <Button className="h-full" icon="send" disabled={!prompt.trim() || panels.length === 0 || sending} loading={sending} onClick={sendPrompt}>发送</Button>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>

      <Modal
        isOpen={!!modelPicker}
        onClose={() => setModelPicker(null)}
        title={modelPicker === "judge" ? "选择裁判模型" : "增加模型"}
        size="lg"
        footer={<><Button variant="ghost" onClick={() => setModelPicker(null)}>取消</Button><Button disabled={pickerSelection.length === 0} onClick={confirmModels}>{modelPicker === "judge" ? "选择" : "加入选中模型"}</Button></>}
      >
        <div className="flex flex-col gap-3">
          <Input icon="search" placeholder="搜索提供商或模型" value={pickerSearch} onChange={(event) => setPickerSearch(event.target.value)} />
          <div className="max-h-[55vh] overflow-y-auto rounded-md border border-border p-2 custom-scrollbar">
            {visiblePickerModels.length ? Object.entries(visiblePickerModels.reduce((groups, model) => { (groups[model.provider || "其他"] ||= []).push(model); return groups; }, {})).map(([provider, providerModels]) => <div key={provider} className="mb-3 last:mb-0"><div className="px-2 py-1 text-xs font-semibold text-text-muted">{provider}</div>{providerModels.map((model) => { const checked = pickerSelection.includes(model.value); return <label key={model.value} className="flex cursor-pointer items-center gap-2 rounded px-2 py-2 text-sm hover:bg-bg-hover"><input type="checkbox" checked={checked} onChange={() => setPickerSelection((current) => modelPicker === "judge" ? [model.value] : (current.includes(model.value) ? current.filter((item) => item !== model.value) : [...current, model.value]))} /><span className="min-w-0 break-all font-mono text-xs">{model.label}</span></label>; })}</div>) : <p className="p-8 text-center text-sm text-text-muted">没有可加入的模型</p>}
          </div>
        </div>
      </Modal>
    </div>
  );
}
