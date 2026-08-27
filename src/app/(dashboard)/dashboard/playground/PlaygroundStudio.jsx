"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import StudioConfigPane from "./components/StudioConfigPane";
import PlaygroundInspector from "./components/PlaygroundInspector";
import ChatWorkspace from "./components/tabs/ChatWorkspace";
import CompareWorkspace from "./components/tabs/CompareWorkspace";
import { createPlaygroundPersistence } from "./lib/persistence";
import { sanitizePlaygroundData } from "./lib/sanitize";

const initialConfig = {
  systemPrompt: "",
  temperature: 0.7,
  maxTokens: 2000,
  model: null,
};

export default function PlaygroundStudio() {
  const [activeTab, setActiveTab] = useState("chat");
  const [config, setConfig] = useState(initialConfig);
  const [draft, setDraft] = useState("");
  const [sessions, setSessions] = useState([]);
  const [presets, setPresets] = useState([]);
  const [selection, setSelection] = useState({});
  const [inspectorData, setInspectorData] = useState(null);
  const [storageWarning, setStorageWarning] = useState(null);
  const [hydrated, setHydrated] = useState(false);
  const persistence = useMemo(() => createPlaygroundPersistence(), []);

  const tabRefs = {
    chat: useRef(null),
    compare: useRef(null),
  };

  useEffect(() => {
    const restored = persistence.load();
    setConfig((current) => ({ ...current, ...restored.config }));
    setDraft(restored.draft);
    setSessions(restored.sessions);
    setPresets(restored.presets);
    setSelection(restored.selection);
    setHydrated(true);
  }, [persistence]);

  useEffect(() => {
    if (!hydrated) return;
    const result = persistence.save(sanitizePlaygroundData({ sessions, presets, config, selection, draft }));
    setStorageWarning(result.warning);
    if (result.evictedSessionIds.length > 0) {
      setSessions((current) => current.filter((session) => !result.evictedSessionIds.includes(session.id)));
    }
  }, [config, draft, hydrated, persistence, presets, selection, sessions]);

  const handleClientResult = (result) => {
    const safe = sanitizePlaygroundData(result);
    setInspectorData(safe);
    setSessions((current) => [{
      id: `${Date.now()}`,
      updatedAt: new Date().toISOString(),
      messages: safe.request?.messages || [],
      inspector: safe,
    }, ...current]);
  };

  const handleKeyDown = (event, tabs) => {
    const index = tabs.indexOf(activeTab);
    let nextIndex = index;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % tabs.length;
    else if (event.key === "ArrowLeft") nextIndex = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = tabs.length - 1;
    if (nextIndex !== index) {
      const nextTab = tabs[nextIndex];
      setActiveTab(nextTab);
      tabRefs[nextTab].current?.focus();
      event.preventDefault();
    }
  };

  return (
    <div className="flex h-full w-full overflow-hidden" data-testid="playground-studio">
      <div className="flex-1 flex flex-col min-w-0 border-r border-border-subtle bg-bg">
        <div className="flex items-center gap-6 px-6 pt-4 pb-0 border-b border-border-subtle shrink-0 overflow-x-auto hide-scrollbar" role="tablist" aria-label="Testing Studio Tabs">
          {[["chat", "Chat"], ["compare", "Compare"]].map(([tab, label]) => (
            <button key={tab} type="button" ref={tabRefs[tab]} role="tab" id={`tab-${tab}`} aria-selected={activeTab === tab} aria-controls={`panel-${tab}`} data-testid={`playground-${tab}-tab`} onClick={() => setActiveTab(tab)} onKeyDown={(event) => handleKeyDown(event, ["chat", "compare"])} tabIndex={activeTab === tab ? 0 : -1} className={`pb-3 text-sm font-medium transition-colors border-b-2 whitespace-nowrap ${activeTab === tab ? "border-primary text-primary" : "border-transparent text-text-muted hover:text-text-main"}`}>
              {label}
            </button>
          ))}
        </div>
        {storageWarning && <div className="px-6 py-2 text-xs text-warning" role="status">{sanitizePlaygroundData(storageWarning)}</div>}
        <div className="flex-1 min-h-0 relative">
          <div role="tabpanel" id="panel-chat" aria-labelledby="tab-chat" hidden={activeTab !== "chat"} className="absolute inset-0 p-6 overflow-y-auto">
            <ChatWorkspace configState={{ ...config, params: config }} onResult={handleClientResult} draft={draft} onDraftChange={setDraft} />
          </div>
          <div role="tabpanel" id="panel-compare" aria-labelledby="tab-compare" hidden={activeTab !== "compare"} className="absolute inset-0 p-6 overflow-y-auto">
            <CompareWorkspace configState={{ ...config, params: config }} availableModels={config.model ? [config.model] : []} onResult={handleClientResult} draft={draft} onDraftChange={setDraft} />
          </div>
        </div>
      </div>
      <PlaygroundInspector data={inspectorData} />
      <StudioConfigPane config={config} onChange={setConfig} />
    </div>
  );
}
