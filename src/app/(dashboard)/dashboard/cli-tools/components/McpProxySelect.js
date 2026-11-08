"use client";

import { useCallback, useEffect, useState } from "react";
import PropTypes from "prop-types";
import Select from "@/shared/components/Select";

const NONE_PROXY_POOL_VALUE = "__none__";
const STRATEGIES = [
  { value: "none", label: "None (single pool)" },
  { value: "round-robin", label: "Round-robin" },
  { value: "random", label: "Random" },
];

/**
 * Proxy pool binding for the MCP surface.
 *
 * MCP has no provider connection to hang a pool off, so the binding is stored in
 * `settings.providerStrategies[scope]` — the same record the no-auth provider
 * cards write. Server side, resolveSurfaceProxyOptions() reads it back and the
 * MCP routes run their outbound fetches inside that proxy scope.
 */
export default function McpProxySelect({ scope = "mcp" }) {
  const [proxyPools, setProxyPools] = useState([]);
  const [proxyPoolId, setProxyPoolId] = useState(NONE_PROXY_POOL_VALUE);
  const [rotateStrategy, setRotateStrategy] = useState("none");
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch("/api/proxy-pools?isActive=true", { cache: "no-store" }).then((r) => (r.ok ? r.json() : { proxyPools: [] })),
      fetch("/api/settings", { cache: "no-store" }).then((r) => (r.ok ? r.json() : {})),
    ])
      .then(([poolData, settingsData]) => {
        if (cancelled) return;
        setProxyPools(poolData.proxyPools || []);
        const override = (settingsData.providerStrategies || {})[scope] || {};
        setProxyPoolId(override.proxyPoolId || NONE_PROXY_POOL_VALUE);
        setRotateStrategy(override.rotateStrategy || "none");
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [scope]);

  const save = useCallback(
    async (poolId, strategy) => {
      setSaving(true);
      try {
        const res = await fetch("/api/settings", { cache: "no-store" });
        const data = res.ok ? await res.json() : {};
        const current = data.providerStrategies || {};
        const override = { ...(current[scope] || {}) };
        if (poolId === NONE_PROXY_POOL_VALUE) delete override.proxyPoolId;
        else override.proxyPoolId = poolId;
        if (strategy === "none") delete override.rotateStrategy;
        else override.rotateStrategy = strategy;
        const updated = { ...current };
        if (Object.keys(override).length === 0) delete updated[scope];
        else updated[scope] = override;
        await fetch("/api/settings", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ providerStrategies: updated }),
        });
        setSavedFlash(true);
        setTimeout(() => setSavedFlash(false), 1500);
      } catch (e) {
        console.log("Save MCP proxy config error:", e);
      } finally {
        setSaving(false);
      }
    },
    [scope]
  );

  const handlePoolChange = (newPoolId) => {
    setProxyPoolId(newPoolId);
    save(newPoolId, rotateStrategy);
  };

  const handleStrategyChange = (newStrategy) => {
    setRotateStrategy(newStrategy);
    save(proxyPoolId, newStrategy);
  };

  const canRotate = proxyPools.length >= 2;
  const isRotation = rotateStrategy !== "none";

  return (
    <div className="flex-1 flex flex-col gap-1.5">
      <div className="flex flex-wrap items-start gap-2">
        <Select
          className="w-full sm:w-56"
          value={proxyPoolId}
          onChange={(e) => handlePoolChange(e.target.value)}
          disabled={saving || isRotation}
          options={[
            { value: NONE_PROXY_POOL_VALUE, label: "None (direct)" },
            ...proxyPools.map((pool) => ({ value: pool.id, label: pool.name })),
          ]}
        />
        <select
          value={rotateStrategy}
          onChange={(e) => handleStrategyChange(e.target.value)}
          disabled={saving}
          className="py-2 px-3 text-sm text-text-main bg-surface border border-border rounded-[10px] focus:ring-1 focus:ring-primary/30 focus:border-primary/50 focus:outline-none transition-all disabled:opacity-50"
        >
          {STRATEGIES.map((s) => (
            <option key={s.value} value={s.value} disabled={s.value !== "none" && !canRotate}>
              {s.label}
            </option>
          ))}
        </select>
        {savedFlash && <span className="text-[10px] text-green-500 pt-2">Saved</span>}
      </div>
      <p className="text-[10px] text-text-muted leading-snug">
        {proxyPools.length === 0
          ? "No active proxy pools yet — add one under Proxy Pools to route MCP traffic through it."
          : isRotation
            ? `Rotating across ${proxyPools.length} active pools for MCP requests (in-memory, resets on restart).`
            : "Remote MCP servers (probe, marketplace registry) use this pool. Chat, media and MCP all follow the same pool rules."}
      </p>
    </div>
  );
}

McpProxySelect.propTypes = {
  scope: PropTypes.string,
};
