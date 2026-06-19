"use client";

import { useState, useEffect } from "react";
import { Card, Toggle, CardSkeleton } from "@/shared/components";

export default function RtkCompressPage() {
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/settings")
      .then((r) => (r.ok ? r.json() : {}))
      .then((data) => {
        if (cancelled) return;
        setEnabled(data.rtkEnabled !== false);
      })
      .catch(() => {})
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, []);

  const handleToggle = async (value) => {
    setEnabled(value);
    try {
      await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rtkEnabled: value }),
      });
    } catch (e) {
      console.log("Error updating rtkEnabled:", e);
    }
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
        <h2 className="text-xl font-semibold">RTK</h2>
        <p className="text-sm text-text-muted">Compress tool output before provider routing.</p>
      </div>
      <Card>
        <div className="flex items-center justify-between pt-2 pb-4 gap-4">
          <div className="min-w-0 flex-1">
            <p className="font-medium">
              Compress tool output{" "}
              <a
                href="https://github.com/rtk-ai/rtk"
                target="_blank"
                rel="noreferrer"
                className="text-xs font-normal text-primary underline hover:opacity-80"
              >
                (RTK)
              </a>
            </p>
            <p className="text-sm text-text-muted">
              git/grep/ls/tree/logs → 60-90% fewer input tokens
            </p>
          </div>
          <Toggle checked={enabled} onChange={() => handleToggle(!enabled)} />
        </div>
      </Card>
    </div>
  );
}
