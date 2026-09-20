"use client";

import { useEffect, useState } from "react";
import { Badge, Card } from "@/shared/components";
import { translate } from "@/i18n/runtime";

// Read-only federation config page (FED-005, spec §3.5).
//
// Shows the instance's federation mode (standalone/central/edge), the
// edge's central URL, edge ID, heartbeat/outage/queue settings, and the
// token STATUS (configured yes/no). The token VALUE never reaches browser
// JS: the config-status endpoint reports only a boolean, and this page
// renders only that boolean. Standalone visitors see a simple
// "Federation not enabled" state.
function ConfigRow({ label, value, mono = false }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5 border-b border-border-subtle last:border-b-0">
      <span className="text-sm text-text-muted">{translate(label)}</span>
      <span className={`text-sm text-text-main font-medium ${mono ? "font-mono" : ""}`}>{value}</span>
    </div>
  );
}

function formatMs(ms) {
  if (ms == null) return "—";
  return `${ms} ms`;
}

export default function FederationConfigPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/federation/config-status", { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const payload = await res.json();
        if (!cancelled) setData(payload);
      } catch {
        if (!cancelled) setError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <div className="max-w-3xl">
        <Card title={translate("Federation")} subtitle={translate("Configuration")}>
          <p className="text-sm text-text-muted">{translate("Failed to load federation configuration.")}</p>
        </Card>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="max-w-3xl">
        <Card title={translate("Federation")} subtitle={translate("Configuration")}>
          <p className="text-sm text-text-muted">{translate("Loading…")}</p>
        </Card>
      </div>
    );
  }

  const mode = data.mode || "standalone";
  const isStandalone = mode === "standalone";
  const isEdge = mode === "edge";

  return (
    <div className="max-w-3xl space-y-4">
      <Card
        title={translate("Federation")}
        subtitle={translate("Configuration")}
        icon="lan"
        action={
          <Badge variant={isStandalone ? "default" : isEdge ? "info" : "primary"} size="sm">
            {translate(mode)}
          </Badge>
        }
      >
        {isStandalone ? (
          <p className="text-sm text-text-muted">
            {translate("Federation not enabled. Set FEDERATION_MODE=central or FEDERATION_MODE=edge to enable it.")}
          </p>
        ) : (
          <div>
            <ConfigRow label="Mode" value={translate(mode)} />
            {isEdge ? <ConfigRow label="Central URL" value={data.centralUrl || "—"} mono /> : null}
            <ConfigRow label="Edge ID" value={data.edgeId || "—"} mono />
            <ConfigRow
              label="Token"
              value={
                data.tokenConfigured
                  ? translate("Configured")
                  : translate("Not configured")
              }
            />
          </div>
        )}
      </Card>

      {!isStandalone ? (
        <Card title={translate("Sync & failover settings")} subtitle={translate("Read-only — set via environment variables")}>
          <ConfigRow label="Sync interval" value={formatMs(data.syncIntervalMs)} />
          <ConfigRow label="Heartbeat interval" value={formatMs(data.heartbeatIntervalMs)} />
          <ConfigRow label="Outage threshold" value={formatMs(data.outageThresholdMs)} />
          <ConfigRow label="Write queue max" value={data.queueMax != null ? String(data.queueMax) : "—"} />
          <ConfigRow label="Replay batch size" value={data.replayBatchSize != null ? String(data.replayBatchSize) : "—"} />
        </Card>
      ) : null}
    </div>
  );
}
