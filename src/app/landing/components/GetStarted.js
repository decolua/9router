"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";

export default function GetStarted() {
  const [copied, setCopied] = useState(false);
  const t = useTranslations();

  const handleCopy = (text) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <section className="py-24 px-6 bg-[#120f0d]">
      <div className="max-w-7xl mx-auto">
        <div className="flex flex-col lg:flex-row gap-16 items-start">
          {/* Left: Steps */}
          <div className="flex-1">
            <h2 className="text-3xl md:text-4xl font-bold mb-6">{t("landing.getStarted.title")}</h2>
            <p className="text-gray-400 text-lg mb-8">
              {t("landing.getStarted.subtitle")}
            </p>
            
            <div className="flex flex-col gap-6">
              <div className="flex gap-4">
                <div className="flex-none w-8 h-8 rounded-full bg-[#f97815]/20 text-[#f97815] flex items-center justify-center font-bold">1</div>
                <div>
                  <h4 className="font-bold text-lg">{t("landing.getStarted.steps.install.title")}</h4>
                  <p className="text-sm text-gray-500 mt-1">{t("landing.getStarted.steps.install.desc")}</p>
                </div>
              </div>
              
              <div className="flex gap-4">
                <div className="flex-none w-8 h-8 rounded-full bg-[#f97815]/20 text-[#f97815] flex items-center justify-center font-bold">2</div>
                <div>
                  <h4 className="font-bold text-lg">{t("landing.getStarted.steps.dashboard.title")}</h4>
                  <p className="text-sm text-gray-500 mt-1">{t("landing.getStarted.steps.dashboard.desc")}</p>
                </div>
              </div>
              
              <div className="flex gap-4">
                <div className="flex-none w-8 h-8 rounded-full bg-[#f97815]/20 text-[#f97815] flex items-center justify-center font-bold">3</div>
                <div>
                  <h4 className="font-bold text-lg">{t("landing.getStarted.steps.route.title")}</h4>
                  <p className="text-sm text-gray-500 mt-1">{t("landing.getStarted.steps.route.desc")}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Right: Code block */}
          <div className="flex-1 w-full">
            <div className="rounded-xl overflow-hidden bg-[#1e1e1e] border border-[#3a2f27] shadow-2xl">
              {/* Terminal header */}
              <div className="flex items-center gap-2 px-4 py-3 bg-[#252526] border-b border-gray-700">
                <div className="w-3 h-3 rounded-full bg-red-500"></div>
                <div className="w-3 h-3 rounded-full bg-yellow-500"></div>
                <div className="w-3 h-3 rounded-full bg-green-500"></div>
                <div className="ml-2 text-xs text-gray-500 font-mono">{t("landing.getStarted.terminalLabel")}</div>
              </div>
              
              {/* Terminal content */}
              <div className="p-6 font-mono text-sm leading-relaxed overflow-x-auto">
                <div
                  className="flex items-center gap-2 mb-4 group cursor-pointer"
                  onClick={() => handleCopy("npx 9router")}
                >
                  <span className="text-green-400">$</span>
                  <span className="text-white">npx 9router</span>
                  <span className="ml-auto text-gray-500 text-xs opacity-0 group-hover:opacity-100">
                    {copied ? t("landing.getStarted.copied") : t("landing.getStarted.copy")}
                  </span>
                </div>
                
                <div className="text-gray-400 mb-6">
                  <span className="text-[#f97815]">&gt;</span> {t("landing.getStarted.terminal.starting")}<br />
                  <span className="text-[#f97815]">&gt;</span> {t("landing.getStarted.terminal.server")} <span className="text-blue-400">http://localhost:20128</span><br />
                  <span className="text-[#f97815]">&gt;</span> {t("landing.getStarted.terminal.dashboard")} <span className="text-blue-400">http://localhost:20128/dashboard</span><br />
                  <span className="text-green-400">&gt;</span> {t("landing.getStarted.terminal.ready")}
                </div>
                
                <div className="text-xs text-gray-500 mb-2 border-t border-gray-700 pt-4">
                  {t("landing.getStarted.note")}
                </div>
                
                <div className="text-gray-400 text-xs">
                  <span className="text-purple-400">{t("landing.getStarted.dataLocation")}</span><br />
                  <span className="text-gray-500">  {t("landing.getStarted.platforms.unix")}:</span> ~/.9router/db.json<br />
                  <span className="text-gray-500">  {t("landing.getStarted.platforms.windows")}:</span> %APPDATA%/9router/db.json
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

