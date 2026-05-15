"use client";

import { useEffect, useState } from "react";
import { List } from "lucide-react";
import { t } from "@/constants/docsConfig";
import { DEFAULT_LANG } from "@/constants/languages";

export default function DocsToc({ headings, lang = DEFAULT_LANG }) {
  const [activeId, setActiveId] = useState("");

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setActiveId(entry.target.id);
          }
        });
      },
      { rootMargin: "-80px 0px -80% 0px" }
    );

    headings.forEach(({ id }) => {
      const element = document.getElementById(id);
      if (element) observer.observe(element);
    });

    return () => observer.disconnect();
  }, [headings]);

  if (!headings || headings.length === 0) return null;

  return (
    <aside className="hidden xl:block w-64 border-l bg-white border-gray-200 h-[calc(100vh-4rem)] sticky top-16 overflow-y-auto">
      <nav className="p-4">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-900 mb-3">
          <List className="w-4 h-4" />
          {t(lang, "onThisPage")}
        </h3>
        <ul className="space-y-2">
          {headings.map((heading, idx) => (
            <li key={`${heading.id}-${idx}`}>
              <a
                href={`#${heading.id}`}
                className={`block text-sm transition-colors ${
                  heading.level === 3 ? "pl-4" : ""
                } ${
                  activeId === heading.id
                    ? "text-[#E68A6E] font-medium"
                    : "text-gray-600 hover:text-gray-900"
                }`}
              >
                {heading.text}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </aside>
  );
}
