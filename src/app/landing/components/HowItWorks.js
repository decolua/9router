"use client";

import { useTranslations } from "next-intl";

export default function HowItWorks() {
  const t = useTranslations();
  return (
    <section className="py-24 border-y border-[#3a2f27] bg-[#23180f]/30" id="how-it-works">
      <div className="max-w-7xl mx-auto px-6">
        <div className="mb-16">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">{t("landing.howItWorks.title")}</h2>
          <p className="text-gray-400 max-w-xl text-lg">
            {t("landing.howItWorks.subtitle")}
          </p>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 relative">
          {/* Connection line */}
          <div className="hidden md:block absolute top-12 left-[16%] right-[16%] h-[2px] bg-linear-to-r from-gray-700 via-[#f97815] to-gray-700 -z-10"></div>
          
          {/* Step 1: CLI & SDKs */}
          <div className="flex flex-col gap-6 relative group">
            <div className="w-24 h-24 rounded-2xl bg-[#181411] border border-[#3a2f27] flex items-center justify-center shadow-xl group-hover:border-gray-500 transition-colors z-10 mx-auto md:mx-0">
              <span className="material-symbols-outlined text-4xl text-gray-300">terminal</span>
            </div>
            <div>
              <h3 className="text-xl font-bold mb-2">{t("landing.howItWorks.step1.title")}</h3>
              <p className="text-sm text-gray-400">
                {t("landing.howItWorks.step1.desc")}
              </p>
            </div>
          </div>

          {/* Step 2: 9Router Hub */}
          <div className="flex flex-col gap-6 relative group md:items-center md:text-center">
            <div className="w-24 h-24 rounded-2xl bg-[#181411] border-2 border-[#f97815] flex items-center justify-center shadow-[0_0_30px_rgba(249,120,21,0.2)] z-10 mx-auto">
              <span className="material-symbols-outlined text-4xl text-[#f97815] animate-pulse">hub</span>
            </div>
            <div>
              <h3 className="text-xl font-bold mb-2 text-[#f97815]">{t("landing.howItWorks.step2.title")}</h3>
              <p className="text-sm text-gray-400">
                {t("landing.howItWorks.step2.desc")}
              </p>
            </div>
          </div>

          {/* Step 3: AI Providers */}
          <div className="flex flex-col gap-6 relative group md:items-end md:text-right">
            <div className="w-24 h-24 rounded-2xl bg-[#181411] border border-[#3a2f27] flex items-center justify-center shadow-xl group-hover:border-gray-500 transition-colors z-10 mx-auto md:mx-0">
              <div className="grid grid-cols-2 gap-2">
                <div className="w-6 h-6 rounded bg-white/10"></div>
                <div className="w-6 h-6 rounded bg-white/10"></div>
                <div className="w-6 h-6 rounded bg-white/10"></div>
                <div className="w-6 h-6 rounded bg-white/10"></div>
              </div>
            </div>
            <div>
              <h3 className="text-xl font-bold mb-2">{t("landing.howItWorks.step3.title")}</h3>
              <p className="text-sm text-gray-400">
                {t("landing.howItWorks.step3.desc")}
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

