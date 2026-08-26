"use client";

import { useState } from "react";
import StudioConfigPane from "./components/StudioConfigPane";

export default function PlaygroundStudio() {
  const [activeTab, setActiveTab] = useState("chat");
  const [config, setConfig] = useState({
    systemPrompt: "",
    temperature: 0.7,
    maxTokens: 2000,
    model: null // Selected model object from catalog
  });

  return (
    <div className="flex h-full w-full overflow-hidden" data-testid="playground-studio">
      {/* Main Content Area (Tabs) */}
      <div className="flex-1 flex flex-col min-w-0 border-r border-border-subtle bg-bg">
        {/* Tab Navigation */}
        <div className="flex items-center gap-6 px-6 pt-4 pb-0 border-b border-border-subtle shrink-0 overflow-x-auto hide-scrollbar">
          <button
            type="button"
            data-testid="playground-chat-tab"
            onClick={() => setActiveTab("chat")}
            className={`pb-3 text-sm font-medium transition-colors border-b-2 whitespace-nowrap ${
              activeTab === "chat"
                ? "border-primary text-primary"
                : "border-transparent text-text-muted hover:text-text-main"
            }`}
          >
            Chat
          </button>
          <button
            type="button"
            data-testid="playground-compare-tab"
            onClick={() => setActiveTab("compare")}
            className={`pb-3 text-sm font-medium transition-colors border-b-2 whitespace-nowrap ${
              activeTab === "compare"
                ? "border-primary text-primary"
                : "border-transparent text-text-muted hover:text-text-main"
            }`}
          >
            Compare
          </button>
        </div>

        {/* Tab Content */}
        <div className="flex-1 min-h-0 relative">
          {activeTab === "chat" && (
            <div className="absolute inset-0 p-6 overflow-y-auto">
              <p className="text-text-muted text-sm">Chat tab placeholder</p>
            </div>
          )}
          {activeTab === "compare" && (
            <div className="absolute inset-0 p-6 overflow-y-auto">
              <p className="text-text-muted text-sm">Compare tab placeholder</p>
            </div>
          )}
        </div>
      </div>

      {/* Right Sidebar: Config Pane */}
      <StudioConfigPane config={config} onChange={setConfig} />
    </div>
  );
}