"use client";

import { useMemo, useState, useEffect, useCallback, useRef } from "react";
import PropTypes from "prop-types";
import {
  ReactFlow,
  Handle,
  Position,
  Controls,
  ControlButton,
  BaseEdge,
  getBezierPath,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { AI_PROVIDERS } from "@/shared/constants/providers";
import { getProviderIconSrc, markProviderIconMissing } from "@/shared/utils/providerIcon";

// Force-stop FE animation if a provider stays active longer than this
const FE_ACTIVE_TIMEOUT_MS = 60000;
const FE_ACTIVE_TICK_MS = 1000;

// Kame + electric particles along active edges
const KAME_PARTICLE_COUNT = 6;
const SPARK_COUNT = 5;

function getProviderConfig(providerId) {
  return AI_PROVIDERS[providerId] || { color: "#6b7280", name: providerId };
}

function getProviderImageUrl(providerId) {
  return getProviderIconSrc(providerId);
}

// Custom Provider Node — connected to router and branching out to models
function ProviderNode({ data }) {
  const { label, color, imageUrl, textIcon, active } = data;
  const [imgError, setImgError] = useState(false);
  return (
    <div
      className="flex items-center gap-2.5 px-3.5 py-2 rounded-lg border-2 transition-all duration-300 bg-bg"
      style={{
        borderColor: active ? color : "var(--color-border)",
        boxShadow: active ? `0 0 18px ${color}50` : "none",
        minWidth: "140px",
      }}
    >
      {/* Target handles from Router */}
      <Handle type="target" position={Position.Top} id="top" className="!bg-transparent !border-0 !w-0 !h-0" />
      <Handle type="target" position={Position.Bottom} id="bottom" className="!bg-transparent !border-0 !w-0 !h-0" />
      <Handle type="target" position={Position.Left} id="left" className="!bg-transparent !border-0 !w-0 !h-0" />
      <Handle type="target" position={Position.Right} id="right" className="!bg-transparent !border-0 !w-0 !h-0" />

      {/* Source handles to Model sub-nodes */}
      <Handle type="source" position={Position.Top} id="s-top" className="!bg-transparent !border-0 !w-0 !h-0" />
      <Handle type="source" position={Position.Bottom} id="s-bottom" className="!bg-transparent !border-0 !w-0 !h-0" />
      <Handle type="source" position={Position.Left} id="s-left" className="!bg-transparent !border-0 !w-0 !h-0" />
      <Handle type="source" position={Position.Right} id="s-right" className="!bg-transparent !border-0 !w-0 !h-0" />

      {/* Provider icon */}
      <div
        className="w-5 h-5 rounded flex items-center justify-center shrink-0"
        style={{ backgroundColor: `${color}15` }}
      >
        {imageUrl && !imgError ? (
          <img
            src={imageUrl}
            alt={label}
            className="w-3.5 h-3.5 rounded-sm object-contain"
            loading="lazy"
            decoding="async"
            onError={() => {
              const m = imageUrl?.match(/^\/providers\/([^/]+)\.png$/i);
              if (m) markProviderIconMissing(m[1]);
              setImgError(true);
            }}
          />
        ) : (
          <span className="text-[9px] font-bold" style={{ color }}>{textIcon}</span>
        )}
      </div>

      {/* Provider name */}
      <span
        className="text-sm font-semibold truncate"
        style={{ color: active ? color : "var(--color-text)" }}
      >
        {label}
      </span>

      {/* Active indicator */}
      {active && (
        <span className="relative flex h-2 w-2 shrink-0 ml-auto">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ backgroundColor: color }} />
          <span className="relative inline-flex rounded-full h-2 w-2" style={{ backgroundColor: color }} />
        </span>
      )}
    </div>
  );
}

ProviderNode.propTypes = {
  data: PropTypes.object.isRequired,
};

// Custom Model Sub-Node — branches out from Provider
function ModelNode({ data }) {
  const { label, active, radialRotation = 0, radialHandle = "left" } = data;
  return (
    <div className="relative h-7 w-40">
      <div
        className={`absolute left-1/2 top-1/2 flex w-max max-w-40 items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-mono text-[10px] tracking-tight transition-all duration-300 ${
          active
            ? "bg-cyan-950/70 border-cyan-400 text-cyan-200 shadow-[0_0_14px_rgba(34,211,238,0.75)] font-bold animate-pulse z-20 scale-105"
            : "bg-bg-subtle/95 border-border/80 text-text-muted hover:border-primary/50 hover:text-text shadow-xs"
        }`}
        style={{
          transform: `translate(-50%, -50%) rotate(${radialRotation}deg)`,
          transformOrigin: "center",
        }}
      >
        {/* Keep the edge attached to the rotated pill side facing 9Router. */}
        <Handle
          type="target"
          position={radialHandle === "right" ? Position.Right : Position.Left}
          id="radial"
          className="!bg-transparent !border-0 !w-0 !h-0"
        />

        {/* Active pulse dot */}
        <span className="relative flex h-1.5 w-1.5 shrink-0">
          {active ? (
            <>
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-80" />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-cyan-400" />
            </>
          ) : (
            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-text-muted/40" />
          )}
        </span>

        <span className="truncate" title={label}>
          {label}
        </span>
      </div>
    </div>
  );
}

ModelNode.propTypes = {
  data: PropTypes.object.isRequired,
};

// Center 9Router node — pulse/glow on card only
function RouterNode({ data }) {
  const powering = (data.activeCount || 0) > 0;
  return (
    <div
      className={`relative z-[1] flex items-center justify-center px-5 py-3 rounded-xl border-2 min-w-[130px] ${
        powering
          ? "topology-router-core border-yellow-300 bg-gradient-to-br from-primary/30 via-yellow-400/20 to-cyan-400/25"
          : "border-primary bg-primary/5 shadow-md"
      }`}
    >
      <Handle type="source" position={Position.Top} id="top" className="!bg-transparent !border-0 !w-0 !h-0" />
      <Handle type="source" position={Position.Bottom} id="bottom" className="!bg-transparent !border-0 !w-0 !h-0" />
      <Handle type="source" position={Position.Left} id="left" className="!bg-transparent !border-0 !w-0 !h-0" />
      <Handle type="source" position={Position.Right} id="right" className="!bg-transparent !border-0 !w-0 !h-0" />

      <img
        src="/favicon.svg"
        alt="9Router"
        className={`w-6 h-6 mr-2 ${powering ? "topology-router-icon" : ""}`}
        loading="lazy"
        decoding="async"
      />
      <span className={`text-sm font-bold ${powering ? "topology-router-label text-yellow-300" : "text-primary"}`}>
        9Router
      </span>
      {data.activeCount > 0 && (
        <span className="ml-2 px-1.5 py-0.5 rounded-full bg-yellow-400 text-black text-xs font-bold topology-router-badge">
          {data.activeCount}
        </span>
      )}
    </div>
  );
}

RouterNode.propTypes = {
  data: PropTypes.object.isRequired,
};

// Topology Edge (Bezier curve with electric Kame animation when active)
function TopologyEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style = {},
  data,
}) {
  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });
  const active = !!data?.active;
  const stroke = style.stroke || "var(--color-border)";
  const filterId = `topo-electric-${id}`;

  if (!active) {
    return <BaseEdge id={id} path={edgePath} style={{ ...style, stroke }} />;
  }

  return (
    <g className="topology-edge-electric">
      <defs>
        <filter id={filterId} x="-40%" y="-40%" width="180%" height="180%">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="2" result="noise">
            <animate attributeName="baseFrequency" values="0.8;1.4;0.8" dur="0.25s" repeatCount="indefinite" />
          </feTurbulence>
          <feDisplacementMap in="SourceGraphic" in2="noise" scale="3.5" xChannelSelector="R" yChannelSelector="G" />
        </filter>
      </defs>
      {/* Outer electric halo */}
      <path
        d={edgePath}
        fill="none"
        stroke="#22d3ee"
        strokeWidth={10}
        strokeOpacity={0.35}
        strokeLinecap="round"
        filter={`url(#${filterId})`}
        className="topology-edge-halo"
      />
      {/* Mid plasma */}
      <path
        d={edgePath}
        fill="none"
        stroke="#4ade80"
        strokeWidth={5}
        strokeOpacity={0.85}
        strokeLinecap="round"
        filter={`url(#${filterId})`}
        className="topology-edge-plasma"
      />
      {/* Hot white core */}
      <BaseEdge
        id={id}
        path={edgePath}
        style={{ stroke: "#f8fafc", strokeWidth: 2.2, opacity: 1 }}
        className="topology-edge-kame"
      />
      {/* Energy orbs */}
      {Array.from({ length: KAME_PARTICLE_COUNT }, (_, i) => (
        <circle
          key={`${id}-p-${i}`}
          r={i % 2 === 0 ? 4 : 2.5}
          fill={i % 3 === 0 ? "#fde047" : i % 3 === 1 ? "#67e8f9" : "#fff"}
          opacity={0.95}
          style={{ filter: "drop-shadow(0 0 4px #22d3ee)" }}
        >
          <animateMotion
            dur={`${0.4 + i * 0.08}s`}
            repeatCount="indefinite"
            path={edgePath}
            begin={`${i * 0.09}s`}
          />
        </circle>
      ))}
      {/* Electric sparks */}
      {Array.from({ length: SPARK_COUNT }, (_, i) => (
        <circle
          key={`${id}-s-${i}`}
          r={1.8}
          fill="#e0f2fe"
          opacity={0}
        >
          <animate
            attributeName="opacity"
            values="0;1;0;0;1;0"
            dur={`${0.35 + (i % 3) * 0.1}s`}
            begin={`${i * 0.07}s`}
            repeatCount="indefinite"
          />
          <animateMotion
            dur={`${0.28 + i * 0.05}s`}
            repeatCount="indefinite"
            path={edgePath}
            begin={`${i * 0.11}s`}
          />
        </circle>
      ))}
    </g>
  );
}

TopologyEdge.propTypes = {
  id: PropTypes.string,
  sourceX: PropTypes.number,
  sourceY: PropTypes.number,
  targetX: PropTypes.number,
  targetY: PropTypes.number,
  sourcePosition: PropTypes.string,
  targetPosition: PropTypes.string,
  style: PropTypes.object,
  data: PropTypes.object,
};

const nodeTypes = { provider: ProviderNode, router: RouterNode, model: ModelNode };
const edgeTypes = { topology: TopologyEdge };

// Place 9Router center, Providers on inner ellipse, Models branching on outer ellipse
function buildLayout(providers, activeSet, activeModelSet, lastSet, errorSet, modelDisplayMode = "on") {
  const nodeW = 150;
  const nodeH = 34;
  const modelW = 160;
  const modelH = 28;
  const routerW = 120;
  const routerH = 44;
  const count = providers.length;

  if (count === 0) {
    return {
      nodes: [{ id: "router", type: "router", position: { x: 0, y: 0 }, data: { activeCount: activeSet.size }, draggable: false }],
      edges: [],
    };
  }

  const rx = Math.max(185, (125 * count) / (2 * Math.PI));
  const ry = Math.max(145, rx * 0.72);

  const nodes = [];
  const edges = [];

  nodes.push({
    id: "router",
    type: "router",
    position: { x: -routerW / 2, y: -routerH / 2 },
    data: { activeCount: activeSet.size },
    draggable: false,
  });

  const edgeStyle = (active, last, error) => {
    if (error) return { stroke: "#ef4444", strokeWidth: 2.5, opacity: 0.9 };
    if (active) return { stroke: "#22d3ee", strokeWidth: 3.5, opacity: 1 };
    if (last) return { stroke: "#f59e0b", strokeWidth: 2, opacity: 0.7 };
    return { stroke: "var(--color-border)", strokeWidth: 1, opacity: 0.3 };
  };

  providers.forEach((p, i) => {
    const config = getProviderConfig(p.provider);
    const pKey = p.provider?.toLowerCase();
    const models = p.models || [];

    // Check if any model under this provider is active
    const hasActiveModel = models.some((m) => {
      const mKey = m.toLowerCase();
      return activeModelSet.has(mKey) || activeModelSet.has(`${pKey}/${mKey}`);
    });
    const active = activeSet.has(pKey) || hasActiveModel;
    const last = !active && lastSet.has(pKey);
    const error = !active && errorSet.has(pKey);
    const nodeId = `provider-${p.provider}`;

    // Angle distribution for providers around router center
    const angle = -Math.PI / 2 + (2 * Math.PI * i) / count;
    const cx = rx * Math.cos(angle);
    const cy = ry * Math.sin(angle);

    let sourceHandle, targetHandle;
    if (Math.abs(angle + Math.PI / 2) < Math.PI / 4 || Math.abs(angle - 3 * Math.PI / 2) < Math.PI / 4) {
      sourceHandle = "top"; targetHandle = "bottom";
    } else if (Math.abs(angle - Math.PI / 2) < Math.PI / 4) {
      sourceHandle = "bottom"; targetHandle = "top";
    } else if (cx > 0) {
      sourceHandle = "right"; targetHandle = "left";
    } else {
      sourceHandle = "left"; targetHandle = "right";
    }

    nodes.push({
      id: nodeId,
      type: "provider",
      position: { x: cx - nodeW / 2, y: cy - nodeH / 2 },
      data: {
        label: (config.name !== p.provider ? config.name : null) || p.nodeName || p.name || p.provider,
        color: config.color || "#6b7280",
        imageUrl: getProviderImageUrl(p.provider),
        textIcon: config.textIcon || (p.provider || "?").slice(0, 2).toUpperCase(),
        active,
      },
      draggable: false,
    });

    edges.push({
      id: `e-${nodeId}`,
      type: "topology",
      source: "router",
      sourceHandle,
      target: nodeId,
      targetHandle,
      animated: false,
      data: { active },
      style: edgeStyle(active, last, error),
    });

    // Filter models based on modelDisplayMode ("on" | "auto" | "off")
    let modelsToRender = [];
    if (modelDisplayMode === "on") {
      modelsToRender = models;
    } else if (modelDisplayMode === "auto") {
      modelsToRender = models.filter((m) => {
        const mKey = m.toLowerCase();
        return activeModelSet.has(mKey) || activeModelSet.has(`${pKey}/${mKey}`);
      });
    } else {
      // "off" mode -> no model sub-nodes
      modelsToRender = [];
    }

    // Branch out Model sub-nodes in multi-tier concentric tree arcs to guarantee 0 text overlap
    if (modelsToRender.length > 0) {
      const mCount = modelsToRender.length;

      // Determine number of concentric layers based on model count
      const numLayers = mCount > 9 ? 3 : (mCount > 3 ? 2 : 1);

      modelsToRender.forEach((m, j) => {
        const modelId = `model-${p.provider}-${m}`;
        const mKey = m.toLowerCase();
        const modelActive = activeModelSet.has(mKey) || activeModelSet.has(`${pKey}/${mKey}`);

        // Layer/Row allocation
        const layerIndex = j % numLayers;
        const colIndex = Math.floor(j / numLayers);
        const itemsInThisLayer = Math.ceil((mCount - layerIndex) / numLayers);
        const midCol = (itemsInThisLayer - 1) / 2;
        const colOffset = colIndex - midCol;

        // Keep every provider's fan inside its own angular sector. This prevents
        // neighbouring providers from crossing into each other's radial labels.
        const providerSector = (2 * Math.PI) / count;
        const usableFan = providerSector * 0.68;
        const fanStep = itemsInThisLayer > 1 ? usableFan / (itemsInThisLayer - 1) : 0;
        const mAngle = angle + colOffset * fanStep;

        // Radial labels use their long axis toward 9Router, so each tier needs
        // enough depth for the whole pill rather than only its horizontal height.
        const baseDist = 120;
        const layerSpacing = 150;
        const distOffset = baseDist + layerIndex * layerSpacing + Math.abs(colOffset) * 16;

        const mx = (rx + distOffset) * Math.cos(mAngle);
        const my = (ry + (distOffset * 0.85)) * Math.sin(mAngle);

        // Align the model name's axis to the actual line through the 9Router
        // center. Flip labels on the left half so their text remains upright.
        const radialAngle = Math.atan2(my, mx);
        let radialRotation = (radialAngle * 180) / Math.PI;
        if (radialRotation > 90) radialRotation -= 180;
        if (radialRotation < -90) radialRotation += 180;
        const radialHandle = Math.cos(radialAngle) < 0 ? "right" : "left";

        // Pick handle connections matching the same center-based radial direction
        let pSourceHandle = "s-right";
        if (radialAngle < -Math.PI / 4 && radialAngle > -(3 * Math.PI) / 4) {
          pSourceHandle = "s-top";
        } else if (radialAngle > Math.PI / 4 && radialAngle < (3 * Math.PI) / 4) {
          pSourceHandle = "s-bottom";
        } else if (Math.cos(radialAngle) < 0) {
          pSourceHandle = "s-left";
        }

        nodes.push({
          id: modelId,
          type: "model",
          position: { x: mx - modelW / 2, y: my - modelH / 2 },
          data: {
            label: m,
            active: modelActive,
            color: config.color || "#22d3ee",
            radialRotation,
            radialHandle,
          },
          draggable: false,
        });

        edges.push({
          id: `e-${modelId}`,
          type: "topology",
          source: nodeId,
          sourceHandle: pSourceHandle,
          target: modelId,
          targetHandle: "radial",
          animated: false,
          data: { active: modelActive },
          style: edgeStyle(modelActive, false, false),
        });
      });
    }
  });

  return { nodes, edges };
}

export default function ProviderTopology({ providers = [], activeRequests = [], lastProvider = "", errorProvider = "" }) {
  // Stable active tracking
  const activeKey = useMemo(
    () => (activeRequests || []).map((r) => `${r.provider}:${r.model}`).sort().join(","),
    [activeRequests]
  );
  const lastKey = lastProvider?.toLowerCase() || "";
  const errorKey = errorProvider?.toLowerCase() || "";

  const rawActiveData = useMemo(() => {
    const pSet = new Set();
    const mSet = new Set();
    (activeRequests || []).forEach((r) => {
      if (r.provider) pSet.add(r.provider.toLowerCase());
      if (r.model) {
        const norm = r.model.toLowerCase();
        mSet.add(norm);
        if (norm.includes("/")) {
          mSet.add(norm.split("/").pop());
        }
      }
    });
    return { pSet, mSet };
  }, [activeKey]);

  const lastSet = useMemo(() => new Set(lastKey ? [lastKey] : []), [lastKey]);
  const errorSet = useMemo(() => new Set(errorKey ? [errorKey] : []), [errorKey]);

  const firstSeenRef = useRef({});
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const seen = firstSeenRef.current;
    const now = Date.now();
    for (const p of rawActiveData.pSet) {
      if (!seen[p]) seen[p] = now;
    }
    for (const p of Object.keys(seen)) {
      if (!rawActiveData.pSet.has(p)) delete seen[p];
    }
  }, [rawActiveData]);

  useEffect(() => {
    if (rawActiveData.pSet.size === 0) return;
    const id = setInterval(() => setTick((t) => t + 1), FE_ACTIVE_TICK_MS);
    return () => clearInterval(id);
  }, [rawActiveData]);

  const activeSet = useMemo(() => {
    const now = Date.now();
    const filtered = new Set();
    for (const p of rawActiveData.pSet) {
      const ts = firstSeenRef.current[p];
      if (!ts || now - ts < FE_ACTIVE_TIMEOUT_MS) filtered.add(p);
    }
    return filtered;
  }, [rawActiveData, tick]);

  const activeModelSet = rawActiveData.mSet;

  // 3-way model display mode ("on" | "auto" | "off")
  const [modelDisplayMode, setModelDisplayMode] = useState("auto");
  const [activeView, setActiveView] = useState("providers");

  const { nodes, edges } = useMemo(
    () => buildLayout(providers, activeSet, activeModelSet, lastSet, errorSet, modelDisplayMode),
    [providers, activeSet, activeModelSet, lastSet, errorSet, modelDisplayMode]
  );

  const providersKey = useMemo(
    () => providers.map((p) => `${p.provider}:${(p.models || []).join("-")}`).sort().join(","),
    [providers]
  );

  const rfInstance = useRef(null);
  const containerRef = useRef(null);

  const fitCurrentView = useCallback((view = activeView) => {
    if (!rfInstance.current || nodes.length === 0) return;
    if (view === "providers") {
      const providerNodes = nodes.filter((n) => n.type === "router" || n.type === "provider");
      rfInstance.current.fitView({ nodes: providerNodes.length > 0 ? providerNodes : nodes, padding: -0.15, duration: 300 });
    } else {
      rfInstance.current.fitView({ padding: 0.05, duration: 300 });
    }
  }, [nodes, activeView]);

  const onInit = useCallback((instance) => {
    rfInstance.current = instance;
    setTimeout(() => {
      const providerNodes = nodes.filter((n) => n.type === "router" || n.type === "provider");
      instance.fitView({ nodes: providerNodes.length > 0 ? providerNodes : nodes, padding: -0.15, duration: 300 });
    }, 60);
  }, [nodes]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      fitCurrentView(activeView);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [fitCurrentView, activeView]);

  useEffect(() => {
    if (rfInstance.current && nodes.length > 0) {
      const id = setTimeout(() => fitCurrentView(activeView), 60);
      return () => clearTimeout(id);
    }
  }, [nodes.length, activeView, fitCurrentView]);

  const handleFitAllModels = useCallback(() => {
    setActiveView("models");
    fitCurrentView("models");
  }, [fitCurrentView]);

  const handleFitProvidersOnly = useCallback(() => {
    setActiveView("providers");
    fitCurrentView("providers");
  }, [fitCurrentView]);

  return (
    <div ref={containerRef} className="relative h-[380px] w-full min-w-0 rounded-lg border border-border bg-bg-subtle/30 sm:h-[540px]">
      {/* Floating Control Bar */}
      {providers.length > 0 && (
        <div className="absolute top-3 right-3 z-10 flex flex-wrap items-center gap-2 rounded-lg border border-border/80 bg-bg/90 p-1.5 backdrop-blur-md shadow-md text-xs">
          {/* Models 3-Way Toggle (ON / AUTO / OFF) */}
          <div className="flex items-center gap-1 bg-bg-subtle/90 px-1 py-0.5 rounded-md border border-border/60">
            <span className="text-[11px] text-text-muted px-1 font-semibold">Models:</span>
            <button
              type="button"
              onClick={() => setModelDisplayMode("on")}
              className={`px-2 py-0.5 rounded text-[11px] font-bold transition-all ${
                modelDisplayMode === "on"
                  ? "bg-primary text-white shadow-xs"
                  : "text-text-muted hover:text-text hover:bg-bg-hover"
              }`}
              title="Munculkan SEMUA cabang model"
            >
              ON
            </button>
            <button
              type="button"
              onClick={() => setModelDisplayMode("auto")}
              className={`px-2 py-0.5 rounded text-[11px] font-bold transition-all ${
                modelDisplayMode === "auto"
                  ? "bg-cyan-500 text-white shadow-xs"
                  : "text-text-muted hover:text-text hover:bg-bg-hover"
              }`}
              title="Model HANYA muncul saat sedang diproses/aktif"
            >
              AUTO
            </button>
            <button
              type="button"
              onClick={() => setModelDisplayMode("off")}
              className={`px-2 py-0.5 rounded text-[11px] font-bold transition-all ${
                modelDisplayMode === "off"
                  ? "bg-stone-700 text-white shadow-xs"
                  : "text-text-muted hover:text-text hover:bg-bg-hover"
              }`}
              title="Sembunyikan SEMUA cabang model"
            >
              OFF
            </button>
          </div>

          <div className="w-[1px] h-4 bg-border/60" />

          {/* View Fit Zoom Switcher */}
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={handleFitProvidersOnly}
              className={`flex items-center gap-1 px-2 py-0.5 rounded-md font-medium transition-colors ${
                activeView === "providers"
                  ? "bg-primary/20 text-primary border border-primary/30 font-semibold"
                  : "text-text-muted hover:text-text hover:bg-bg-hover"
              }`}
              title="Zoom In 115% Fokus ke Provider"
            >
              <span className="material-symbols-outlined text-[14px]">hub</span>
              <span>Providers</span>
            </button>
            <button
              type="button"
              onClick={handleFitAllModels}
              className={`flex items-center gap-1 px-2 py-0.5 rounded-md font-medium transition-colors ${
                activeView === "models"
                  ? "bg-primary/20 text-primary border border-primary/30 font-semibold"
                  : "text-text-muted hover:text-text hover:bg-bg-hover"
              }`}
              title="Zoom Full semua model"
            >
              <span className="material-symbols-outlined text-[14px]">account_tree</span>
              <span>All</span>
            </button>
          </div>
        </div>
      )}

      {providers.length === 0 ? (
        <div className="h-full flex items-center justify-center text-text-muted text-sm">
          No providers connected
        </div>
      ) : (
        <ReactFlow
          key={providersKey}
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          fitView={false}
          minZoom={0.5}
          maxZoom={2.5}
          onInit={onInit}
          proOptions={{ hideAttribution: true }}
          panOnDrag
          zoomOnScroll
          zoomOnPinch
          zoomOnDoubleClick
          preventScrolling={false}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
        >
          <Controls showInteractive={false} className="react-flow-controls-custom">
            <ControlButton onClick={handleFitProvidersOnly} title="Zoom In 115% Providers Only">
              <span className="material-symbols-outlined text-[16px]">hub</span>
            </ControlButton>
            <ControlButton onClick={handleFitAllModels} title="Fit All Models">
              <span className="material-symbols-outlined text-[16px]">fit_screen</span>
            </ControlButton>
          </Controls>
        </ReactFlow>
      )}
    </div>
  );
}

ProviderTopology.propTypes = {
  providers: PropTypes.arrayOf(PropTypes.shape({
    id: PropTypes.string,
    provider: PropTypes.string,
    name: PropTypes.string,
    models: PropTypes.arrayOf(PropTypes.string),
  })),
  activeRequests: PropTypes.arrayOf(PropTypes.shape({
    provider: PropTypes.string,
    model: PropTypes.string,
    account: PropTypes.string,
  })),
  lastProvider: PropTypes.string,
  errorProvider: PropTypes.string,
};

