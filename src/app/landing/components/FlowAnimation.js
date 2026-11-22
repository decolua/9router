"use client";
import { useEffect, useState } from "react";
import ProviderIcon from "@/shared/components/ProviderIcon";

const CLI_TOOLS = [
  { id: "claude", name: "Claude Code", image: "/providers/claude.png" },
  { id: "codex", name: "OpenAI Codex", image: "/providers/codex.png" },
  { id: "cline", name: "Cline", image: "/providers/cline.png" },
  { id: "cursor", name: "Cursor", image: "/providers/cursor.png" },
];

const PROVIDERS = [
  { id: "openai", name: "OpenAI", tone: "bg-[#c8ee68]" },
  { id: "anthropic", name: "Anthropic", tone: "bg-[#ff7657]" },
  { id: "gemini", name: "Gemini", tone: "bg-[#83d8e8]" },
  { id: "github", name: "GitHub Copilot", tone: "bg-[#c6b5ff]" },
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
    <div className="mt-10 w-full max-w-4xl">
      <div className="relative hidden h-[360px] items-center justify-center md:flex animate-[float_6s_ease-in-out_infinite]">
        <div className="absolute left-0 top-1/2 z-20 flex -translate-y-1/2 flex-col gap-5">
          {CLI_TOOLS.map((tool, index) => (
            <div key={tool.id} className="flex items-center gap-3">
              <div className={`flex size-14 items-center justify-center overflow-hidden border-2 border-[#191817] p-2 shadow-[3px_3px_0_#191817] ${index % 2 ? "bg-[#d9f2f4]" : "bg-[#fffdf8]"}`}>
                <ProviderIcon
                  src={tool.image}
                  alt={tool.name}
                  size={40}
                  className="max-h-[40px] max-w-[40px] object-contain"
                  fallbackText={tool.name.slice(0, 2).toUpperCase()}
                />
              </div>
              <span className="border-2 border-[#191817] bg-[#fffdf8] px-2 py-1 text-xs font-bold text-[#191817] shadow-[2px_2px_0_#191817]">{tool.name}</span>
            </div>
          ))}
        </div>

        <svg className="pointer-events-none absolute inset-0 z-10 h-full w-full" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <path d="M 190 55 C 300 70, 300 180, 410 180" fill="none" stroke="#191817" strokeDasharray="7 6" strokeWidth="2" />
          <path d="M 190 130 C 300 140, 300 180, 410 180" fill="none" stroke="#191817" strokeDasharray="7 6" strokeWidth="2" />
          <path d="M 190 220 C 300 210, 300 180, 410 180" fill="none" stroke="#191817" strokeDasharray="7 6" strokeWidth="2" />
          <path d="M 190 300 C 300 280, 300 180, 410 180" fill="none" stroke="#191817" strokeDasharray="7 6" strokeWidth="2" />
          <path d="M 515 180 C 610 180, 610 55, 740 55" fill="none" stroke={activeFlow === 0 ? "#b83b26" : "#191817"} strokeWidth={activeFlow === 0 ? "4" : "2"} />
          <path d="M 515 180 C 610 180, 610 130, 740 130" fill="none" stroke={activeFlow === 1 ? "#b83b26" : "#191817"} strokeWidth={activeFlow === 1 ? "4" : "2"} />
          <path d="M 515 180 C 610 180, 610 230, 740 230" fill="none" stroke={activeFlow === 2 ? "#b83b26" : "#191817"} strokeWidth={activeFlow === 2 ? "4" : "2"} />
          <path d="M 515 180 C 610 180, 610 300, 740 300" fill="none" stroke={activeFlow === 3 ? "#b83b26" : "#191817"} strokeWidth={activeFlow === 3 ? "4" : "2"} />
        </svg>

        <div className="relative z-20 flex size-32 flex-col items-center justify-center gap-1 border-2 border-[#191817] bg-[#ffd45c] text-[#191817] shadow-[6px_6px_0_#191817]">
          <span className="material-symbols-outlined text-4xl">route</span>
          <span className="text-xs font-black tracking-widest uppercase">9Router</span>
        </div>

        <div className="absolute right-0 top-0 bottom-0 z-20 flex flex-col justify-between py-5">
          {PROVIDERS.map((provider, index) => (
            <div
              key={provider.id}
              className={`min-w-[140px] border-2 border-[#191817] px-4 py-2 text-center text-xs font-black text-[#191817] shadow-[3px_3px_0_#191817] transition-transform ${provider.tone} ${activeFlow === index ? "-translate-x-1 -translate-y-1 shadow-[5px_5px_0_#191817]" : ""}`}
              title={provider.name}
            >
              {provider.name}
            </div>
          ))}
        </div>
      </div>

      <div className="mx-auto max-w-md border-2 border-[#191817] bg-[#fff1bf] p-5 shadow-[4px_4px_0_#191817] md:hidden">
        <p className="mb-4 text-center text-sm font-black uppercase tracking-[0.12em] text-[#191817]">One request, routed where it fits</p>
        <div className="flex flex-col items-center gap-2">
          <div className="w-full border-2 border-[#191817] bg-[#d9f2f4] p-3 text-center text-sm font-bold text-[#191817]">CLI tools &amp; SDKs</div>
          <span className="material-symbols-outlined text-[#191817]">south</span>
          <div className="w-full border-2 border-[#191817] bg-[#ffd45c] p-3 text-center text-sm font-black text-[#191817] shadow-[3px_3px_0_#191817]">9Router hub</div>
          <span className="material-symbols-outlined text-[#191817]">south</span>
          <div className="grid w-full grid-cols-2 gap-2">
            {PROVIDERS.map((provider) => (
              <div key={provider.id} className={`border-2 border-[#191817] p-2 text-center text-xs font-bold text-[#191817] ${provider.tone}`}>{provider.name}</div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
