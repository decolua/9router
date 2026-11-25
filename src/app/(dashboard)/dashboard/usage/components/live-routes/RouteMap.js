"use client";

import { useMemo, useState } from "react";
import ProviderIcon from "@/shared/components/ProviderIcon";
import { translate } from "@/i18n/runtime";
import { UNASSIGNED, accountKeyOf, clientKeyOf, maskEmail, sessionKeyOf, shortId } from "@/shared/utils/liveRoutes";
import { modelColor } from "./modelPalette";
import RouteTooltip from "./RouteTooltip";

export const ROW = 34;
export const HEADER = 28;
// Model hub box: 2px border + 8px padding around a 20px title with 4px gap.
const HUB_BORDER = 2;
const HUB_PADDING = 8;
const HUB_TITLE = 24;
// Distance from the hub's top edge to the centre line of its first row, minus ROW / 2.
const MODEL_OFFSET = HUB_BORDER + HUB_PADDING + HUB_TITLE;
const HUB_CHROME = 2 * (HUB_BORDER + HUB_PADDING) + HUB_TITLE;
const BOTTOM_GAP = 12;
const COLUMN_X = {
  account: { left: 0, right: 240 },
  model: { left: 320, right: 480 },
  client: { left: 560, right: 770 },
  session: { left: 840, right: 1000 },
};

const COLUMNS = [
  ["account", "Entry · Accounts"],
  ["model", "Models"],
  ["client", "Harness / Client"],
  ["session", "Sessions"],
];

function nodeY(index) {
  return HEADER + index * ROW + ROW / 2;
}

function endpointId(nodes, id, kind) {
  return nodes.some(node => node.id === id) ? id : `${kind}:more`;
}

function endpointY(nodes, id, kind) {
  const resolved = endpointId(nodes, id, kind);
  const y = nodeY(Math.max(0, nodes.findIndex(node => node.id === resolved)));
  return kind === "model" ? y + MODEL_OFFSET : y;
}

function pathFor(from, to, y1, y2) {
  const bend = from + (to - from) * 0.5;
  return `M ${from} ${y1} C ${bend} ${y1}, ${bend} ${y2}, ${to} ${y2}`;
}

function NodeMeta({ node, kind, reveal, now }) {
  if (kind === "account") {
    return (
      <>
        <span className="block truncate text-xs font-semibold text-text-main">
          {maskEmail(node.label, reveal)}
        </span>
        <span className="block truncate font-mono text-[10px] text-text-muted">
          {node.id === UNASSIGNED ? "Rejected before routing" : `${node.providerName || node.provider || "—"} · ${shortId(node.id)}`}
        </span>
      </>
    );
  }
  if (kind === "client") {
    const idle = node.inProgress === 0 && node.lastSeen
      ? ` · Idle ${Math.max(0, Math.floor((now - node.lastSeen) / 60000))} min`
      : "";
    return (
      <>
        <span className="block truncate text-xs font-semibold text-text-main">{node.label}{node.version ? ` ${node.version}` : ""}</span>
        <span className="block truncate font-mono text-[10px] text-text-muted" data-i18n-skip>
          {[node.ip, `${node.sessions} ${translate(node.sessions === 1 ? "session" : "sessions")}`].filter(Boolean).join(" · ")}
          {idle}
        </span>
      </>
    );
  }
  return (
    <span className={`block truncate font-mono text-[11px] ${node.status === "running" ? "text-text-main" : "text-text-muted"}`}>
      {node.label}
    </span>
  );
}

function NodeRow({ node, kind, reveal, active, color, now, onSelect, onHover }) {
  if (node.kind === "more") {
    return (
      <button
        type="button"
        className="flex h-[34px] w-full items-center justify-between border-b border-border-subtle/60 px-2 text-left text-xs text-text-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
        onClick={() => onSelect?.(null)}
        onMouseEnter={event => onHover?.({ kind, node }, event)}
        onMouseLeave={() => onHover?.(null)}
      >
        <span>{node.label}</span>
        <span className="font-mono text-[10px]">×{node.requests} · ●{node.inProgress}</span>
      </button>
    );
  }
  const isAccount = kind === "account";
  const isClient = kind === "client";
  const isSession = kind === "session";
  const base = isAccount
    ? "flex h-[34px] w-full items-center gap-2 rounded-lg border border-border-subtle px-2 text-left"
    : "flex h-[34px] w-full items-center gap-2 px-2 text-left";
  return (
    <button
      type="button"
      className={`${base} ${active ? "bg-primary/10 ring-1 ring-primary/50" : "hover:bg-surface-2/50"} focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${node.status !== "running" && isSession ? "text-text-muted" : ""}`}
      onClick={() => onSelect?.({ kind, id: node.id })}
      onMouseEnter={event => onHover?.({ kind, node }, event)}
      onMouseLeave={() => onHover?.(null)}
      onFocus={event => onHover?.({ kind, node }, event)}
      onBlur={() => onHover?.(null)}
      onKeyDown={event => {
        if (event.key === "Escape") {
          onSelect?.(null);
          event.currentTarget.blur();
        }
        if (event.key === "Enter") onSelect?.({ kind, id: node.id });
      }}
    >
      {isAccount && (
        <span
          className="grid size-7 shrink-0 place-items-center rounded-full border border-primary/50 text-[10px] font-mono text-primary"
          style={{ background: `conic-gradient(var(--color-primary) ${(node.inProgress / Math.max(1, node.requests)) * 360}deg, transparent 0)` }}
        >
          <span className="grid size-5 place-items-center rounded-full bg-surface">{node.inProgress}</span>
        </span>
      )}
      {isAccount && <ProviderIcon providerId={node.provider} size={18} alt="" fallbackText="" className="shrink-0" />}
      {isClient && <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />}
      <span className={`min-w-0 flex-1 ${isSession ? "text-right" : ""}`}>
        <NodeMeta node={node} kind={kind} reveal={reveal} now={now} />
      </span>
      <span className="shrink-0 text-[10px] tabular-nums text-text-muted">
        ×{node.requests} <span className="text-primary">●{node.inProgress}</span>
      </span>
    </button>
  );
}

function ModelHub({ nodes, modelIds, title, filter, onSelect, onHover }) {
  return (
    <div className="rounded-xl border-2 border-border bg-surface/90 p-2 shadow-[var(--shadow-soft)]">
      <div className="mb-1 flex h-5 items-center justify-between px-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-text-muted">
        <span>{title}</span>
        <span>{nodes.reduce((sum, node) => sum + (node.kind === "more" ? node.moreCount : 1), 0)}</span>
      </div>
      {nodes.map(node => (
        <div key={node.id} className="h-[34px]">
          <NodeRow
            node={node}
            kind="model"
            color={modelColor(node.id, modelIds)}
            active={filter?.kind === "model" && filter.id === node.id}
            onSelect={onSelect}
            onHover={onHover}
          />
        </div>
      ))}
    </div>
  );
}

function MapColumn({ kind, title, alignRight = false, children }) {
  const { left, right } = COLUMN_X[kind];
  return (
    <div className="absolute inset-y-0" style={{ left: `${left / 10}%`, width: `${(right - left) / 10}%` }}>
      <div className={`h-7 px-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-text-muted ${alignRight ? "text-right" : ""}`}>
        {title}
      </div>
      {children}
    </div>
  );
}

export default function RouteMap({ summary, reveal, filter, onFilter }) {
  const [hover, setHover] = useState(null);
  const [pointer, setPointer] = useState({ x: 0, y: 0 });
  const modelIds = summary.models.map(model => model.id);
  const visible = summary.visible || {
    accounts: summary.accounts,
    models: summary.models,
    clients: summary.clients,
    sessions: summary.sessions,
  };
  const rows = Math.max(...COLUMNS.map(([kind]) => visible[`${kind}s`].length), 1);
  // Tall enough for the longest column and for the hub box, so nothing overflows into a scrollbar.
  const hubHeight = HUB_CHROME + Math.max(1, visible.models.length) * ROW;
  const height = HEADER + Math.max(rows * ROW, hubHeight) + BOTTOM_GAP + 24;
  const recordForHover = useMemo(() => {
    if (!hover) return null;
    if (hover.edge) {
      return summary.records.find(record => record.model === hover.edge.model
        && (accountKeyOf(record)) === hover.edge.account)
        || summary.records.find(record => record.model === hover.edge.model);
    }
    const { node, kind } = hover;
    return summary.records.find(record => {
      const client = clientKeyOf(record);
      const session = sessionKeyOf(record);
      const id = kind === "account" ? (accountKeyOf(record))
        : kind === "client" ? client : kind === "session" ? session : record.model;
      return id === node?.id;
    });
  }, [hover, summary.records]);
  const handleHover = (value, event) => {
    setHover(value);
    if (event) setPointer({ x: event.clientX, y: event.clientY });
  };
  const edgeOpacity = edge => {
    if (!hover) return 0.5;
    if (hover.edge === edge) return 0.92;
    if (hover.node?.id && [edge.account, edge.model, edge.client, edge.session].includes(hover.node.id)) return 0.92;
    if (hover.node?.kind === "more") {
      const endpoint = edge[hover.kind];
      const nodes = visible[`${hover.kind}s`];
      if (hover.node.id === `${hover.kind}:more` && endpoint && !nodes.some(node => node.id === endpoint)) return 0.92;
    }
    return 0.12;
  };
  const renderEdge = (edge, kind, index) => {
    const sourceKind = kind === "accountModel" ? "account" : kind === "modelClient" ? "model" : "client";
    const targetKind = kind === "accountModel" ? "model" : kind === "modelClient" ? "client" : "session";
    const sourceNodes = visible[`${sourceKind}s`];
    const targetNodes = visible[`${targetKind}s`];
    const from = COLUMN_X[sourceKind].right;
    const to = COLUMN_X[targetKind].left;
    const y1 = endpointY(sourceNodes, edge[sourceKind], sourceKind);
    const y2 = endpointY(targetNodes, edge[targetKind], targetKind);
    const color = modelColor(edge.model, modelIds);
    const edgeMax = Math.max(1, ...(summary[kind] || []).map(item => item.requests));
    const width = 2 + 14 * (edge.requests / edgeMax);
    const selected = edgeOpacity(edge);
    return (
      <g
        key={`${kind}-${edge.account || edge.client || ""}-${edge.model || ""}-${edge.session || index}`}
        fill="none"
        stroke={color}
        strokeLinecap="round"
        strokeOpacity={selected}
        strokeWidth={width}
        onMouseEnter={event => handleHover({ edge }, event)}
        onMouseLeave={() => handleHover(null)}
      >
        <path d={pathFor(from, to, y1, y2)} />
        {edge.inProgress > 0 && <path className="route-live-flow" d={pathFor(from, to, y1, y2)} strokeWidth={Math.max(1, width * 0.28)} strokeDasharray="4 8" />}
      </g>
    );
  };

  return (
    <div className="overflow-x-auto overflow-y-hidden rounded-xl border border-border-subtle bg-surface/70">
      <div className="relative min-w-[900px] p-3" style={{ height }} onMouseMove={event => hover && setPointer({ x: event.clientX, y: event.clientY })}>
        <svg aria-hidden="true" className="pointer-events-auto absolute inset-3 z-0 h-[calc(100%-1.5rem)] w-[calc(100%-1.5rem)] overflow-visible" viewBox={`0 0 1000 ${height - 24}`} preserveAspectRatio="none">
          {summary.accountModel?.map(edge => renderEdge(edge, "accountModel"))}
          {summary.modelClient?.map(edge => renderEdge(edge, "modelClient"))}
          {summary.clientSession?.map(edge => renderEdge(edge, "clientSession"))}
        </svg>
        {/* Columns share COLUMN_X with the SVG bands, so every band ends on its node's edge. */}
        <div className="absolute inset-3 z-10">
          <MapColumn kind="account" title={`Entry · Accounts · ${summary.accounts.length}`}>
            {visible.accounts.map(node => (
              <NodeRow key={node.id} node={node} kind="account" reveal={reveal} now={summary.asOf}
                active={filter?.kind === "account" && filter.id === node.id} onSelect={onFilter} onHover={handleHover} />
            ))}
          </MapColumn>
          <MapColumn kind="model" title="Model">
            <ModelHub nodes={visible.models} modelIds={modelIds} title={summary.comboName || "Models"}
              filter={filter} onSelect={onFilter} onHover={handleHover} />
          </MapColumn>
          <MapColumn kind="client" title={`Harness / Client · ${summary.clients.length}`}>
            {visible.clients.map(node => (
              <NodeRow key={node.id} node={node} kind="client" reveal={reveal} now={summary.asOf} color={modelColor(node.id, modelIds)}
                active={filter?.kind === "client" && filter.id === node.id} onSelect={onFilter} onHover={handleHover} />
            ))}
          </MapColumn>
          <MapColumn kind="session" title={`Sessions · ${summary.sessions.length}`} alignRight>
            {visible.sessions.map(node => (
              <NodeRow key={node.id} node={node} kind="session" reveal={reveal} now={summary.asOf}
                active={filter?.kind === "session" && filter.id === node.id} onSelect={onFilter} onHover={handleHover} />
            ))}
          </MapColumn>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3 border-t border-border-subtle px-3 py-2 text-[10px] text-text-muted">
        <span>{summary.records.length ? "Follow · now" : "Waiting for traffic"}</span>
        {summary.models.slice(0, 8).map(model => <span key={model.id} className="inline-flex items-center gap-1"><i className="size-2 rounded-full" style={{ backgroundColor: modelColor(model.id, modelIds) }} />{model.id}</span>)}
      </div>
      {recordForHover && <RouteTooltip record={recordForHover} x={pointer.x} y={pointer.y} reveal={reveal} now={summary.asOf} />}
      <style jsx>{`
        .route-live-flow { animation: route-flow var(--route-speed, 1.8s) linear infinite; }
        @keyframes route-flow { to { stroke-dashoffset: -24; } }
        @media (prefers-reduced-motion: reduce) { .route-live-flow { animation: none; } }
      `}</style>
    </div>
  );
}
