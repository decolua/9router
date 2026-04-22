"use client";

import { useState, useMemo } from "react";
import { Badge, Button, Select } from "@/shared/components";
import { cn } from "@/shared/utils/cn";

// Agent roles for Oh My Open Agent
const AGENT_ROLES = {
  explorer: "Explorer",
  sisyphus: "Sisyphus",
  oracle: "Oracle",
  librarian: "Librarian",
  prometheus: "Prometheus",
  atlas: "Atlas",
};

// Category roles for Oh My Open Agent
const CATEGORY_ROLES = {
  deep: "Deep Thinking",
  quick: "Quick Tasks",
  "visual-engineering": "Visual Engineering",
  writing: "Writing",
  artistry: "Creative Work",
};

// Agent roles for Oh My OpenCode Slim
const SLIM_AGENT_ROLES = {
  core: "Core Agent",
  research: "Research Agent",
  execution: "Execution Agent",
};

// Category roles for Oh My OpenCode Slim
const SLIM_CATEGORY_ROLES = {
  default: "Default",
  "long-context": "Long Context",
  "low-latency": "Low Latency",
};

function ModelAssignmentRow({ name, label, currentModel, availableModels, isOverride, onModelChange, onClear }) {
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-surface p-2.5 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p className="truncate text-xs font-semibold font-mono text-text-main">{name}</p>
          {isOverride && (
            <Badge size="sm" variant="primary">Custom</Badge>
          )}
        </div>
        <p className="truncate text-[11px] text-text-muted">{label}</p>
      </div>
      <div className="flex items-center gap-2">
        <Select
          value={currentModel || ""}
          onChange={(e) => onModelChange(e.target.value || undefined)}
          options={[
            { value: "", label: "Auto (from chain)" },
            ...availableModels.map(id => ({ value: id, label: id }))
          ]}
          className="text-xs"
        />
        {isOverride && (
          <button
            type="button"
            onClick={onClear}
            className="rounded p-1 text-text-muted hover:text-red-500 transition-colors"
            title="Clear override"
          >
            <span className="material-symbols-outlined text-[16px]">close</span>
          </button>
        )}
      </div>
    </div>
  );
}

export default function AdvancedConfigEditor({ variant, preferences, availableModels, onSave, saving }) {
  const [activeTab, setActiveTab] = useState("agents");
  
  const isSlim = variant === "slim";
  const agentRoles = isSlim ? SLIM_AGENT_ROLES : AGENT_ROLES;
  const categoryRoles = isSlim ? SLIM_CATEGORY_ROLES : CATEGORY_ROLES;
  
  const currentOverrides = preferences?.advancedOverrides?.[variant] || {};
  const agentAssignments = currentOverrides.agentAssignments || {};
  const categoryAssignments = currentOverrides.categoryAssignments || {};

  const handleAgentModelChange = (agent, model) => {
    const newAgentAssignments = { ...agentAssignments };
    if (model === undefined) {
      delete newAgentAssignments[agent];
    } else {
      newAgentAssignments[agent] = model;
    }
    
    const newOverrides = {
      ...currentOverrides,
      agentAssignments: Object.keys(newAgentAssignments).length > 0 ? newAgentAssignments : undefined,
    };
    
    onSave({ advancedOverrides: { ...preferences.advancedOverrides, [variant]: newOverrides } });
  };

  const handleCategoryModelChange = (category, model) => {
    const newCategoryAssignments = { ...categoryAssignments };
    if (model === undefined) {
      delete newCategoryAssignments[category];
    } else {
      newCategoryAssignments[category] = model;
    }
    
    const newOverrides = {
      ...currentOverrides,
      categoryAssignments: Object.keys(newCategoryAssignments).length > 0 ? newCategoryAssignments : undefined,
    };
    
    onSave({ advancedOverrides: { ...preferences.advancedOverrides, [variant]: newOverrides } });
  };

  const agentOverrideCount = Object.keys(agentAssignments).length;
  const categoryOverrideCount = Object.keys(categoryAssignments).length;

  return (
    <div className="space-y-4">
      {/* Tab Navigation */}
      <div className="flex items-center gap-2 border-b border-border">
        <button
          type="button"
          onClick={() => setActiveTab("agents")}
          className={cn(
            "px-4 py-2 text-sm font-medium transition-colors cursor-pointer",
            activeTab === "agents"
              ? "border-b-2 border-primary text-primary"
              : "text-text-muted hover:text-text-main"
          )}
        >
          Agent Assignments
          {agentOverrideCount > 0 && (
            <Badge size="sm" className="ml-2">{agentOverrideCount}</Badge>
          )}
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("categories")}
          className={cn(
            "px-4 py-2 text-sm font-medium transition-colors cursor-pointer",
            activeTab === "categories"
              ? "border-b-2 border-primary text-primary"
              : "text-text-muted hover:text-text-main"
          )}
        >
          Category Assignments
          {categoryOverrideCount > 0 && (
            <Badge size="sm" className="ml-2">{categoryOverrideCount}</Badge>
          )}
        </button>
      </div>

      {/* Agent Assignments */}
      {activeTab === "agents" && (
        <div className="space-y-3 rounded-lg border border-border bg-surface/50 p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-text-main">Agent Model Assignments</p>
              <p className="text-xs text-text-muted mt-0.5">
                Override which model each agent uses. Leave as "Auto" to use the default chain.
              </p>
            </div>
            {agentOverrideCount > 0 && (
              <Badge size="sm">{agentOverrideCount}/{Object.keys(agentRoles).length} custom</Badge>
            )}
          </div>
          
          <div className="space-y-2 mt-4">
            {Object.entries(agentRoles).map(([agent, label]) => (
              <ModelAssignmentRow
                key={agent}
                name={agent}
                label={label}
                currentModel={agentAssignments[agent]}
                availableModels={availableModels}
                isOverride={!!agentAssignments[agent]}
                onModelChange={(model) => handleAgentModelChange(agent, model)}
                onClear={() => handleAgentModelChange(agent, undefined)}
              />
            ))}
          </div>

          {saving && (
            <p className="text-xs text-amber-600 dark:text-amber-400">Saving...</p>
          )}
        </div>
      )}

      {/* Category Assignments */}
      {activeTab === "categories" && (
        <div className="space-y-3 rounded-lg border border-border bg-surface/50 p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-text-main">Category Model Assignments</p>
              <p className="text-xs text-text-muted mt-0.5">
                Override which model each task category uses. Leave as "Auto" to use the default chain.
              </p>
            </div>
            {categoryOverrideCount > 0 && (
              <Badge size="sm">{categoryOverrideCount}/{Object.keys(categoryRoles).length} custom</Badge>
            )}
          </div>
          
          <div className="space-y-2 mt-4">
            {Object.entries(categoryRoles).map(([category, label]) => (
              <ModelAssignmentRow
                key={category}
                name={category}
                label={label}
                currentModel={categoryAssignments[category]}
                availableModels={availableModels}
                isOverride={!!categoryAssignments[category]}
                onModelChange={(model) => handleCategoryModelChange(category, model)}
                onClear={() => handleCategoryModelChange(category, undefined)}
              />
            ))}
          </div>

          {saving && (
            <p className="text-xs text-amber-600 dark:text-amber-400">Saving...</p>
          )}
        </div>
      )}

      {/* Help Text */}
      <div className="rounded-lg border border-border bg-surface/50 px-3 py-2 text-xs text-text-muted space-y-1">
        <p className="font-semibold">💡 Tips:</p>
        <ul className="list-disc list-inside space-y-0.5 ml-2">
          <li>Use "Auto" to let the system choose the best model from the chain</li>
          <li>Override specific agents/categories when you need more control</li>
          <li>Model format: <code className="text-primary">cx/gpt-5.3-codex</code> (with provider prefix)</li>
          <li>Changes are saved automatically</li>
        </ul>
      </div>
    </div>
  );
}
