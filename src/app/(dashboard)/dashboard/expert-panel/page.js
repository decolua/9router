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
  }, [activeSessionId, judgeModel, judgeSummary, panels, prompt, sessionTitle, sessionsReady]);

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
    ])
      .then(async ([catalogResponse, providerResponse, comboResponse]) => {
        const [catalogData, providerData, comboData] = await Promise.all([
          catalogResponse.json().catch(() => ({})),
          providerResponse.json().catch(() => ({})),
          comboResponse.json().catch(() => ({})),
        ]);
        const configuredProviders = new Set((providerData.connections || []).filter((connection) => connection.isActive !== false).map((connection) => connection.provider));
        const providerNames = new Map((providerData.connections || []).map((connection) => [connection.provider, connection.providerName || connection.name || connection.provider]));
        const catalogModels = (catalogData.models || [])
          .filter((model) => configuredProviders.has(model.provider))
          .map((model) => ({ value: model.routedModel || model.fullModel, label: model.alias || model.model || model.routedModel || model.fullModel, provider: providerNames.get(model.provider) || model.provider }));
        const combos = (comboData.combos || []).map((combo) => ({ value: combo.name, label: combo.name, provider: "模型组合" }));
        const mappedModelsResponse = await fetch("/api/v1/models", { cache: "no-store" }).catch(() => null);
        const mappedModelsData = mappedModelsResponse?.ok ? await mappedModelsResponse.json().catch(() => ({})) : {};
        const mappedModels = (mappedModelsData.data || []).map((model) => ({ value: model.id, label: model.id, provider: model.owned_by || String(model.id).split("/")[0] || "其他" }));
        mergeModels([...(mappedModels.length ? mappedModels : catalogModels), ...combos]);
      })
      .catch(() => {});

    return () => { cancelled = true; };
  }, []);

  const panelModelIds = useMemo(() => new Set(panels.map((panel) => panel.model)), [panels]);
  const modelLabelMap = useMemo(() => new Map(models.map((model) => [model.value, model.label])), [models]);
  const visiblePickerModels = useMemo(() => {
    const query = pickerSearch.trim().toLowerCase();
    return models.filter((model) => !panelModelIds.has(model.value) && (!query || `${model.provider} ${model.label}`.toLowerCase().includes(query)));
  }, [models, panelModelIds, pickerSearch]);

  const openPicker = (mode) => {
    setPickerSelection([]);
    setPickerSearch("");
    setModelPicker(mode);
  };

  const applySession = (session) => {
    setActiveSessionId(session.id);
    setSessionTitle(session.title);
    setPanels(session.panels || []);
    setPrompt(session.prompt || "");
    setJudgeModel(session.judgeModel || "");
    setJudgeSummary(session.judgeSummary || "");
  };

  const snapshotCurrentSession = () => sessions.map((session) => session.id === activeSessionId ? {
    ...session,
    title: sessionTitle || "未命名会话",
    panels: panels.map((panel) => ({ ...panel, status: panel.status === "streaming" ? "idle" : panel.status, startedAt: null })),
    prompt,
    judgeModel,
    judgeSummary,
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
    setPanels((current) => [...current, ...selected.map((model) => ({ id: createId(), model, messages: [], response: "", status: "idle", score: null, comment: "", latencyMs: null, startedAt: null }))]);
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
        return score ? { ...panel, score: Number(score.score), comment: score.comment || "" } : panel;
      }));
      setJudgeSummary(result.summary || "评分完成");
      notify.success(result.summary || "评分完成");
    } catch (error) {
      setJudgeSummary(error.message || "评分失败");
      notify.error(error.message || "评分失败");
    } finally {
      setJudging(false);
    }
  };

  const clearSession = () => {
    if (sending || judging || panels.length === 0) return;
    setPanels((current) => current.map((panel) => ({ ...panel, messages: [], response: "", status: "idle", score: null, comment: "", latencyMs: null, startedAt: null })));
    setPrompt("");
    setJudgeSummary("");
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-bg-base" data-i18n-skip>
      <div className="flex flex-wrap items-end gap-3 border-b border-border bg-surface/90 px-4 py-3 lg:px-8">
        <DropdownSelect className="w-56" value={activeSessionId} onChange={switchSession} options={sessions.map((session) => ({ value: session.id, label: session.title }))} placeholder="选择会话" buttonClassName="h-9" />
        <Button icon="note_add" size="md" variant="secondary" disabled={!sessionsReady || sending || judging} onClick={addSession}>新建会话</Button>
        <Button icon="delete" size="md" variant="ghost" disabled={!sessionsReady || sending || judging} onClick={deleteSession}>删除会话</Button>
        {judgeSummary && <p className="min-w-0 flex-1 text-sm text-text-muted">{judgeSummary}</p>}
        <div className="ml-auto flex items-center gap-2">
          <span className="shrink-0 text-sm font-medium text-text-main">裁判模型</span>
          <DropdownSelect className="w-64" value={judgeModel} onChange={setJudgeModel} searchable searchPlaceholder="搜索裁判模型" options={models} placeholder="选择裁判模型" buttonClassName="h-9" />
          <Button size="md" variant="secondary" loading={judging} disabled={!judgeModel || panels.length === 0 || panels.some((panel) => panel.status !== "done")} onClick={runJudge}>开始评分</Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-x-auto overflow-y-hidden p-4 lg:p-8 custom-scrollbar">
        <div className="flex h-full min-h-[360px] gap-3">
          {panels.map((panel) => (
            <section key={panel.id} className="flex h-full w-[480px] shrink-0 flex-col overflow-hidden rounded-md border border-border bg-surface shadow-sm">
              <header className="flex items-center gap-2 border-b border-border px-3 py-2">
                <span className="min-w-0 flex-1 truncate font-mono text-xs font-semibold" title={panel.model}>{modelLabelMap.get(panel.model) || panel.model}</span>
                {panel.latencyMs !== null && <span className="text-[11px] tabular-nums text-text-muted">{panel.latencyMs} ms</span>}
                {panel.score !== null && <span className="rounded bg-primary/10 px-2 py-0.5 text-sm font-semibold text-primary">{panel.score}</span>}
                <button type="button" disabled={sending} onClick={() => setPanels((current) => current.filter((item) => item.id !== panel.id))} className="rounded p-1 text-text-muted hover:bg-red-500/10 hover:text-red-500 disabled:opacity-40" title="移除模型"><span className="material-symbols-outlined text-[17px]">close</span></button>
              </header>
              <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3 text-sm leading-6 custom-scrollbar">
                {panel.messages.map((message, index) => (
                  <div key={`${panel.id}-${index}`} className={`flex max-w-[92%] flex-col gap-1 ${message.role === "user" ? "self-end items-end" : "self-start items-start"}`}>
                    <div className={`whitespace-pre-wrap break-words rounded-md px-3 py-2 ${message.role === "user" ? "bg-primary text-white" : "border border-border bg-surface-2 text-text-main"}`}>{message.content}</div>
                    <span className="px-1 text-[10px] text-text-muted">{formatMessageTime(message.timestamp)}{message.latencyMs !== undefined ? ` · ${message.latencyMs} ms` : ""}</span>
                  </div>
                ))}
                {!panel.response && panel.messages.length === 0 && panel.status === "idle" && <p className="text-center text-text-muted">等待发送提示词</p>}
                {!panel.response && panel.status === "streaming" && <p className="animate-pulse text-text-muted">正在生成...</p>}
                {panel.response && panel.status !== "done" && <div className={`max-w-[92%] self-start whitespace-pre-wrap break-words rounded-md border px-3 py-2 ${panel.status === "error" ? "border-red-500/30 bg-red-500/5 text-red-500" : "border-border bg-surface-2"}`}>{panel.response}</div>}
              </div>
              {panel.comment && <div className="border-t border-border bg-bg-subtle px-3 py-2 text-xs text-text-muted"><span className="font-medium text-text-main">裁判评语：</span>{panel.comment}</div>}
            </section>
          ))}
          <button type="button" onClick={() => openPicker("multiple")} className="flex h-full min-h-[420px] w-[300px] shrink-0 flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border bg-surface text-text-muted shadow-sm transition-colors hover:border-primary hover:bg-primary/5 hover:text-primary">
            <span className="material-symbols-outlined text-[30px]">add_circle</span>
            <span className="text-sm font-medium">待加入</span>
          </button>
        </div>
      </div>

      <div className="shrink-0 border-t border-border bg-surface px-4 py-3 lg:px-8">
        <div className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-stretch gap-2">
          <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); sendPrompt(); } }} placeholder={panels.length ? "向专家团发送提示词" : "请先添加模型"} disabled={panels.length === 0 || sending} className="h-[80px] min-w-0 resize-none rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15 disabled:opacity-60" />
          <div className="grid h-[80px] w-32 grid-rows-2 gap-2">
            <Button className="h-full" icon="delete_sweep" disabled={panels.length === 0 || sending || judging} onClick={clearSession}>清空会话</Button>
            <Button className="h-full" icon="send" disabled={!prompt.trim() || panels.length === 0 || sending} loading={sending} onClick={sendPrompt}>发送</Button>
          </div>
        </div>
      </div>

      <Modal isOpen={!!modelPicker} onClose={() => setModelPicker(null)} title="增加模型" size="lg" footer={<><Button variant="ghost" onClick={() => setModelPicker(null)}>取消</Button><Button disabled={pickerSelection.length === 0} onClick={confirmModels}>批量加入</Button></>}>
        <div className="flex flex-col gap-3">
          <Input icon="search" placeholder="搜索提供商或模型" value={pickerSearch} onChange={(event) => setPickerSearch(event.target.value)} />
          <div className="max-h-[55vh] overflow-y-auto rounded-md border border-border p-2 custom-scrollbar">
            {visiblePickerModels.length ? Object.entries(visiblePickerModels.reduce((groups, model) => { (groups[model.provider || "其他"] ||= []).push(model); return groups; }, {})).map(([provider, providerModels]) => <div key={provider} className="mb-3 last:mb-0"><div className="px-2 py-1 text-xs font-semibold text-text-muted">{provider}</div>{providerModels.map((model) => { const checked = pickerSelection.includes(model.value); return <label key={model.value} className="flex cursor-pointer items-center gap-2 rounded px-2 py-2 text-sm hover:bg-bg-hover"><input type="checkbox" checked={checked} onChange={() => setPickerSelection((current) => current.includes(model.value) ? current.filter((item) => item !== model.value) : [...current, model.value])} /><span className="min-w-0 break-all font-mono text-xs">{model.label}</span></label>; })}</div>) : <p className="p-8 text-center text-sm text-text-muted">没有可加入的模型</p>}
          </div>
        </div>
      </Modal>
    </div>
  );
}
