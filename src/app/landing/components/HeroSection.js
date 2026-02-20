"use client";

import { useTranslations } from "next-intl";

export default function HeroSection() {
  const t = useTranslations();
  return (
    <section className="relative pt-32 pb-20 px-6 min-h-[90vh] flex flex-col items-center justify-center overflow-hidden">
      {/* Glow effect */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[1000px] h-[500px] bg-[#f97815]/10 rounded-full blur-[120px] pointer-events-none"></div>
      
      <div className="relative z-10 max-w-4xl w-full text-center flex flex-col items-center gap-8">
        {/* Version badge */}
        <div className="inline-flex items-center gap-2 rounded-full border border-[#3a2f27] bg-[#23180f]/50 px-3 py-1 text-xs font-medium text-[#f97815]">
          <span className="flex h-2 w-2 rounded-full bg-[#f97815] animate-pulse"></span>
          {t("landing.hero.badge")}
        </div>

        {/* Main heading */}
        <h1 className="text-5xl md:text-7xl font-black leading-[1.1] tracking-tight">
          {t("landing.hero.titleLine1")} <br />
          <span className="text-[#f97815]">{t("landing.hero.titleLine2")}</span>
        </h1>

        {/* Description */}
        <p className="text-lg md:text-xl text-gray-400 max-w-2xl mx-auto font-light">
          {t("landing.hero.subtitle")}
        </p>

        {/* CTA Buttons */}
        <div className="flex flex-wrap items-center justify-center gap-4 w-full">
          <button className="h-12 px-8 rounded-lg bg-[#f97815] hover:bg-[#e0650a] text-[#181411] text-base font-bold transition-all shadow-[0_0_15px_rgba(249,120,21,0.4)] flex items-center gap-2">
            <span className="material-symbols-outlined">rocket_launch</span>
            {t("landing.hero.primary")}
          </button>
          <a 
            href="https://github.com/decolua/9router" 
            target="_blank" 
            rel="noopener noreferrer"
            className="h-12 px-8 rounded-lg border border-[#3a2f27] bg-[#23180f] hover:bg-[#3a2f27] text-white text-base font-bold transition-all flex items-center gap-2"
          >
            <span className="material-symbols-outlined">code</span>
            {t("landing.hero.secondary")}
          </a>
        </div>
      </div>
    </section>
  );
}

