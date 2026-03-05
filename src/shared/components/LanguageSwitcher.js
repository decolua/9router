"use client";

import { useTransition } from "react";
import PropTypes from "prop-types";
import { useLocale, useTranslations } from "next-intl";
import { LOCALES } from "@/i18n/config";
import { cn } from "@/shared/utils/cn";

export default function LanguageSwitcher({ className = "" }) {
  const t = useTranslations("common");
  const locale = useLocale();
  const [isPending, startTransition] = useTransition();

  const setLocale = (nextLocale) => {
    if (nextLocale === locale || isPending) {
      return;
    }

    startTransition(async () => {
      await fetch("/api/locale", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale: nextLocale }),
      });
      globalThis.location.reload();
    });
  };

  return (
    <div
      className={cn(
        "flex items-center rounded-lg border border-black/10 dark:border-white/10 p-1",
        className,
      )}
      role="group"
      aria-label={t("language")}
    >
      {LOCALES.map((item) => {
        const active = locale === item;
        return (
          <button
            key={item}
            type="button"
            onClick={() => setLocale(item)}
            disabled={isPending}
            className={cn(
              "px-2.5 py-1 text-xs rounded-md transition-colors",
              active
                ? "bg-primary/15 text-primary"
                : "text-text-muted hover:text-text-main hover:bg-surface/60",
              isPending ? "opacity-70 cursor-wait" : "",
            )}
            title={`${t("language")}: ${item === "zh-CN" ? t("localeNames.zhCN") : t("localeNames.en")}`}
          >
            {item === "zh-CN" ? "ZH" : "EN"}
          </button>
        );
      })}
    </div>
  );
}

LanguageSwitcher.propTypes = {
  className: PropTypes.string,
};
