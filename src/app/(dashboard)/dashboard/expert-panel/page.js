"use client";

import { useEffect, useMemo, useState } from "react";
import { Button, DropdownSelect, Input, Modal } from "@/shared/components";

const createId = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

function readAssistantText(chunk) {
  const content = chunk?.choices?.[0]?.delta?.content ?? chunk?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((part) => part?.text || part?.content || "").join("");
  if (typeof chunk?.output_text === "string") return chunk.output_text;
  if (Array.isArray(chunk?.output)) {
    return chunk.output.flatMap((item) => item?.content || []).map((part) => part?.text || "").join("");
  }
  return "";
}

async function requestModel(model, messages, onChunk, stream = true) {
  const response = await fetch("/api/dashboard/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: stream ? "text/event-stream" : "application/json" },
    body: JSON.stringify({ model, messages, stream }),
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

function parseJudgeResult(text) {
  const normalized = String(text || "").replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const start = normalized.indexOf("{");
  const end = normalized.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("裁判模型未返回有效评分");
  return JSON.parse(normalized.slice(start, end + 1));
}

export default function ExpertPanelPage() {
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

  useEffect(() => {
    fetch("/api/v1/models", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("加载模型失败")))
      .then((data) => setModels((data.data || []).map((model) => ({ value: model.id, label: model.id })).sort((a, b) => a.label.localeCompare(b.label))))
      .catch(() => setModels([]));
  }, []);

  const panelModelIds = useMemo(() => new Set(panels.map((panel) => panel.model)), [panels]);
  const visiblePickerModels = useMemo(() => {
    const query = pickerSearch.trim().toLowerCase();
    return models.filter((model) => !panelModelIds.has(model.value) && (!query || model.label.toLowerCase().includes(query)));
  }, [models, panelModelIds, pickerSearch]);

  const openPicker = (mode) => {
    setPickerSelection([]);
    setPickerSearch("");
    setModelPicker(mode);
  };

  const confirmModels = () => {
    const selected = modelPicker === "single" ? pickerSelection.slice(0, 1) : pickerSelection;
    setPanels((current) => [...current, ...selected.map((model) => ({ id: createId(), model, messages: [], response: "", status: "idle", score: null, comment: "" }))]);
    setModelPicker(null);
  };

  const updatePanel = (id, values) => setPanels((current) => current.map((panel) => panel.id === id ? { ...panel, ...values } : panel));

  const sendPrompt = async () => {
    const text = prompt.trim();
    if (!text || panels.length === 0 || sending) return;
    setPrompt("");
    setSending(true);
    setJudgeSummary("");
    const requestMessages = new Map(panels.map((panel) => [
      panel.id,
      [...panel.messages, { role: "user", content: text }],
    ]));
    setPanels((current) => current.map((panel) => ({
      ...panel,
      messages: requestMessages.get(panel.id) || panel.messages,
      status: "streaming",
      response: "",
      score: null,
      comment: "",
    })));
    await Promise.all(panels.map(async (panel) => {
      const messages = requestMessages.get(panel.id) || panel.messages;
      try {
        const response = await requestModel(panel.model, messages, (partial) => updatePanel(panel.id, { response: partial }));
        updatePanel(panel.id, { response, status: "done", messages: [...messages, { role: "assistant", content: response }] });
      } catch (error) {
        updatePanel(panel.id, { status: "error", response: error.message || "请求失败" });
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
      const scoreMap = new Map((result.scores || []).map((item) => [item.model, item]));
      setPanels((current) => current.map((panel) => {
        const score = scoreMap.get(panel.model);
        return score ? { ...panel, score: Number(score.score), comment: score.comment || "" } : panel;
      }));
      setJudgeSummary(result.summary || "评分完成");
    } catch (error) {
      setJudgeSummary(error.message || "评分失败");
    } finally {
      setJudging(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-bg-base" data-i18n-skip>
      <div className="flex flex-wrap items-end gap-2 border-b border-border bg-surface/80 px-4 py-3 lg:px-6">
        <Button icon="add" size="sm" onClick={() => openPicker("multiple")}>批量增加模型</Button>
        <DropdownSelect className="min-w-56" label="裁判模型" value={judgeModel} onChange={setJudgeModel} searchable searchPlaceholder="搜索裁判模型" options={models} placeholder="选择裁判模型" />
        <Button size="sm" variant="secondary" loading={judging} disabled={!judgeModel || panels.length === 0 || panels.some((panel) => panel.status !== "done")} onClick={runJudge}>开始评分</Button>
        {judgeSummary && <p className="min-w-0 flex-1 text-sm text-text-muted">{judgeSummary}</p>}
      </div>

      <div className="min-h-0 flex-1 overflow-x-auto overflow-y-hidden p-4 lg:p-6 custom-scrollbar">
        <div className="flex h-full min-h-[360px] gap-3">
          {panels.map((panel) => (
            <section key={panel.id} className="flex h-full w-[360px] shrink-0 flex-col overflow-hidden rounded-md border border-border bg-surface">
              <header className="flex items-center gap-2 border-b border-border px-3 py-2">
                <span className="min-w-0 flex-1 truncate font-mono text-xs font-semibold" title={panel.model}>{panel.model}</span>
                {panel.score !== null && <span className="rounded bg-primary/10 px-2 py-0.5 text-sm font-semibold text-primary">{panel.score}</span>}
                <button type="button" disabled={sending} onClick={() => setPanels((current) => current.filter((item) => item.id !== panel.id))} className="rounded p-1 text-text-muted hover:bg-red-500/10 hover:text-red-500 disabled:opacity-40" title="移除模型"><span className="material-symbols-outlined text-[17px]">close</span></button>
              </header>
              <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3 text-sm leading-6 custom-scrollbar">
                {panel.messages.map((message, index) => (
                  <div key={`${panel.id}-${index}`} className={message.role === "user" ? "self-end rounded-md bg-primary/10 px-3 py-2 text-text-main" : "whitespace-pre-wrap break-words"}>
                    {message.content}
                  </div>
                ))}
                {!panel.response && panel.messages.length === 0 && panel.status === "idle" && <p className="text-center text-text-muted">等待发送提示词</p>}
                {!panel.response && panel.status === "streaming" && <p className="animate-pulse text-text-muted">正在生成...</p>}
                {panel.response && panel.status !== "done" && <div className={`whitespace-pre-wrap break-words ${panel.status === "error" ? "text-red-500" : ""}`}>{panel.response}</div>}
              </div>
              {panel.comment && <footer className="border-t border-border bg-bg-subtle px-3 py-2 text-xs text-text-muted"><span className="font-medium text-text-main">裁判评语：</span>{panel.comment}</footer>}
            </section>
          ))}
          <button type="button" onClick={() => openPicker("single")} className="flex h-full min-h-[360px] w-[260px] shrink-0 flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border bg-bg-subtle/30 text-text-muted transition-colors hover:border-primary hover:text-primary">
            <span className="material-symbols-outlined text-[30px]">add_circle</span>
            <span className="text-sm font-medium">待加入</span>
          </button>
        </div>
      </div>

      <div className="shrink-0 border-t border-border bg-surface px-4 py-3 lg:px-6">
        <div className="mx-auto flex max-w-5xl items-end gap-2">
          <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); sendPrompt(); } }} rows={2} placeholder={panels.length ? "向专家团发送提示词" : "请先添加模型"} disabled={panels.length === 0 || sending} className="max-h-40 min-h-14 flex-1 resize-y rounded-md border border-border bg-bg-base px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15 disabled:opacity-60" />
          <Button icon="send" disabled={!prompt.trim() || panels.length === 0 || sending} loading={sending} onClick={sendPrompt}>发送</Button>
        </div>
      </div>

      <Modal isOpen={!!modelPicker} onClose={() => setModelPicker(null)} title={modelPicker === "multiple" ? "批量增加模型" : "增加模型"} size="lg" footer={<><Button variant="ghost" onClick={() => setModelPicker(null)}>取消</Button><Button disabled={pickerSelection.length === 0} onClick={confirmModels}>加入</Button></>}>
        <div className="flex flex-col gap-3">
          <Input icon="search" placeholder="搜索模型" value={pickerSearch} onChange={(event) => setPickerSearch(event.target.value)} />
          <div className="max-h-[55vh] overflow-y-auto rounded-md border border-border p-2 custom-scrollbar">
            {visiblePickerModels.length ? visiblePickerModels.map((model) => {
              const checked = pickerSelection.includes(model.value);
              return <label key={model.value} className="flex cursor-pointer items-center gap-2 rounded px-2 py-2 text-sm hover:bg-bg-hover"><input type={modelPicker === "single" ? "radio" : "checkbox"} checked={checked} onChange={() => setPickerSelection((current) => modelPicker === "single" ? [model.value] : (current.includes(model.value) ? current.filter((item) => item !== model.value) : [...current, model.value]))} /><span className="min-w-0 break-all font-mono text-xs">{model.label}</span></label>;
            }) : <p className="p-8 text-center text-sm text-text-muted">没有可加入的模型</p>}
          </div>
        </div>
      </Modal>
    </div>
  );
}
