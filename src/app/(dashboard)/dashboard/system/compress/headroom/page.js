"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, Toggle, Input, CardSkeleton, Button } from "@/shared/components";

const DEFAULT_URL = "http://localhost:8787";

export default function HeadroomCompressPage() {
  const [enabled, setEnabled] = useState(false);
  const [url, setUrl] = useState(DEFAULT_URL);
  const [loading, setLoading] = useState(true);
  const [probing, setProbing] = useState(false);
  const [probeResult, setProbeResult] = useState(null); // { ok, url, detected, error?, message? }

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

  const probe = useCallback(async (probeUrl) => {
    setProbing(true);
    setProbeResult(null);
    try {
      const target = probeUrl || undefined;
      const url = target ? `/api/headroom/probe?url=${encodeURIComponent(target)}` : "/api/headroom/probe";
      const r = await fetch(url);
      const body = await r.json().catch(() => ({}));
      setProbeResult(body);
      // Auto-apply the detected URL if no custom URL was probed
      if (!target && body.ok && body.url) {
        setUrl(body.url);
        await patch({ headroomUrl: body.url });
      }
    } catch (e) {
      setProbeResult({ ok: false, error: e?.message || "probe failed" });
    } finally {
      setProbing(false);
    }
  }, []);

  // Auto-probe on mount to surface already-running servers
  useEffect(() => {
    if (!loading) probe();
  }, [loading, probe]);

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

  const handleProbeCustom = () => {
    if (url.trim()) probe(url.trim());
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
        <p className="text-sm text-text-muted">
          Context compression via a local Headroom service. If a server is already running on this machine, it is detected automatically.
        </p>
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
          </div>
          <Toggle checked={enabled} onChange={() => handleToggle(!enabled)} />
        </div>

        {/* Detection panel */}
        <div className="border-t border-border-subtle pt-4 mt-2 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              icon="radar"
              onClick={() => probe()}
              loading={probing}
            >
              Auto-detect
            </Button>
            <span className="text-xs text-text-muted">Probe default ports (localhost:8787, 127.0.0.1:8787)</span>
          </div>

          {probeResult && (
            <div
              className={`rounded-lg border px-3 py-2 text-sm ${
                probeResult.ok
                  ? "border-green-500/40 bg-green-500/10 text-green-700 dark:text-green-300"
                  : "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300"
              }`}
            >
              {probeResult.ok ? (
                <>
                  ✓ Detected headroom server at <code className="font-mono">{probeResult.url}</code>
                  {probeResult.detected && " (auto-applied)"}
                </>
              ) : (
                <>
                  {probeResult.message || probeResult.error || "No headroom server detected."}
                  {probeResult.url && ` (probed: ${probeResult.url})`}
                </>
              )}
            </div>
          )}

          {/* Custom URL */}
          <div className="flex items-center gap-2">
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onBlur={handleUrlBlur}
              placeholder={DEFAULT_URL}
              className="flex-1 font-mono text-sm"
            />
            <Button
              size="sm"
              variant="outline"
              icon="network_check"
              onClick={handleProbeCustom}
              loading={probing}
              disabled={!url.trim()}
            >
              Test
            </Button>
          </div>
          <p className="text-xs text-text-muted">
            Custom URL overrides auto-detection. If a server is found via Auto-detect, the URL field updates automatically.
          </p>

          {enabled && (
            <p className="text-xs text-primary">
              Active — requests will be compressed through <code className="font-mono">{url}</code>
            </p>
          )}
        </div>
      </Card>
    </div>
  );
}
