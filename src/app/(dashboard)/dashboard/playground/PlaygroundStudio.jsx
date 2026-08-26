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

  const handleKeyDown = (e, tabs) => {
    const index = tabs.indexOf(activeTab);
    let nextIndex = index;
    if (e.key === "ArrowRight") {
      nextIndex = (index + 1) % tabs.length;
    } else if (e.key === "ArrowLeft") {
      nextIndex = (index - 1 + tabs.length) % tabs.length;
    } else if (e.key === "Home") {
      nextIndex = 0;
    } else if (e.key === "End") {
      nextIndex = tabs.length - 1;
    }
    
    if (nextIndex !== index) {
      setActiveTab(tabs[nextIndex]);
      // Optional: focus management can be added here
      e.preventDefault();
    }
  };

  return (
    <div className="flex h-full w-full overflow-hidden" data-testid="playground-studio">
      {/* Main Content Area (Tabs) */}
      <div className="flex-1 flex flex-col min-w-0 border-r border-border-subtle bg-bg">
        {/* Tab Navigation */}
        <div 
          className="flex items-center gap-6 px-6 pt-4 pb-0 border-b border-border-subtle shrink-0 overflow-x-auto hide-scrollbar"
          role="tablist"
          aria-label="Testing Studio Tabs"
        >
          <button
            type="button"
            role="tab"
            id="tab-chat"
            aria-selected={activeTab === "chat"}
            aria-controls="panel-chat"
            data-testid="playground-chat-tab"
            onClick={() => setActiveTab("chat")}
            onKeyDown={(e) => handleKeyDown(e, ["chat", "compare"])}
            tabIndex={activeTab === "chat" ? 0 : -1}
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
            role="tab"
            id="tab-compare"
            aria-selected={activeTab === "compare"}
            aria-controls="panel-compare"
            data-testid="playground-compare-tab"
            onClick={() => setActiveTab("compare")}
            onKeyDown={(e) => handleKeyDown(e, ["chat", "compare"])}
            tabIndex={activeTab === "compare" ? 0 : -1}
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
          <div 
            role="tabpanel" 
            id="panel-chat" 
            aria-labelledby="tab-chat"
            hidden={activeTab !== "chat"}
            className="absolute inset-0 p-6 overflow-y-auto"
          >
            <p className="text-text-muted text-sm">Chat tab placeholder</p>
          </div>
          <div 
            role="tabpanel" 
            id="panel-compare" 
            aria-labelledby="tab-compare"
            hidden={activeTab !== "compare"}
            className="absolute inset-0 p-6 overflow-y-auto"
          >
            <p className="text-text-muted text-sm">Compare tab placeholder</p>
          </div>
        </div>
      </div>

      {/* Right Sidebar: Config Pane */}
      <StudioConfigPane config={config} onChange={setConfig} />
    </div>
  );
}