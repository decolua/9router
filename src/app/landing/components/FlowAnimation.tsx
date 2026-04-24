"use client";
import React, { useEffect, useState } from "react";
import ProviderIcon from "@/shared/components/ProviderIcon";

const CLI_TOOLS = [
  { id: "claude", name: "Claude Code", image: "/providers/claude.png" },
  { id: "codex", name: "OpenAI Codex", image: "/providers/codex.png" },
  { id: "cline", name: "Cline", image: "/providers/cline.png" },
  { id: "cursor", name: "Cursor", image: "/providers/cursor.png" },
];

const PROVIDERS = [
  {
    id: "openai",
    name: "OpenAI",
    color: "bg-emerald-500",
    textColor: "text-primary-foreground",
  },
  {
    id: "anthropic",
    name: "Anthropic",
    color: "bg-orange-400",
    textColor: "text-primary-foreground",
  },
  {
    id: "gemini",
    name: "Gemini",
    color: "bg-blue-500",
    textColor: "text-primary-foreground",
  },
  {
    id: "github",
    name: "GitHub Copilot",
    color: "bg-gray-700",
    textColor: "text-primary-foreground",
  },
];

export default function FlowAnimation() {
  const [activeFlow, setActiveFlow] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setActiveFlow((prev) => (prev + 1) % PROVIDERS.length);
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="mt-16 w-full max-w-4xl relative h-[360px] hidden md:flex items-center justify-center animate-[float_6s_ease-in-out_infinite]">
      {/* 8Router Hub - Center */}
      <div className="relative z-20 w-32 h-32 rounded-full bg-card border-2 border-primary flex flex-col items-center justify-center gap-1 group cursor-pointer hover:scale-105 transition-transform duration-500">
        <span className="material-symbols-outlined text-4xl text-primary">
          hub
        </span>
        <span className="text-xs font-semibold text-foreground tracking-tight uppercase">
          8Router
        </span>
        <div className="absolute inset-0 rounded-full border border-primary/30 animate-ping opacity-20"></div>
      </div>

      {/* CLI Tools - Left side */}
      <div className="absolute left-0 top-1/2 -translate-y-1/2 flex flex-col gap-7">
        {CLI_TOOLS.map((tool) => (
          <div
            key={tool.id}
            className="flex items-center gap-3 opacity-70 hover:opacity-100 transition-opacity group"
          >
            <div className="w-16 h-16 rounded-2xl bg-card border border-border/50 flex items-center justify-center overflow-hidden p-2 hover:border-primary/50 transition-all hover:scale-105">
              <ProviderIcon
                src={tool.image}
                alt={tool.name}
                size={48}
                className="object-contain rounded-xl max-w-[48px] max-h-[48px]"
                fallbackText={tool.name.slice(0, 2).toUpperCase()}
              />
            </div>
          </div>
        ))}
      </div>

      {/* SVG Lines from CLI to 8Router */}
      <svg
        className="absolute inset-0 w-full h-full z-10 pointer-events-none stroke-border"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          className="animate-[dash_2s_linear_infinite]"
          d="M 60 50 C 250 70, 250 180, 360 180"
          fill="none"
          strokeDasharray="5,5"
          strokeWidth="2"
        ></path>
        <path
          className="animate-[dash_2s_linear_infinite]"
          d="M 60 140 C 250 140, 250 180, 360 180"
          fill="none"
          strokeDasharray="5,5"
          strokeWidth="2"
        ></path>
        <path
          className="animate-[dash_2s_linear_infinite]"
          d="M 60 210 C 250 210, 250 180, 360 180"
          fill="none"
          strokeDasharray="5,5"
          strokeWidth="2"
        ></path>
        <path
          className="animate-[dash_2s_linear_infinite]"
          d="M 60 300 C 250 280, 250 180, 360 180"
          fill="none"
          strokeDasharray="5,5"
          strokeWidth="2"
        ></path>
      </svg>

      {/* SVG Lines from 8Router to Providers */}
      <svg
        className="absolute inset-0 w-full h-full z-10 pointer-events-none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M 440 180 C 550 180, 550 50, 740 50"
          fill="none"
          stroke={activeFlow === 0 ? "hsl(var(--primary))" : "hsl(var(--border))"}
          strokeWidth={activeFlow === 0 ? "3" : "2"}
          className={activeFlow === 0 ? "animate-pulse" : ""}
        ></path>
        <path
          d="M 440 180 C 550 180, 550 130, 740 130"
          fill="none"
          stroke={activeFlow === 1 ? "hsl(var(--primary))" : "hsl(var(--border))"}
          strokeWidth={activeFlow === 1 ? "3" : "2"}
          className={activeFlow === 1 ? "animate-pulse" : ""}
        ></path>
        <path
          d="M 440 180 C 550 180, 550 230, 740 230"
          fill="none"
          stroke={activeFlow === 2 ? "hsl(var(--primary))" : "hsl(var(--border))"}
          strokeWidth={activeFlow === 2 ? "3" : "2"}
          className={activeFlow === 2 ? "animate-pulse" : ""}
        ></path>
        <path
          d="M 440 180 C 550 180, 550 310, 740 310"
          fill="none"
          stroke={activeFlow === 3 ? "hsl(var(--primary))" : "hsl(var(--border))"}
          strokeWidth={activeFlow === 3 ? "3" : "2"}
          className={activeFlow === 3 ? "animate-pulse" : ""}
        ></path>
      </svg>

      {/* AI Providers - Right side */}
      <div className="absolute right-0 top-0 bottom-0 flex flex-col justify-between py-6">
        {PROVIDERS.map((provider, idx) => (
          <div
            key={provider.id}
            className={`px-4 py-2 rounded-lg ${provider.color} ${provider.textColor} flex items-center justify-center font-semibold text-xs transition-all cursor-help min-w-[140px] ${
              activeFlow === idx ? "ring-2 ring-primary/50 scale-110" : ""
            }`}
            title={provider.name}
          >
            {provider.name}
          </div>
        ))}
      </div>

      {/* Mobile fallback */}
      <div className="md:hidden mt-8 w-full p-4 rounded-lg bg-card border border-border/50">
        <p className="text-sm text-center text-muted-foreground">
          Interactive diagram visible on desktop
        </p>
      </div>
    </div>
  );
}
