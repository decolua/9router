export const LIVE_WINDOWS = { "30s": 30_000, "2m": 120_000, "5m": 300_000, "15m": 900_000 };
export const LIVE_ROUTE_LIMITS = { account: 10, model: 8, client: 8, session: 8 };

// Requests rejected before an account was chosen (no key, all accounts cooling down…).
export const UNASSIGNED = "unassigned";

export function usableIp(ip) {
  return ip && ip !== "unknown" ? ip : null;
}

export function accountKeyOf(record) {
  return record.connectionId || UNASSIGNED;
}

export function modelKeyOf(record) {
  return record.model || record.requestedModel || "unknown";
}

export function sessionKeyOf(record) {
  return record.sessionId || `${clientKeyOf(record)}:no-session`;
}

export function clientKeyOf(record) {
  return `${record.client?.name || "Unknown client"}|${record.client?.version || ""}|${usableIp(record.ip) || ""}`;
}

export function windowRecords(records = [], window = "30s", timestamp = Date.now()) {
  const duration = typeof window === "number" ? window : LIVE_WINDOWS[window] || LIVE_WINDOWS["30s"];
  const cutoff = timestamp - duration;
  return records.filter(record => (record.startedAt || 0) >= cutoff && (record.startedAt || 0) <= timestamp);
}

export function maskEmail(value, reveal = false) {
  if (!value || reveal) return value || "Unknown account";
  const [local, domain] = String(value).split("@");
  if (!domain) return String(value); // only e-mail addresses are personal here
  return `${local.slice(0, 1)}***@${domain}`;
}

export function shortId(value, size = 8) {
  if (!value) return "—";
  return `#${String(value).replace(/[^a-z0-9]/gi, "").slice(0, size)}…`;
}

export function limitNodes(nodes = [], limit, kind) {
  const max = Number.isFinite(limit) ? limit : LIVE_ROUTE_LIMITS[kind] || nodes.length;
  const visible = nodes.slice(0, max);
  const hiddenCount = Math.max(0, nodes.length - visible.length);
  if (!hiddenCount) return visible;
  return [...visible, {
    id: `${kind}:more`,
    kind: "more",
    label: `+${hiddenCount} more`,
    moreCount: hiddenCount,
    requests: nodes.slice(max).reduce((sum, node) => sum + (node.requests || 0), 0),
    inProgress: nodes.slice(max).reduce((sum, node) => sum + (node.inProgress || 0), 0),
    status: "more",
  }];
}

export function aggregateRouteLinks(records = []) {
  const groups = {
    accountModel: new Map(),
    modelClient: new Map(),
    clientSession: new Map(),
  };
  const addEdge = (kind, key, edge) => {
    const current = groups[kind].get(key) || { ...edge, requests: 0, inProgress: 0 };
    current.requests += 1;
    if (edge.status === "running") current.inProgress += 1;
    groups[kind].set(key, current);
  };
  for (const record of records) {
    const account = accountKeyOf(record);
    const model = modelKeyOf(record);
    const client = clientKeyOf(record);
    const session = sessionKeyOf(record);
    addEdge("accountModel", `${account}|${model}`, { account, model, status: record.status });
    addEdge("modelClient", `${model}|${client}`, { model, client, status: record.status });
    addEdge("clientSession", `${client}|${session}`, { client, session, model, status: record.status });
  }
  return Object.fromEntries(Object.entries(groups).map(([kind, map]) => [kind, [...map.values()]]));
}

// Running requests occupy their lane up to `now`, so overlapping bars never share a lane.
export function assignTimelineLanes(records = [], now = Date.now()) {
  const lanes = [];
  return [...records]
    .sort((a, b) => (a.startedAt || 0) - (b.startedAt || 0))
    .map(record => {
      const start = record.startedAt || 0;
      const end = record.status === "running" ? now : record.endedAt || start;
      let lane = lanes.findIndex(lastEnd => start >= lastEnd);
      if (lane < 0) lane = lanes.length;
      lanes[lane] = Math.max(lanes[lane] || 0, end);
      return { record, lane };
    });
}

// Requests that overlap [windowStart, now], including ones that began before the window.
export function timelineRecords(records = [], windowStart, now) {
  return records.filter(record => {
    const end = record.status === "running" ? now : record.endedAt || record.startedAt;
    return record.startedAt <= now && end >= windowStart;
  });
}

// Unclamped position in % of the window: bars that began earlier start at a
// negative offset and slide out under the row's overflow clip.
export function barGeometry(record, windowStart, now, windowMs) {
  const end = record.status === "running" ? now : record.endedAt || record.startedAt;
  const left = ((record.startedAt - windowStart) / windowMs) * 100;
  const width = Math.max(0.4, ((end - record.startedAt) / windowMs) * 100);
  return { left, width };
}

export function chooseTimelineStep(windowMs) {
  if (windowMs <= 60_000) return 5_000;
  if (windowMs <= 300_000) return 15_000;
  if (windowMs <= 900_000) return 30_000;
  return 60_000;
}

function add(map, key, value) {
  const item = map.get(key) || { ...value, requests: 0, inProgress: 0 };
  item.requests += 1;
  if (value.status === "running") item.inProgress += 1;
  item.status = value.status;
  item.lastSeen = Math.max(item.lastSeen || 0, value.lastSeen || 0);
  map.set(key, item);
  return item;
}

export function summarizeLiveRoutes(records = [], { window = "30s", now = Date.now(), filter = null } = {}) {
  let rows = windowRecords(records, window, now);
  if (filter) {
    rows = rows.filter(record => {
      const client = clientKeyOf(record);
      const session = sessionKeyOf(record);
      const value = filter.kind === "account" ? (accountKeyOf(record))
        : filter.kind === "client" ? client
          : filter.kind === "session" ? session : record[filter.kind];
      return value === filter.id;
    });
  }
  const accounts = new Map();
  const models = new Map();
  const clients = new Map();
  const sessions = new Map();
  const clientSessions = new Map();
  const comboNames = new Set();
  let successful = 0;
  let completed = 0;
  let outputTokens = 0;
  let duration = 0;
  for (const record of rows) {
    const accountKey = accountKeyOf(record);
    const modelKey = modelKeyOf(record);
    const clientKey = clientKeyOf(record);
    // Clients without a session header (curl, scripts) share one node instead of one per request.
    const sessionKey = sessionKeyOf(record);
    const comboName = typeof record.combo === "string" ? record.combo : record.combo?.name;
    if (comboName) comboNames.add(comboName);
    add(accounts, accountKey, { id: accountKey, label: record.connectionId ? record.accountLabel || record.connectionId : "Unassigned", provider: record.connectionId ? record.provider || "unknown" : UNASSIGNED, providerName: record.connectionId ? record.providerName || record.provider || "unknown" : "Not routed", status: record.status });
    add(models, modelKey, { id: modelKey, label: modelKey, status: record.status });
    add(clients, clientKey, { id: clientKey, label: record.client?.name || "Unknown client", version: record.client?.version || null, ip: usableIp(record.ip), status: record.status, lastSeen: record.startedAt });
    if (record.sessionId) (clientSessions.get(clientKey) || clientSessions.set(clientKey, new Set()).get(clientKey)).add(record.sessionId);
    add(sessions, sessionKey, { id: sessionKey, label: record.sessionId || `No session · ${record.client?.name || "Unknown client"}`, status: record.status, lastSeen: record.startedAt });
    if (record.status === "ok") successful += 1;
    if (record.status !== "running") {
      completed += 1;
      duration += record.latencyMs || 0;
      outputTokens += record.outputTokens || 0;
    }
  }
  const seconds = Math.max(1, (typeof window === "number" ? window : LIVE_WINDOWS[window] || 30_000) / 1000);
  const sorted = {
    accounts: [...accounts.values()].sort((a, b) => b.requests - a.requests),
    models: [...models.values()].sort((a, b) => b.requests - a.requests),
    clients: [...clients.values()]
      .map(client => ({ ...client, sessions: clientSessions.get(client.id)?.size || 0 }))
      .sort((a, b) => b.requests - a.requests),
    sessions: [...sessions.values()].sort((a, b) => b.requests - a.requests),
  };
  const routeLinks = aggregateRouteLinks(rows);
  return {
    asOf: now,
    records: rows,
    requests: rows.length,
    requestsInWindow: rows.length,
    inProgress: rows.filter(record => record.status === "running").length,
    successRate: completed ? (successful / completed) * 100 : 0,
    outputTokPerSec: outputTokens / seconds,
    avgLatency: completed ? duration / completed : 0,
    comboName: comboNames.size === 1 ? [...comboNames][0] : null,
    ...sorted,
    ...routeLinks,
    links: routeLinks.accountModel,
    visible: {
      accounts: limitNodes(sorted.accounts, LIVE_ROUTE_LIMITS.account, "account"),
      models: limitNodes(sorted.models, LIVE_ROUTE_LIMITS.model, "model"),
      clients: limitNodes(sorted.clients, LIVE_ROUTE_LIMITS.client, "client"),
      sessions: limitNodes(sorted.sessions, LIVE_ROUTE_LIMITS.session, "session"),
    },
  };
}

export const aggregateLiveRoutes = summarizeLiveRoutes;

export function formatRate(value) {
  if (!Number.isFinite(value)) return "0";
  return value >= 100 ? Math.round(value).toLocaleString() : value.toFixed(1);
}

export function formatLatency(value) {
  if (!Number.isFinite(value) || value <= 0) return "—";
  return value >= 1000 ? `${(value / 1000).toFixed(1)}s` : `${Math.round(value)}ms`;
}
