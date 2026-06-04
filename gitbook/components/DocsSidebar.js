"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { getNavigation } from "@/constants/docsConfig";
import { DEFAULT_LANG } from "@/constants/languages";
import { ChevronDown, ChevronRight, BookOpen, Rocket, Terminal, Monitor, HelpCircle, MessageCircle, Layers, Plug, Cloud, Zap, Wallet, Gift, GitBranch, BarChart3, Code2, Sparkles, Server } from "lucide-react";

// Icons keyed by structural key (language-independent)
const SECTION_ICONS = {
  gettingStarted: Rocket,
  providers: Layers,
  features: Zap,
  integration: Plug,
  deployment: Cloud,
  help: HelpCircle
};

const ITEM_ICONS = {
  introduction: BookOpen,
  quickStart: Rocket,
  installation: Terminal,
  subscription: Sparkles,
  cheap: Wallet,
  free: Gift,
  smartRouting: GitBranch,
  combos: Layers,
  quotaTracking: BarChart3,
  claudeCode: Code2,
  codex: Code2,
  cursor: Code2,
  cline: Code2,
  roo: Code2,
  continue: Code2,
  otherTools: Plug,
  localhost: Monitor,
  cloud: Server,
  troubleshooting: HelpCircle,
  faq: MessageCircle
};

export default function DocsSidebar({ isMobile = false, onClose, lang = DEFAULT_LANG }) {
  const pathname = usePathname();
  const navigation = getNavigation(lang);
  const [openSections, setOpenSections] = useState(() => {
    if (typeof window === "undefined") return [];
    try {
      return JSON.parse(sessionStorage.getItem("sidebarOpen") || "[]");
    } catch { return []; }
  });

  useEffect(() => {
    sessionStorage.setItem("sidebarOpen", JSON.stringify(openSections));
  }, [openSections]);

  const toggleSection = (index) => {
    setOpenSections(prev =>
      prev.includes(index)
        ? prev.filter(i => i !== index)
        : [...prev, index]
    );
  };

  const buildHref = (slug) => (slug ? `/${lang}/${slug}` : `/${lang}`);
  const isActive = (slug) => pathname === buildHref(slug);

  const handleLinkClick = () => {
    if (isMobile && onClose) onClose();
  };

  return (
    <aside className={`${isMobile ? 'w-full' : 'w-64'} border-r bg-white border-gray-200 ${isMobile ? 'h-full' : 'h-[calc(100vh-4rem)] sticky top-16'} overflow-y-auto`}>
      <nav className="p-4 space-y-6">
        {navigation.map((section, sectionIndex) => {
          const SectionIcon = SECTION_ICONS[section.key] || BookOpen;

          return (
            <div key={section.key}>
              <button
                onClick={() => toggleSection(sectionIndex)}
                className="flex items-center justify-between w-full text-sm font-semibold text-gray-900 mb-2 hover:text-[#E68A6E] transition-colors"
              >
                <span className="flex items-center gap-2">
                  <SectionIcon className="w-4 h-4" />
                  {section.title}
                </span>
                {openSections.includes(sectionIndex) ? (
                  <ChevronDown className="w-4 h-4" />
                ) : (
                  <ChevronRight className="w-4 h-4" />
                )}
              </button>

              {openSections.includes(sectionIndex) && (
                <ul className="space-y-1">
                  {section.items.map((item) => {
                    const ItemIcon = ITEM_ICONS[item.key] || BookOpen;

                    return (
                      <li key={item.key}>
                        <Link
                          href={buildHref(item.slug)}
                          onClick={handleLinkClick}
                          className={`flex items-center gap-2 px-3 py-2 text-sm rounded-lg transition-colors ${
                            isActive(item.slug)
                              ? "bg-[#E68A6E]/10 text-[#E68A6E] font-medium"
                              : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                          }`}
                        >
                          <ItemIcon className="w-4 h-4" />
                          {item.title}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
