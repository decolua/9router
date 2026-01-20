"use client";

import { useState } from "react";
import { Card, ModelSelectModal } from "@/shared/components";
import Image from "next/image";

export default function DefaultToolCard({ toolId, tool, isExpanded, onToggle, baseUrl, apiKeys, activeProviders = [], cloudEnabled = false }) {
  const [copiedField, setCopiedField] = useState(null);
  const [showModelModal, setShowModelModal] = useState(false);
  const [modelValue, setModelValue] = useState("");
  
  // Initialize state directly with computed value - no need for useEffect
  const [selectedApiKey, setSelectedApiKey] = useState(() => 
    apiKeys?.length > 0 ? apiKeys[0].key : ""
  );

  const replaceVars = (text) => {
    const keyToUse = (selectedApiKey && selectedApiKey.trim()) 
      ? selectedApiKey 
      : (!cloudEnabled ? "sk_9router" : "your-api-key");
    
    return text
      .replace(/\{\{baseUrl\}\}/g, baseUrl || "http://localhost:3000")
      .replace(/\{\{apiKey\}\}/g, keyToUse)
      .replace(/\{\{model\}\}/g, modelValue || "provider/model-id");
  };

  const handleCopy = async (text, field) => {
    await navigator.clipboard.writeText(replaceVars(text));
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const handleSelectModel = (model) => {
    setModelValue(model.value);
  };

  const hasActiveProviders = activeProviders.length > 0;

  const renderApiKeySelector = () => {
    return (
      <div className="mt-2 flex items-center gap-2">
        {apiKeys && apiKeys.length > 0 ? (
          <>
            <select
              value={selectedApiKey}
              onChange={(e) => setSelectedApiKey(e.target.value)}
              className="flex-1 px-3 py-2 bg-bg-secondary rounded-lg text-sm border border-border focus:outline-none focus:ring-1 focus:ring-primary/50"
            >
              {apiKeys.map((key) => (
                <option key={key.id} value={key.key}>{key.key}</option>
              ))}
            </select>
            <button
              onClick={() => handleCopy(selectedApiKey, "apiKey")}
              className="shrink-0 px-3 py-2 bg-bg-secondary hover:bg-bg-tertiary rounded-lg border border-border transition-colors"
            >
              <span className="material-symbols-outlined text-lg">
                {copiedField === "apiKey" ? "check" : "content_copy"}
              </span>
            </button>
          </>
        ) : (
          <span className="text-sm text-text-muted">
            {cloudEnabled ? "No API keys - Create one in Keys page" : "sk_9router"}
          </span>
        )}
      </div>
    );
  };

  const renderModelSelector = () => {
    return (
      <div className="mt-2 flex items-center gap-2">
        <input
          type="text"
          value={modelValue}
          onChange={(e) => setModelValue(e.target.value)}
          placeholder="provider/model-id"
          className="flex-1 px-3 py-2 bg-bg-secondary rounded-lg text-sm border border-border focus:outline-none focus:ring-1 focus:ring-primary/50"
        />
        <button
          onClick={() => setShowModelModal(true)}
          disabled={!hasActiveProviders}
          className={`shrink-0 px-3 py-2 rounded-lg border text-sm transition-colors ${
            hasActiveProviders
              ? "bg-bg-secondary border-border text-text-main hover:border-primary cursor-pointer"
              : "opacity-50 cursor-not-allowed border-border"
          }`}
        >
          Select Model
        </button>
        {modelValue && (
          <>
            <button
              onClick={() => handleCopy(modelValue, "model")}
              className="shrink-0 px-3 py-2 bg-bg-secondary hover:bg-bg-tertiary rounded-lg border border-border transition-colors"
            >
              <span className="material-symbols-outlined text-lg">
                {copiedField === "model" ? "check" : "content_copy"}
              </span>
            </button>
            <button
              onClick={() => setModelValue("")}
              className="p-2 text-text-muted hover:text-red-500 rounded transition-colors"
              title="Clear"
            >
              <span className="material-symbols-outlined text-lg">close</span>
            </button>
          </>
        )}
      </div>
    );
  };

  const renderNotes = () => {
    if (!tool.notes || tool.notes.length === 0) return null;
    
    return (
      <div className="flex flex-col gap-2 mb-4">
        {tool.notes.map((note, index) => {
          // Skip cloudCheck note if cloud is enabled
          if (note.type === "cloudCheck" && cloudEnabled) return null;
          
          const isWarning = note.type === "warning";
          const isError = note.type === "cloudCheck" && !cloudEnabled;
          
          let bgClass = "bg-blue-500/10 border-blue-500/30";
          let textClass = "text-blue-600 dark:text-blue-400";
          let iconClass = "text-blue-500";
          let icon = "info";
          
          if (isWarning) {
            bgClass = "bg-yellow-500/10 border-yellow-500/30";
            textClass = "text-yellow-600 dark:text-yellow-400";
            iconClass = "text-yellow-500";
            icon = "warning";
          } else if (isError) {
            bgClass = "bg-red-500/10 border-red-500/30";
            textClass = "text-red-600 dark:text-red-400";
            iconClass = "text-red-500";
            icon = "error";
          }
          
          return (
            <div key={index} className={`flex items-start gap-3 p-3 rounded-lg border ${bgClass}`}>
              <span className={`material-symbols-outlined text-lg ${iconClass}`}>{icon}</span>
              <p className={`text-sm ${textClass}`}>{note.text}</p>
            </div>
          );
        })}
      </div>
    );
  };

  const canShowGuide = () => {
    if (tool.requiresCloud && !cloudEnabled) return false;
    return true;
  };

  const renderGuideSteps = () => {
    if (!tool.guideSteps) return <p className="text-text-muted text-sm">Coming soon...</p>;

    return (
      <div className="flex flex-col gap-4">
        {renderNotes()}
        {canShowGuide() && tool.guideSteps.map((item) => (
          <div key={item.step} className="flex items-start gap-4">
            <div 
              className="size-8 rounded-full flex items-center justify-center shrink-0 text-sm font-semibold text-white"
              style={{ backgroundColor: tool.color }}
            >
              {item.step}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-medium text-text">{item.title}</p>
              {item.desc && <p className="text-sm text-text-muted mt-0.5">{item.desc}</p>}
              {item.type === "apiKeySelector" && renderApiKeySelector()}
              {item.type === "modelSelector" && renderModelSelector()}
              {item.value && (
                <div className="mt-2 flex items-center gap-2">
                  <code className="flex-1 px-3 py-2 bg-bg-secondary rounded-lg text-sm font-mono border border-border truncate">
                    {replaceVars(item.value)}
                  </code>
                  {item.copyable && (
                    <button
                      onClick={() => handleCopy(item.value, `${item.step}-${item.title}`)}
                      className="shrink-0 px-3 py-2 bg-bg-secondary hover:bg-bg-tertiary rounded-lg border border-border transition-colors"
                    >
                      <span className="material-symbols-outlined text-lg">
                        {copiedField === `${item.step}-${item.title}` ? "check" : "content_copy"}
                      </span>
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}

        {canShowGuide() && tool.codeBlock && (
          <div className="mt-2">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-text-muted uppercase tracking-wide">{tool.codeBlock.language}</span>
              <button
                onClick={() => handleCopy(tool.codeBlock.code, "codeblock")}
                className="flex items-center gap-1 px-2 py-1 text-xs bg-bg-secondary hover:bg-bg-tertiary rounded border border-border transition-colors"
              >
                <span className="material-symbols-outlined text-sm">
                  {copiedField === "codeblock" ? "check" : "content_copy"}
                </span>
                {copiedField === "codeblock" ? "Copied!" : "Copy"}
              </button>
            </div>
            <pre className="p-4 bg-bg-secondary rounded-lg border border-border overflow-x-auto">
              <code className="text-sm font-mono whitespace-pre">{replaceVars(tool.codeBlock.code)}</code>
            </pre>
          </div>
        )}
      </div>
    );
  };

  const renderIcon = () => {
    if (tool.image) {
      return (
        <Image
          src={tool.image}
          alt={tool.name}
          width={40}
          height={40}
          className="size-12 object-contain rounded-xl bg-gray-500"
          style={{ width: "auto", height: "auto" }}
          onError={(e) => { e.target.style.display = "none"; }}
        />
      );
    }
    if (tool.icon) {
      return <span className="material-symbols-outlined text-3xl" style={{ color: tool.color }}>{tool.icon}</span>;
    }
    return (
      <Image
        src={`/providers/${toolId}.png`}
        alt={tool.name}
        width={40}
        height={40}
        className="size-10 object-contain rounded-xl"
        style={{ width: "auto", height: "auto" }}
        onError={(e) => { e.target.style.display = "none"; }}
      />
    );
  };

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between hover:cursor-pointer" onClick={onToggle}>
        <div className="flex items-center gap-4">
          <div className="size-12 rounded-xl flex items-center justify-center">
            {renderIcon()}
          </div>
          <div>
            <h3 className="font-semibold text-lg">{tool.name}</h3>
            <p className="text-sm text-text-muted">{tool.description}</p>
          </div>
        </div>
        <span className={`material-symbols-outlined text-text-muted transition-transform ${isExpanded ? "rotate-180" : ""}`}>expand_more</span>
      </div>

      {isExpanded && (
        <div className="mt-6 pt-6 border-t border-border">
          {renderGuideSteps()}
        </div>
      )}

      <ModelSelectModal
        isOpen={showModelModal}
        onClose={() => setShowModelModal(false)}
        onSelect={handleSelectModel}
        selectedModel={modelValue}
        activeProviders={activeProviders}
        title="Select Model"
      />
    </Card>
  );
}

