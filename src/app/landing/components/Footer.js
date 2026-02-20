"use client";

import { useTranslations } from "next-intl";

export default function Footer() {
  const t = useTranslations();
  return (
    <footer className="border-t border-[#3a2f27] bg-[#120f0d] pt-16 pb-8 px-6">
      <div className="max-w-7xl mx-auto">
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-8 mb-16">
          {/* Brand */}
          <div className="col-span-2 lg:col-span-2">
            <div className="flex items-center gap-3 mb-6">
              <div className="size-6 rounded bg-[#f97815] flex items-center justify-center text-white">
                <span className="material-symbols-outlined text-[16px]">hub</span>
              </div>
              <h3 className="text-white text-lg font-bold">9Router</h3>
            </div>
            <p className="text-gray-500 text-sm max-w-xs mb-6">
              {t("landing.footer.brandDesc")}
            </p>
            <div className="flex gap-4">
              <a className="text-gray-400 hover:text-white transition-colors" href="https://github.com/decolua/9router" target="_blank" rel="noopener noreferrer">
                <span className="material-symbols-outlined">code</span>
              </a>
            </div>
          </div>
          
          {/* Product */}
          <div className="flex flex-col gap-4">
            <h4 className="font-bold text-white">{t("landing.footer.product")}</h4>
            <a className="text-gray-400 hover:text-[#f97815] text-sm transition-colors" href="#features">{t("landing.footer.features")}</a>
            <a className="text-gray-400 hover:text-[#f97815] text-sm transition-colors" href="/dashboard">{t("landing.footer.dashboard")}</a>
            <a className="text-gray-400 hover:text-[#f97815] text-sm transition-colors" href="https://github.com/decolua/9router" target="_blank" rel="noopener noreferrer">{t("landing.footer.changelog")}</a>
          </div>
          
          {/* Resources */}
          <div className="flex flex-col gap-4">
            <h4 className="font-bold text-white">{t("landing.footer.resources")}</h4>
            <a className="text-gray-400 hover:text-[#f97815] text-sm transition-colors" href="https://github.com/decolua/9router#readme" target="_blank" rel="noopener noreferrer">{t("landing.footer.documentation")}</a>
            <a className="text-gray-400 hover:text-[#f97815] text-sm transition-colors" href="https://github.com/decolua/9router" target="_blank" rel="noopener noreferrer">{t("landing.footer.github")}</a>
            <a className="text-gray-400 hover:text-[#f97815] text-sm transition-colors" href="https://www.npmjs.com/package/9router" target="_blank" rel="noopener noreferrer">{t("landing.footer.npm")}</a>
          </div>
          
          {/* Legal */}
          <div className="flex flex-col gap-4">
            <h4 className="font-bold text-white">{t("landing.footer.legal")}</h4>
            <a className="text-gray-400 hover:text-[#f97815] text-sm transition-colors" href="https://github.com/decolua/9router/blob/main/LICENSE" target="_blank" rel="noopener noreferrer">{t("landing.footer.license")}</a>
          </div>
        </div>
        
        {/* Bottom */}
        <div className="border-t border-[#3a2f27] pt-8 flex flex-col md:flex-row justify-between items-center gap-4">
          <p className="text-gray-600 text-sm">{t("landing.footer.copyright", { year: 2025 })}</p>
          <div className="flex gap-6">
            <a className="text-gray-600 hover:text-white text-sm transition-colors" href="https://github.com/decolua/9router" target="_blank" rel="noopener noreferrer">{t("landing.footer.github")}</a>
            <a className="text-gray-600 hover:text-white text-sm transition-colors" href="https://www.npmjs.com/package/9router" target="_blank" rel="noopener noreferrer">{t("landing.footer.npm")}</a>
          </div>
        </div>
      </div>
    </footer>
  );
}

