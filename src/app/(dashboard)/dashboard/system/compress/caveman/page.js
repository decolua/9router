"use client";

import { useState, useEffect } from "react";
import { Card, Toggle, CardSkeleton } from "@/shared/components";
import { CAVEMAN_LEVELS, WENYAN_LOCALES } from "@/shared/constants/compress";

export default function CavemanCompressPage() {
  const [enabled, setEnabled] = useState(false);
  const [level, setLevel] = useState("full");
  const [locale, setLocale] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/settings")
      .then((r) => (r.ok ? r.json() : {}))
      .then((data) => {
        if (cancelled) return;
        setEnabled(!!data.cavemanEnabled);
        setLevel(data.cavemanLevel || "full");
        setLocale(data.locale || "");
      })
      .catch(() => {})
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, []);

  const isWenyanLocale = WENYAN_LOCALES.includes(locale);
  const visibleLevels = isWenyanLocale
    ? CAVEMAN_LEVELS
    : CAVEMAN_LEVELS.filter((lvl) => !lvl.wenyan);

  // Reset wenyan level to "ultra" when leaving a Chinese locale
  useEffect(() => {
    const current = CAVEMAN_LEVELS.find((lvl) => lvl.id === level);
    if (current?.wenyan && !isWenyanLocale) {
      setLevel("ultra");
      patch({ cavemanLevel: "ultra" });
    }
  }, [isWenyanLocale, level]);

  const patch = async (patch) => {
    try {
      await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
    } catch (e) {
      console.log("Error updating caveman settings:", e);
    }
  };

  const handleToggle = (value) => {
    setEnabled(value);
    patch({ cavemanEnabled: value });
  };

  const handleLevel = (next) => {
    setLevel(next);
    patch({ cavemanLevel: next });
  };

  if (loading) {
    return (
      <div className="flex min-w-0 flex-col gap-6 px-1 sm:px-0">
        <CardSkeleton />
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-6 px-1 sm:px-0">
      <div>
        <h2 className="text-xl font-semibold">Caveman</h2>
        <p className="text-sm text-text-muted">Terse-style system prompt to compress LLM output.</p>
      </div>
      <Card>
        <div className="flex items-center justify-between pt-2 pb-4 gap-4 flex-wrap">
          <div className="min-w-0 flex-1">
            <p className="font-medium">
              Compress LLM output{" "}
              <a
                href="https://github.com/JuliusBrussee/caveman"
                target="_blank"
                rel="noreferrer"
                className="text-xs font-normal text-primary underline hover:opacity-80"
              >
                (Caveman)
              </a>
            </p>
            <p className="text-sm text-text-muted">
              Terse-style system prompt → ~65% fewer output tokens (up to 87%)
            </p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {enabled && (
              <div className="flex flex-col items-end gap-1">
                <div className="flex items-center gap-1.5">
                  {visibleLevels.map((lvl) => (
                    <button
                      key={lvl.id}
                      onClick={() => handleLevel(lvl.id)}
                      className={`px-3 py-1.5 rounded text-xs font-medium border transition-colors ${
                        level === lvl.id
                          ? "bg-primary text-white border-primary"
                          : "bg-transparent border-border text-text-muted hover:bg-surface-2"
                      }`}
                      title={lvl.desc}
                    >
                      {lvl.label}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-primary">
                  {CAVEMAN_LEVELS.find((lvl) => lvl.id === level)?.desc}
                </p>
              </div>
            )}
            <Toggle checked={enabled} onChange={() => handleToggle(!enabled)} />
          </div>
        </div>
      </Card>
    </div>
  );
}
