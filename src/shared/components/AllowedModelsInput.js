"use client";

import { useState, useEffect } from "react";
import { cn } from "@/shared/utils/cn";

const PATTERN_HELPERS = [
  { label: "All GitHub", pattern: "gh/*", icon: "code" },
  { label: "All Claude", pattern: "cc/*", icon: "smart_toy" },
  { label: "All Gemini", pattern: "gc/*", icon: "star" },
  { label: "All OpenAI", pattern: "openai/*", icon: "psychology" },
  { label: "All Minimax", pattern: "minimax/*", icon: "emoji_objects" },
  { label: "Clear All", pattern: "", icon: "clear_all" },
];

export default function AllowedModelsInput({ value = [], onChange, error }) {
  const [inputValue, setInputValue] = useState("");

  // Sync input value with prop value
  useEffect(() => {
    if (Array.isArray(value)) {
      setInputValue(value.join(", "));
    } else {
      setInputValue("");
    }
  }, [value]);

  const handleInputChange = (e) => {
    const newValue = e.target.value;
    setInputValue(newValue);

    // Convert comma-separated string to array
    const patterns = newValue
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    onChange(patterns.length > 0 ? patterns : []);
  };

  const handleQuickAdd = (pattern) => {
    if (pattern === "") {
      // Clear all
      setInputValue("");
      onChange([]);
      return;
    }

    // Add pattern to existing
    const currentPatterns = inputValue
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    // Avoid duplicates
    if (!currentPatterns.includes(pattern)) {
      const newPatterns = [...currentPatterns, pattern];
      const newValue = newPatterns.join(", ");
      setInputValue(newValue);
      onChange(newPatterns);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Input Field */}
      <div>
        <label className="block text-sm font-medium text-text-main mb-1.5">
          Allowed Models
          <span className="text-text-muted font-normal ml-1">(Optional)</span>
        </label>
        <input
          type="text"
          value={inputValue}
          onChange={handleInputChange}
          placeholder="gh/*, cc/sonnet-4.5, minimax/*"
          className={cn(
            "w-full py-2 px-3 text-sm text-text-main",
            "bg-white dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-md",
            "placeholder-text-muted/60",
            "focus:ring-1 focus:ring-primary/30 focus:border-primary/50 focus:outline-none",
            "transition-all shadow-inner",
            "text-[16px] sm:text-sm font-mono",
            error && "border-red-500 focus:border-red-500 focus:ring-red-500/20"
          )}
        />
        <p className="mt-1.5 text-xs text-text-muted">
          Comma-separated patterns. Leave empty to allow all models.
        </p>
        {error && (
          <p className="mt-1.5 text-xs text-red-500 flex items-center gap-1">
            <span className="material-symbols-outlined text-[14px]">error</span>
            {error}
          </p>
        )}
      </div>

      {/* Quick Add Buttons */}
      <div>
        <p className="text-xs font-medium text-text-main mb-2">Quick Add:</p>
        <div className="flex flex-wrap gap-2">
          {PATTERN_HELPERS.map((helper) => (
            <button
              key={helper.label}
              type="button"
              onClick={() => handleQuickAdd(helper.pattern)}
              className={cn(
                "inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-all",
                helper.pattern === ""
                  ? "bg-red-500/10 text-red-600 dark:text-red-400 hover:bg-red-500/20 border border-red-500/20"
                  : "bg-black/5 dark:bg-white/5 text-text-main hover:bg-black/10 dark:hover:bg-white/10 border border-black/10 dark:border-white/10"
              )}
            >
              <span className="material-symbols-outlined text-[14px]">
                {helper.icon}
              </span>
              {helper.label}
            </button>
          ))}
        </div>
      </div>

      {/* Help Section */}
      <div className="bg-blue-500/5 border border-blue-500/20 rounded-md p-3">
        <p className="text-xs font-semibold text-blue-600 dark:text-blue-400 mb-2">
          Pattern Examples:
        </p>
        <ul className="text-xs text-blue-700 dark:text-blue-300 space-y-1">
          <li className="flex items-start gap-1.5">
            <span className="text-blue-500 mt-0.5">•</span>
            <span>
              <code className="bg-blue-500/10 px-1.5 py-0.5 rounded text-blue-700 dark:text-blue-300 font-mono">
                gh/*
              </code>
              <span className="text-text-muted ml-1">- All GitHub models</span>
            </span>
          </li>
          <li className="flex items-start gap-1.5">
            <span className="text-blue-500 mt-0.5">•</span>
            <span>
              <code className="bg-blue-500/10 px-1.5 py-0.5 rounded text-blue-700 dark:text-blue-300 font-mono">
                cc/sonnet-4.5
              </code>
              <span className="text-text-muted ml-1">- Specific model</span>
            </span>
          </li>
          <li className="flex items-start gap-1.5">
            <span className="text-blue-500 mt-0.5">•</span>
            <span>
              <code className="bg-blue-500/10 px-1.5 py-0.5 rounded text-blue-700 dark:text-blue-300 font-mono">
                gh/*, cc/*
              </code>
              <span className="text-text-muted ml-1">
                - Multiple providers
              </span>
            </span>
          </li>
        </ul>
      </div>
    </div>
  );
}
