"use client";

import { useState, useEffect } from "react";
import { Card, Toggle, CardSkeleton } from "@/shared/components";
import { PONYTAIL_LEVELS } from "@/shared/constants/compress";

export default function PonytailCompressPage() {
  const [enabled, setEnabled] = useState(false);
  const [level, setLevel] = useState("full");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/settings")
      .then((r) => (r.ok ? r.json() : {}))
      .then((data) => {
        if (cancelled) return;
        setEnabled(!!data.ponytailEnabled);
        setLevel(data.ponytailLevel || "full");
      })
      .catch(() => {})
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, []);

  const patch = async (patch) => {
    try {
      await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
    } catch (e) {
      console.log("Error updating ponytail settings:", e);
    }
  };

  const handleToggle = (value) => {
    setEnabled(value);
    patch({ ponytailEnabled: value });
  };

  const handleLevel = (next) => {
    setLevel(next);
    patch({ ponytailLevel: next });
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
        <h2 className="text-xl font-semibold">Ponytail</h2>
        <p className="text-sm text-text-muted">Tail-focus ruleset. Composes after Caveman.</p>
      </div>
      <Card>
        <div className="flex items-center justify-between pt-2 pb-4 gap-4 flex-wrap">
          <div className="min-w-0 flex-1">
            <p className="font-medium">Tail-focus output</p>
            <p className="text-sm text-text-muted">
              Tail-focus ruleset → model jumps straight to the answer, no restating the task. Composes after Caveman.
            </p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {enabled && (
              <div className="flex flex-col items-end gap-1">
                <div className="flex items-center gap-1.5">
                  {PONYTAIL_LEVELS.map((lvl) => (
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
                  {PONYTAIL_LEVELS.find((lvl) => lvl.id === level)?.desc}
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
