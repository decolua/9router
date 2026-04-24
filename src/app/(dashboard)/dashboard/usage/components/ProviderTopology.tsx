"use client";

import React, { useMemo, useState, useCallback, useRef } from "react";
import {
 ReactFlow,
 Handle,
 Position,
 type Node,
 type Edge,
 type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { AI_PROVIDERS } from "@/shared/constants/providers";

interface Provider {
  provider: string;
  name?: string;
}

interface ActiveRequest {
  provider: string;
  model?: string;
  account?: string;
}

function getProviderConfig(providerId: string) {
 return (AI_PROVIDERS as any)[providerId] || { color: "#6b7280", name: providerId };
}

// Use local provider images from /public/providers/
function getProviderImageUrl(providerId: string) {
 return `/providers/${providerId}.png`;
}

// Custom provider node - rectangle with image + name
function ProviderNode({ data }: NodeProps<any>) {
 const { label, color, imageUrl, textIcon, active } = data as any;
 const [imgError, setImgError] = useState(false);
 return (
 <div
 className="flex items-center gap-2.5 px-4 py-2.5 rounded-lg border-2 transition-all duration-300 bg-background"
 style={{
 borderColor: active ? color : "hsl(var(--border))",
 boxShadow: active ? `0 0 16px ${color}40` : "none",
 minWidth: "150px",
 }}
 >
 <Handle type="target" position={Position.Top} id="top" className="!bg-transparent !border-0 !w-0 !h-0"/>
 <Handle type="target" position={Position.Bottom} id="bottom" className="!bg-transparent !border-0 !w-0 !h-0"/>
 <Handle type="target" position={Position.Left} id="left" className="!bg-transparent !border-0 !w-0 !h-0"/>
 <Handle type="target" position={Position.Right} id="right" className="!bg-transparent !border-0 !w-0 !h-0"/>

 {/* Provider icon */}
 <div
 className="w-8 h-8 rounded-md flex items-center justify-center shrink-0"
 style={{ backgroundColor: `${color}15` }}
 >
 {!imgError ? (
 <img src={imageUrl} alt={label} className="w-6 h-6 rounded-sm object-contain" onError={() => setImgError(true)} />
 ) : (
 <span className="text-sm font-medium" style={{ color }}>{textIcon}</span>
 )}
 </div>

 {/* Provider name */}
 <span
 className="text-base font-medium truncate"
 style={{ color: active ? color : "hsl(var(--foreground))" }}
 >
 {label}
 </span>

 {/* Active indicator */}
 {active && (
 <span className="relative flex h-2 w-2 shrink-0">
 <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ backgroundColor: color }} />
 <span className="relative inline-flex rounded-full h-2 w-2" style={{ backgroundColor: color }} />
 </span>
 )}
 </div>
 );
}

// Center 8Router node
function RouterNode({ data }: NodeProps<any>) {
 const { activeCount } = data as any;
 return (
 <div className="flex items-center justify-center px-5 py-3 rounded-xl border-2 border-primary bg-primary/5 min-w-[130px]">
 <Handle type="source" position={Position.Top} id="top" className="!bg-transparent !border-0 !w-0 !h-0"/>
 <Handle type="source" position={Position.Bottom} id="bottom" className="!bg-transparent !border-0 !w-0 !h-0"/>
 <Handle type="source" position={Position.Left} id="left" className="!bg-transparent !border-0 !w-0 !h-0"/>
 <Handle type="source" position={Position.Right} id="right" className="!bg-transparent !border-0 !w-0 !h-0"/>

 <img src="/favicon.svg" alt="8Router" className="w-6 h-6 mr-2"/>
 <span className="text-sm font-medium text-primary">8Router</span>
 {activeCount > 0 && (
 <span className="ml-2 px-1.5 py-0.5 rounded-full bg-primary text-white text-xs font-medium">
 {activeCount}
 </span>
 )}
 </div>
 );
}

const nodeTypes = { provider: ProviderNode, router: RouterNode };

// Place N nodes evenly along an ellipse around the router center.
function buildLayout(providers: Provider[], activeSet: Set<string>, lastSet: Set<string>, errorSet: Set<string>) {
 const nodeW = 180;
 const nodeH = 30;
 const routerW = 120;
 const routerH = 44;
 const nodeGap = 24;

 const count = providers.length;

 // Compute rx so arc spacing between nodes >= nodeW + nodeGap
 const minRx = ((nodeW + nodeGap) * count) / (2 * Math.PI);
 const rx = Math.max(320, minRx);
 const ry = Math.max(200, rx * 0.55); // ellipse ratio ~0.55
 if (count === 0) {
 return {
 nodes: [{ id: "router", type: "router", position: { x: 0, y: 0 }, data: { activeCount: 0 }, draggable: false }] as Node[],
 edges: [] as Edge[],
 };
 }

 const nodes: Node[] = [];
 const edges: Edge[] = [];

 nodes.push({
 id: "router",
 type: "router",
 position: { x: -routerW / 2, y: -routerH / 2 },
 data: { activeCount: activeSet.size },
 draggable: false,
 });

 const edgeStyle = (active: boolean, last: boolean, error: boolean) => {
 if (error) return { stroke: "#ef4444", strokeWidth: 2.5, opacity: 0.9 };
 if (active) return { stroke: "#22c55e", strokeWidth: 2.5, opacity: 0.9 };
 if (last) return { stroke: "#f59e0b", strokeWidth: 2, opacity: 0.7 };
 return { stroke: "hsl(var(--border))", strokeWidth: 1, opacity: 0.3 };
 };

 providers.forEach((p, i) => {
 const config = getProviderConfig(p.provider);
 const active = activeSet.has(p.provider?.toLowerCase());
 const last = !active && lastSet.has(p.provider?.toLowerCase());
 const error = !active && errorSet.has(p.provider?.toLowerCase());
 const nodeId = `provider-${p.provider}`;
 const data = {
 label: (config.name !== p.provider ? config.name : null) || p.name || p.provider,
 color: config.color || "#6b7280",
 imageUrl: getProviderImageUrl(p.provider),
 textIcon: config.textIcon || (p.provider || "?").slice(0, 2).toUpperCase(),
 active,
 };

 // Distribute evenly starting from top (−π/2), clockwise
 const angle = -Math.PI / 2 + (2 * Math.PI * i) / count;
 const cx = rx * Math.cos(angle);
 const cy = ry * Math.sin(angle);

 // Pick router handle closest to the node direction
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
 data,
 draggable: false,
 });

 edges.push({
 id: `e-${nodeId}`,
 source: "router",
 sourceHandle,
 target: nodeId,
 targetHandle,
 animated: active,
 style: edgeStyle(active, last, error),
 });
 });

 return { nodes, edges };
}

interface ProviderTopologyProps {
  providers: Provider[];
  activeRequests: ActiveRequest[];
  lastProvider?: string;
  errorProvider?: string;
}

export default function ProviderTopology({ providers = [], activeRequests = [], lastProvider = "", errorProvider = "" }: ProviderTopologyProps) {
 // Serialize to stable string keys so useMemo only re-runs when values actually change
 const activeKey = useMemo(
 () => activeRequests.map((r) => r.provider?.toLowerCase()).filter(Boolean).sort().join(","),
 [activeRequests]
 );
 const lastKey = lastProvider?.toLowerCase() || "";
 const errorKey = errorProvider?.toLowerCase() || "";

 const activeSet = useMemo(() => new Set(activeKey ? activeKey.split(",") : []), [activeKey]);
 const lastSet = useMemo(() => new Set(lastKey ? [lastKey] : []), [lastKey]);
 const errorSet = useMemo(() => new Set(errorKey ? [errorKey] : []), [errorKey]);

 const { nodes, edges } = useMemo(
 () => buildLayout(providers, activeSet, lastSet, errorSet),
 [providers, activeKey, lastKey, errorKey]
 );

 // Stable key — only remount when provider list changes
 const providersKey = useMemo(
 () => providers.map((p) => p.provider).sort().join(","),
 [providers]
 );

 const rfInstance = useRef<any>(null);
 const onInit = useCallback((instance: any) => {
 rfInstance.current = instance;
 setTimeout(() => instance.fitView({ padding: 0.3 }), 50);
 }, []);

 return (
 <div className="w-full h-full bg-background/50">
 {providers.length === 0 ? (
 <div className="h-full flex items-center justify-center text-muted-foreground text-sm font-medium">
 Chưa kết nối nhà cung cấp
 </div>
 ) : (
 <ReactFlow
 key={providersKey}
 nodes={nodes}
 edges={edges}
 nodeTypes={nodeTypes as any}
 fitView
 fitViewOptions={{ padding: 0.3 }}
 onInit={onInit}
 proOptions={{ hideAttribution: true }}
 panOnDrag={false}
 zoomOnScroll={false}
 zoomOnPinch={false}
 zoomOnDoubleClick={false}
 preventScrolling={false}
 nodesDraggable={false}
 nodesConnectable={false}
 elementsSelectable={false}
 />
 )}
 </div>
 );
}
