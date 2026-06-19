"use client";

import { useState, useEffect } from "react";
import { Card, Toggle, Input, CardSkeleton } from "@/shared/components";

const DEFAULT_URL = "http://localhost:8787";

export default function HeadroomCompressPage() {
  const [enabled, setEnabled] = useState(false);
  const [url, setUrl] = useState(DEFAULT_URL);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/settings")
      .then((r) => (r.ok ? r.json() : {}))
      .then((data) => {
        if (cancelled) return;
        setEnabled(!!data.headroomEnabled);
        setUrl(data.headroomUrl || DEFAULT_URL);
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
      console.log("Error updating headroom settings:", e);
    }
  };

  const handleToggle = (value) => {
    const nextUrl = url.trim() || DEFAULT_URL;
    setUrl(nextUrl);
    setEnabled(value);
    patch({ headroomEnabled: value, headroomUrl: nextUrl });
  };

  const handleUrlBlur = () => {
    const next = url.trim() || DEFAULT_URL;
    setUrl(next);
    patch({ headroomUrl: next });
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
        <h2 className="text-xl font-semibold">Headroom</h2>
        <p className="text-sm text-text-muted">Context compression via a local Headroom service.</p>
      </div>
      <Card>
        <div className="flex items-center justify-between pt-2 pb-4 gap-4 flex-wrap">
          <div className="min-w-0 flex-1">
            <p className="font-medium">
              Compress context{" "}
              <a
                href="https://github.com/chopratejas/headroom"
                target="_blank"
                rel="noreferrer"
                className="text-xs font-normal text-primary underline hover:opacity-80"
              >
                (Headroom)
              </a>
            </p>
            <p className="text-sm text-text-muted">
              Run Headroom separately → compress via /v1/compress before provider routing
            </p>
            {enabled && (
              <Input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onBlur={handleUrlBlur}
                placeholder={DEFAULT_URL}
                className="mt-3 font-mono text-sm"
              />
            )}
          </div>
          <Toggle checked={enabled} onChange={() => handleToggle(!enabled)} />
        </div>
      </Card>
    </div>
  );
}
