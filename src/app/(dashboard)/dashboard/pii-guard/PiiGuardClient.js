"use client";

import { useState, useEffect, useCallback, useMemo, useRef, memo } from "react";
import { Card, Button, SegmentedControl, Select, Badge } from "@/shared/components";

const MODES = [
  { value: "off", label: "Off" },
  { value: "observe", label: "Observe" },
  { value: "redact", label: "Redact" },
  { value: "block", label: "Block" },
];

const MODE_LABEL = Object.fromEntries(MODES.map(m => [m.value, m.label]));

const MODE_HELP = {
  off: "No scan. Requests pass unchanged.",
  observe: "Scan and log findings. Requests pass unchanged.",
  redact: "Rewrites every editable field (user, assistant history, tool calls/results, system) with placeholders such as {{pii:pan#ab12cd}}.",
  block: "Rejects a request the first time a new value appears (HTTP 400). Retries redact it.",
};

const MODE_HELP_OVERRIDDEN = {
  off: "Other rules are not scanned.",
  observe: "Other rules only log findings.",
};

const OVERRIDE_VERB = { off: "is off", observe: "observes", redact: "redacts", block: "blocks" };
const OVERRIDE_PLURAL = { off: "are off", observe: "observe", redact: "redact", block: "block" };

const ACTION_BADGE_VARIANT = {
  block: "error",
  leaked: "error",
  redact: "warning",
  observe: "info",
  ignored: "default",
};

const RULE_MODES = [{ value: "default", label: "Default" }, ...MODES];

const KIND_CONFIG = {
  secret: { badge: "error" },
  pii: { badge: "info" },
  known: { badge: "success" },
};

const WHERE_LABEL = {
  "assistant/thinking": "Signed thinking",
  key: "Object key",
  number: "Number",
  body: "Whole-string body",
};

const TEST_WHERES = [
  { value: "user", label: "User" },
  { value: "system", label: "System" },
  { value: "assistant", label: "Assistant" },
  { value: "tool_result", label: "Tool result" },
  { value: "thinking", label: "Signed thinking" },
];

const RECENT_MINUTES = [
  { value: "15", label: "15 min" },
  { value: "60", label: "60 min" },
  { value: "240", label: "240 min" },
];

const PRESETS = [
  { id: "1h", label: "Last 1 hour", ms: 3600000 },
  { id: "6h", label: "Last 6 hours", ms: 6 * 3600000 },
  { id: "24h", label: "Last 24 hours", ms: 86400000 },
  { id: "today", label: "Today", ms: null },
  { id: "yesterday", label: "Yesterday", ms: null },
  { id: "7d", label: "Last 7 days", ms: 7 * 86400000 },
  { id: "30d", label: "Last 30 days", ms: 30 * 86400000 },
  { id: "custom", label: "Custom", ms: null },
];

const ENDS_AT_NOW = new Set(["1h", "6h", "24h", "7d", "30d", "today"]);

const SOURCE_BUCKETS = ["User", "Assistant", "Tool result", "System", "Thinking"];

function sourceBucket(source) {
  const s = String(source || "").toLowerCase();
  if (s.startsWith("user")) return "User";
  if (s.startsWith("assistant")) return "Assistant";
  if (s.startsWith("tool")) return "Tool result";
  if (s.startsWith("system")) return "System";
  if (s.includes("thinking")) return "Thinking";
  return "Other";
}

const count = value => Number(value || 0).toLocaleString();

const age = value => {
  if (!value) return "unknown";
  const ms = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "unknown";
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
};

const uptime = value => {
  if (!value) return "active";
  const s = Math.floor((Date.now() - new Date(value).getTime()) / 1000);
  if (!Number.isFinite(s) || s < 0) return "active";
  if (s < 60) return `Up ${s}s`;
  if (s < 3_600) return `Up ${Math.floor(s / 60)} min`;
  if (s < 86_400) return `Up ${Math.floor(s / 3_600)} h`;
  return `Up ${Math.floor(s / 86_400)} d`;
};

function humanizeSource(source) {
  if (!source || source === "-") return "other";
  const parts = source.split("/");
  if (parts.length === 2) {
    const role = parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
    const type = parts[1].replace(/_/g, " ");
    return `${role} · ${type}`;
  }
  return source.replace(/_/g, " ");
}

const humanizeWhere = where => WHERE_LABEL[where] || humanizeSource(where);

function PlaceholderText({ text }) {
  const parts = String(text ?? "").split(/(\{\{pii:[^}]+\}\})/g);
  return (
    <>
      {parts.map((part, i) => (
        /^\{\{pii:/.test(part)
          ? <mark key={i} className="rounded bg-yellow-500/20 px-0.5 text-inherit">{part}</mark>
          : part
      ))}
    </>
  );
}

async function call(body) {
  const res = await fetch("/api/pii-guard", {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function computeRange(preset, customFrom, customTo) {
  const now = Date.now();
  if (preset === "today") {
    const d = new Date(); d.setHours(0, 0, 0, 0);
    return { from: d.getTime(), to: now };
  }
  if (preset === "yesterday") {
    const d = new Date(); d.setDate(d.getDate() - 1); d.setHours(0, 0, 0, 0);
    const e = new Date(d); e.setDate(e.getDate() + 1); e.setHours(0, 0, 0, 0);
    return { from: d.getTime(), to: e.getTime() };
  }
  if (preset === "custom") {
    return { from: customFrom || now - 86400000, to: customTo || now };
  }
  const ms = PRESETS.find(p => p.id === preset)?.ms || 86400000;
  return { from: now - ms, to: now };
}

function msToInput(ms) {
  if (!ms) return "";
  const d = new Date(ms);
  const pad = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function inputToMs(v) {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

function readUrl() {
  if (typeof window === "undefined") return null;
  const p = new URLSearchParams(window.location.search);
  return {
    range: p.get("range") || "24h",
    from: p.get("from") ? Number(p.get("from")) : null,
    to: p.get("to") ? Number(p.get("to")) : null,
    group: p.get("group") || "all",
    rule: p.get("rule") || "all",
    action: p.get("action") || "all",
    where: p.get("where") || "all",
    status: p.get("status") || "active",
    q: p.get("q") || "",
    sort: p.get("sort") || "lastSeen",
    dir: p.get("dir") || "desc",
  };
}

const ValueRow = memo(function ValueRow({ group, ruleMeta, groupLabel, ignored, selected, onToggle, onIgnore, leakedView }) {
  const actions = group.actions || [];
  const last = group.action || actions[actions.length - 1];
  const latest = leakedView ? (last === "leaked" ? "leaked" : "leaked earlier") : last;
  return (
    <tr className="align-middle hover:bg-surface-2/40 transition-colors">
      <td className="py-2.5 pr-3">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          aria-label={`Select ${group.name || group.rule}`}
          className="size-4 accent-brand-500 cursor-pointer"
        />
      </td>
      <td className="py-2.5 pr-3" title={`${group.rule} · ${group.hash}`}>
        <span className="font-medium text-text-main">{ruleMeta?.label || group.rule}</span>
        {ruleMeta?.group && (
          <span className="ml-1 inline-block rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-text-muted align-middle">
            {groupLabel}
          </span>
        )}
        {group.name && (
          <span className="text-[11px] text-text-muted block">{group.name}</span>
        )}
        <span className="font-mono text-[10px] text-text-muted block truncate max-w-[140px] opacity-75">{group.hash}</span>
      </td>
      <td className="py-2.5 pr-3 text-text-muted">
        {leakedView && group.leakedWhere?.length ? (
          <span title={group.sources.map(humanizeSource).join(", ")}>
            {group.leakedWhere.map(humanizeWhere).join(", ")}
          </span>
        ) : (
          group.sources.map(humanizeSource).join(", ")
        )}
      </td>
      <td className="py-2.5 pr-3" title={actions.length > 0 ? `History: ${actions.join(", ")}` : undefined}>
        {latest ? (
          <Badge size="sm" variant={ACTION_BADGE_VARIANT[latest] || (leakedView ? "error" : "default")}>
            {latest}
          </Badge>
        ) : (
          <span className="text-text-muted">—</span>
        )}
      </td>
      <td className="py-2.5 pr-3 whitespace-nowrap text-text-muted" title={new Date(group.firstSeen).toLocaleString()}>
        {age(group.firstSeen)}
      </td>
      <td className="py-2.5 pr-3 whitespace-nowrap font-medium text-text-main" title={new Date(group.lastSeen).toLocaleString()}>
        {age(group.lastSeen)}
      </td>
      <td className="py-2.5 pr-3 font-mono text-text-muted">
        {count(group.turns)}
      </td>
      <td className="py-2.5 text-right">
        <Button
          size="sm"
          variant="secondary"
          onClick={onIgnore}
        >
          {ignored ? "Unignore" : "Ignore"}
        </Button>
      </td>
    </tr>
  );
});

export default function PiiGuardClient() {
  const urlInit = readUrl();
  const [rangePreset, setRangePreset] = useState(urlInit?.range || "24h");
  const [customFromMs, setCustomFromMs] = useState(urlInit?.from || null);
  const [customToMs, setCustomToMs] = useState(urlInit?.to || null);
  const [customFromInput, setCustomFromInput] = useState(urlInit?.from ? msToInput(urlInit.from) : "");
  const [customToInput, setCustomToInput] = useState(urlInit?.to ? msToInput(urlInit.to) : "");

  const [groupFilter, setGroupFilter] = useState(urlInit?.group || "all");
  const [ruleFilter, setRuleFilter] = useState(urlInit?.rule || "all");
  const [actionFilter, setActionFilter] = useState(urlInit?.action || "all");
  const [whereFilter, setWhereFilter] = useState(urlInit?.where || "all");
  const [statusFilter, setStatusFilter] = useState(urlInit?.status || "active");
  const [searchQuery, setSearchQuery] = useState(urlInit?.q || "");
  const [debouncedSearch, setDebouncedSearch] = useState(urlInit?.q || "");
  const [sortKey, setSortKey] = useState(urlInit?.sort || "lastSeen");
  const [sortDir, setSortDir] = useState(urlInit?.dir || "desc");

  const [state, setState] = useState(null);
  const [error, setError] = useState("");
  const [text, setText] = useState("My mobile number is {{pii:in_phone#da6f85}} and PAN is ABCPE1234F.");
  const [result, setResult] = useState(null);
  const [testMode, setTestMode] = useState("current");
  const [testWhere, setTestWhere] = useState("user");
  const [selected, setSelected] = useState(() => new Set());
  const [recentMinutes, setRecentMinutes] = useState("15");
  const [visibleCount, setVisibleCount] = useState(50);

  const [eventsList, setEventsList] = useState([]);
  const [nextBefore, setNextBefore] = useState(null);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);

  const tableRef = useRef(null);
  const sentinelRef = useRef(null);
  const fingerprintRef = useRef("");
  const debounceRef = useRef(null);

  const range = computeRange(rangePreset, customFromMs, customToMs);
  const endsAtNow = ENDS_AT_NOW.has(rangePreset);

  // debounce search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedSearch(searchQuery), 150);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [searchQuery]);

  // URL sync
  useEffect(() => {
    if (typeof window === "undefined") return;
    const p = new URLSearchParams();
    p.set("range", rangePreset);
    if (rangePreset === "custom" && customFromMs && customToMs) {
      p.set("from", String(customFromMs));
      p.set("to", String(customToMs));
    }
    if (groupFilter !== "all") p.set("group", groupFilter);
    if (ruleFilter !== "all") p.set("rule", ruleFilter);
    if (actionFilter !== "all") p.set("action", actionFilter);
    if (whereFilter !== "all") p.set("where", whereFilter);
    if (statusFilter !== "active") p.set("status", statusFilter);
    if (debouncedSearch) p.set("q", debouncedSearch);
    if (sortKey !== "lastSeen") p.set("sort", sortKey);
    if (sortDir !== "desc") p.set("dir", sortDir);
    history.replaceState(null, "", `${window.location.pathname}?${p.toString()}`);
  }, [rangePreset, customFromMs, customToMs, groupFilter, ruleFilter, actionFilter, whereFilter, statusFilter, debouncedSearch, sortKey, sortDir]);

  const load = useCallback(() => {
    if (typeof document !== "undefined" && document.hidden) return;
    const r = computeRange(rangePreset, customFromMs, customToMs);
    call().catch(() => {}).then(() => {}); // placeholder no-op
    fetch(`/api/pii-guard?from=${r.from}&to=${r.to}`)
      .then(res => res.json())
      .then(data => {
        const fp = `${data?.summary?.groups?.length ?? 0}:${data?.summary?.groups?.[0]?.lastSeen ?? ""}`;
        if (fp === fingerprintRef.current) return;
        fingerprintRef.current = fp;
        setState(data);
        setError("");
      })
      .catch(e => setError(e.message));
  }, [rangePreset, customFromMs, customToMs]);

  // initial + polling
  useEffect(() => {
    load();
    if (!endsAtNow) return;
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [load, endsAtNow]);

  // visibility
  useEffect(() => {
    const onVis = () => { if (!document.hidden) load(); };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [load]);

  const save = patch => call(patch).then(s => { setState(s); setError(""); fingerprintRef.current = `${s?.summary?.groups?.length ?? 0}:${s?.summary?.groups?.[0]?.lastSeen ?? ""}`; return true; }).catch(e => { setError(e.message); return false; });

  const confirmBlock = mode => mode !== "block" || window.confirm("Block stops the first request that contains a new value. Later requests redact it. Continue?");
  const chooseMode = mode => { if (confirmBlock(mode)) save({ mode }); };
  const runTest = () => call({ test: text, testMode, testWhere }).then(r => { setResult(r); setError(""); }).catch(e => setError(e.message));

  const sortedSources = useMemo(() => {
    const entries = Object.entries(state?.summary?.bySource || {});
    return entries
      .map(([source, hits]) => ({ source, label: humanizeSource(source), hits: Number(hits || 0) }))
      .sort((a, b) => b.hits - a.hits);
  }, [state?.summary?.bySource]);

  const maxSourceHits = useMemo(() => Math.max(...sortedSources.map(s => s.hits), 1), [sortedSources]);

  const availableRules = useMemo(() => {
    const set = new Set();
    (state?.summary?.groups || []).forEach(g => { if (g.rule) set.add(g.rule); });
    return Array.from(set).sort();
  }, [state?.summary?.groups]);

  const groupsList = useMemo(() => {
    const base = Array.isArray(state?.groups) ? state.groups : [];
    const seen = new Set(base.map(g => g.id));
    const extra = [...new Set((state?.rules || []).map(r => r.group).filter(id => id && !seen.has(id)))];
    return [...base, ...extra.map(id => ({ id, label: id }))];
  }, [state?.groups, state?.rules]);

  const groupRules = useMemo(() => {
    const map = new Map();
    (state?.rules || []).forEach(r => {
      if (!map.has(r.group)) map.set(r.group, []);
      map.get(r.group).push(r);
    });
    return map;
  }, [state?.rules]);

  const groupLabelMap = useMemo(() => new Map(groupsList.map(g => [g.id, g.label])), [groupsList]);
  const ruleLabelMap = useMemo(() => new Map((state?.rules || []).map(r => [r.id, r])), [state?.rules]);

  const ruleFilterOptions = useMemo(() => {
    const byGroup = new Map();
    availableRules.forEach(id => {
      const r = ruleLabelMap.get(id);
      const gid = r?.group || "other";
      if (groupFilter !== "all" && gid !== groupFilter) return;
      if (!byGroup.has(gid)) byGroup.set(gid, []);
      byGroup.get(gid).push({ value: id, label: r?.label || id, group: gid, groupLabel: groupLabelMap.get(gid) || gid });
    });
    const opts = [{ value: "all", label: "All rules" }];
    for (const [, items] of byGroup) items.forEach(item => opts.push(item));
    return opts;
  }, [availableRules, ruleLabelMap, groupLabelMap, groupFilter]);

  const whereOptions = useMemo(() => {
    const buckets = new Set();
    (state?.summary?.groups || []).forEach(g => {
      (g.sources || []).forEach(s => buckets.add(sourceBucket(s)));
    });
    const opts = [{ value: "all", label: "All sources" }];
    SOURCE_BUCKETS.forEach(b => { if (buckets.has(b)) opts.push({ value: b, label: b }); });
    if (buckets.has("Other")) opts.push({ value: "Other", label: "Other" });
    return opts;
  }, [state?.summary?.groups]);

  const groupOptions = useMemo(() => {
    const opts = [{ value: "all", label: "All groups" }];
    groupsList.forEach(g => {
      const rulesInGroup = groupRules.get(g.id) || [];
      if (rulesInGroup.length) opts.push({ value: g.id, label: g.label });
    });
    return opts;
  }, [groupsList, groupRules]);

  const filteredRows = useMemo(() => {
    const list = (state?.summary?.groups || []).filter(group => {
      const ruleMeta = ruleLabelMap.get(group.rule);
      const gGroup = ruleMeta?.group || "other";
      if (groupFilter !== "all" && gGroup !== groupFilter) return false;
      if (ruleFilter !== "all" && group.rule !== ruleFilter) return false;
      if (actionFilter !== "all") {
        const a = group.action;
        const want = actionFilter === "blocked" ? "block" : actionFilter;
        if (a !== want) return false;
      }
      if (whereFilter !== "all") {
        const buckets = (group.sources || []).map(sourceBucket);
        if (!buckets.includes(whereFilter)) return false;
      }
      if (statusFilter === "active" && group.ignored) return false;
      if (statusFilter === "ignored" && !group.ignored) return false;
      const q = debouncedSearch.trim().toLowerCase();
      if (q) {
        const matchRule = (group.rule || "").toLowerCase().includes(q);
        const matchName = (group.name || "").toLowerCase().includes(q);
        const matchHash = (group.hash || "").toLowerCase().includes(q);
        if (!matchRule && !matchName && !matchHash) return false;
      }
      return true;
    });

    const dir = sortDir === "asc" ? 1 : -1;
    list.sort((a, b) => {
      if (sortKey === "name") {
        const an = ruleLabelMap.get(a.rule)?.label || a.rule || "";
        const bn = ruleLabelMap.get(b.rule)?.label || b.rule || "";
        return an.localeCompare(bn) * dir;
      }
      if (sortKey === "firstSeen") return (Date.parse(a.firstSeen) - Date.parse(b.firstSeen)) * dir;
      if (sortKey === "lastSeen") return (Date.parse(a.lastSeen) - Date.parse(b.lastSeen)) * dir;
      if (sortKey === "turns") return (a.turns - b.turns) * dir;
      return 0;
    });
    return list;
  }, [state?.summary?.groups, groupFilter, ruleFilter, actionFilter, whereFilter, statusFilter, debouncedSearch, sortKey, sortDir, ruleLabelMap]);

  useEffect(() => { setVisibleCount(50); }, [groupFilter, ruleFilter, actionFilter, whereFilter, statusFilter, debouncedSearch, sortKey, sortDir, rangePreset, customFromMs, customToMs]);

  // sentinel observer
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && visibleCount < filteredRows.length) {
        setVisibleCount(c => Math.min(c + 50, filteredRows.length));
      }
    });
    io.observe(el);
    return () => io.disconnect();
  }, [visibleCount, filteredRows.length]);

  const displayedRows = filteredRows.slice(0, visibleCount);

  const ignoredByHash = useMemo(() => {
    const map = new Map();
    (state?.summary?.groups || []).forEach(g => map.set(g.hash, !!g.ignored));
    return map;
  }, [state?.summary?.groups]);

  if (!state) return <div className="p-6 text-text-muted">{error || "Loading..."}</div>;

  const {
    config = { mode: "observe", rules: {}, ignore: [] },
    summary = {},
    health = null,
    enabled,
    available,
  } = state;

  const knownUpdated = health?.knownUpdated;
  const rangeLabel = (() => {
    const preset = PRESETS.find(p => p.id === rangePreset);
    let label = preset?.label || "Last 24 hours";
    if (rangePreset === "custom") label = "Custom range";
    return label.charAt(0).toLowerCase() + label.slice(1);
  })();

  const overrideCounts = {};
  Object.values(config.rules || {}).forEach(action => {
    if (action && action !== "default" && action !== config.mode) {
      overrideCounts[action] = (overrideCounts[action] || 0) + 1;
    }
  });
  const overrideParts = Object.entries(overrideCounts).map(([action, n]) =>
    `${n} ${n > 1 ? "rules" : "rule"} ${n > 1 ? (OVERRIDE_PLURAL[action] || action) : (OVERRIDE_VERB[action] || action)}`
  );
  const anyBlock = config.mode === "block" || overrideCounts.block > 0;

  const visibleHashes = new Set(filteredRows.map(g => g.hash));
  const selectedVisible = [...selected].filter(h => visibleHashes.has(h));
  const allSelected = filteredRows.length > 0 && filteredRows.every(g => selected.has(g.hash));
  const toggleAll = () => {
    setSelected(prev => {
      const next = new Set(prev);
      filteredRows.forEach(g => {
        if (allSelected) next.delete(g.hash);
        else next.add(g.hash);
      });
      return next;
    });
  };
  const toggleRow = hash => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(hash)) next.delete(hash);
      else next.add(hash);
      return next;
    });
  };
  const bulkDisabled = selectedVisible.length === 0 || selectedVisible.length > 1000;
  const anySelectedVisible = selectedVisible.some(hash => !ignoredByHash.get(hash));
  const bulkIgnore = () => {
    save({ ignoreMany: selectedVisible, on: anySelectedVisible })
      .then(ok => ok && setSelected(new Set()));
  };
  const ruleHashes = filteredRows.filter(g => !g.ignored).map(g => g.hash);
  const ignoreThisRule = () => {
    if (ruleHashes.length) save({ ignoreMany: ruleHashes, on: true }).then(ok => ok && setSelected(new Set()));
  };
  const ignoreRecent = () => {
    save({ ignoreRecent: Number(recentMinutes), on: true }).then(ok => ok && setSelected(new Set()));
  };

  // events pagination
  const loadEventsPage = useCallback(async (before) => {
    setEventsLoading(true);
    try {
      const r = computeRange(rangePreset, customFromMs, customToMs);
      const url = `/api/pii-guard?events=1&limit=50&from=${r.from}&to=${r.to}` + (before ? `&before=${before}` : "");
      const res = await fetch(url);
      const data = await res.json();
      if (before) setEventsList(prev => [...prev, ...(data.events || [])]);
      else setEventsList(data.events || []);
      setNextBefore(data.nextBefore);
    } catch (e) { setError(e.message); }
    finally { setEventsLoading(false); }
  }, [rangePreset, customFromMs, customToMs]);

  useEffect(() => {
    if (!detailsOpen) return;
    setEventsList([]);
    setNextBefore(null);
    loadEventsPage(null);
  }, [detailsOpen, rangePreset, customFromMs, customToMs, loadEventsPage]);

  const eventsSentinelRef = useRef(null);
  useEffect(() => {
    const el = eventsSentinelRef.current;
    if (!el || !detailsOpen) return;
    const io = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && nextBefore && !eventsLoading) {
        loadEventsPage(nextBefore);
      }
    });
    io.observe(el);
    return () => io.disconnect();
  }, [detailsOpen, nextBefore, eventsLoading, loadEventsPage]);

  const handleSort = (key) => {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("desc"); }
  };

  const ariaSort = (key) => sortKey === key ? (sortDir === "asc" ? "ascending" : "descending") : "none";

  const activeChips = [];
  if (groupFilter !== "all") activeChips.push({ key: "group", label: `Group: ${groupLabelMap.get(groupFilter) || groupFilter}`, clear: () => setGroupFilter("all") });
  if (ruleFilter !== "all") activeChips.push({ key: "rule", label: `Rule: ${ruleLabelMap.get(ruleFilter)?.label || ruleFilter}`, clear: () => setRuleFilter("all") });
  if (actionFilter !== "all") activeChips.push({ key: "action", label: `Action: ${actionFilter}`, clear: () => setActionFilter("all") });
  if (whereFilter !== "all") activeChips.push({ key: "where", label: `Where: ${whereFilter}`, clear: () => setWhereFilter("all") });
  if (statusFilter !== "active") activeChips.push({ key: "status", label: `Status: ${statusFilter}`, clear: () => setStatusFilter("active") });
  if (debouncedSearch) activeChips.push({ key: "q", label: `Search: ${debouncedSearch}`, clear: () => { setSearchQuery(""); setDebouncedSearch(""); } });

  const clearAllFilters = () => {
    setGroupFilter("all"); setRuleFilter("all"); setActionFilter("all"); setWhereFilter("all"); setStatusFilter("active"); setSearchQuery(""); setDebouncedSearch("");
  };

  const scrollToTable = () => tableRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });

  return (
    <div className="space-y-6 p-6">
      {error && <div className="text-sm text-red-500" role="alert">{error}</div>}
      {!enabled && (
        <Card>
          <p className="text-sm">PII_GUARD_MODULE is not set. Set it in the service drop-in and restart 9Router.</p>
        </Card>
      )}
      {enabled && !available && (
        <Card>
          <p className="text-sm text-red-500">Scanner did not load. Check the console log for [pii-guard] lines.</p>
        </Card>
      )}

      {/* Mode Card + range control at top */}
      <Card>
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold flex items-center gap-2 text-text-main">
              <span className="material-symbols-outlined text-primary">shield_person</span>
              PII Guard
            </h2>
            <p className="text-xs text-text-muted mt-1">
              {MODE_LABEL[config.mode]}
              {overrideParts.length > 0 && <span className="font-medium text-text-main"> · {overrideParts.join(", ")}</span>}
            </p>
            <p className="text-xs text-text-muted mt-0.5">{(overrideParts.length > 0 && MODE_HELP_OVERRIDDEN[config.mode]) || MODE_HELP[config.mode]}</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Select
              value={rangePreset}
              onChange={e => setRangePreset(e.target.value)}
              options={PRESETS.map(p => ({ value: p.id, label: p.label }))}
            />
            <SegmentedControl options={MODES} value={config.mode} onChange={mode => chooseMode(mode)} />
          </div>
        </div>
        {rangePreset === "custom" && (
          <div className="flex items-center gap-2 mt-3 flex-wrap">
            <input type="datetime-local" value={customFromInput} onChange={e => setCustomFromInput(e.target.value)} className="py-2 px-3 text-sm bg-surface-2 rounded-[10px] border border-transparent" />
            <span className="text-xs text-text-muted">to</span>
            <input type="datetime-local" value={customToInput} onChange={e => setCustomToInput(e.target.value)} className="py-2 px-3 text-sm bg-surface-2 rounded-[10px] border border-transparent" />
            <Button size="sm" variant="secondary" onClick={() => {
              const f = inputToMs(customFromInput); const t = inputToMs(customToInput);
              if (f && t && f < t) { setCustomFromMs(f); setCustomToMs(t); }
            }}>Apply</Button>
          </div>
        )}
        {anyBlock && (
          <p className="text-xs text-amber-600 dark:text-amber-400 mt-3 pt-3 border-t border-border-subtle">
            Block stops a new value once; a retry redacts it. A value inside signed thinking of an active tool loop cannot be redacted: use /rewind.
          </p>
        )}
        {!anyBlock && (
          <p className="text-xs text-text-muted mt-3 pt-3 border-t border-border-subtle">
            Values the scanner cannot rewrite (signed thinking, object keys, numbers) are reported as leaked. A scanner error never blocks a request.
          </p>
        )}
      </Card>

      {/* KPI Tiles Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="flex flex-col justify-between p-4">
          <div className="flex items-center justify-between text-text-muted">
            <span className="text-xs font-semibold uppercase tracking-wider">Unique values</span>
            <span className={`material-symbols-outlined text-[20px] ${summary.unique24h ? "text-brand-500" : ""}`}>fingerprint</span>
          </div>
          <div className="mt-3">
            <span className={`text-2xl font-bold tracking-tight ${summary.unique24h ? "text-text-main" : "text-text-muted"}`}>{count(summary.unique24h)}</span>
            <span className="block text-xs text-text-muted mt-0.5">{rangeLabel}</span>
          </div>
        </Card>

        <Card className={`p-4 ${actionFilter === "leaked" ? "border-red-500/40" : ""}`}>
          <button
            type="button"
            onClick={() => setActionFilter("leaked")}
            aria-pressed={actionFilter === "leaked"}
            className="w-full text-left cursor-pointer"
          >
            <div className="flex flex-col justify-between">
              <div className="flex items-center justify-between text-text-muted">
                <span className="text-xs font-semibold uppercase tracking-wider">Leaked through</span>
                <span className={`material-symbols-outlined text-[20px] ${summary.leaked24h ? "text-red-500" : ""}`}>warning</span>
              </div>
              <div className="mt-3">
                <span className={`text-2xl font-bold tracking-tight ${summary.leaked24h ? "text-red-500 dark:text-red-400" : "text-text-muted"}`}>{count(summary.leaked24h)}</span>
                <p className="mt-1 text-[11px] leading-tight text-text-muted">
                  Seen but could not be rewritten (signed thinking, object keys, numbers). Click to filter the table.
                </p>
              </div>
            </div>
          </button>
        </Card>

        <Card className="flex flex-col justify-between p-4">
          <div className="flex items-center justify-between text-text-muted">
            <span className="text-xs font-semibold uppercase tracking-wider">Blocked</span>
            <span className={`material-symbols-outlined text-[20px] ${summary.blocked24h ? "text-amber-500" : ""}`}>block</span>
          </div>
          <div className="mt-3">
            <span className={`text-2xl font-bold tracking-tight ${summary.blocked24h ? "text-amber-500 dark:text-amber-400" : "text-text-muted"}`}>{count(summary.blocked24h)}</span>
            <span className="block text-xs text-text-muted mt-0.5">Requests rejected (400)</span>
          </div>
        </Card>

        <Card className="flex flex-col justify-between p-4">
          <div className="flex items-center justify-between text-text-muted">
            <span className="text-xs font-semibold uppercase tracking-wider">Scanner errors</span>
            <span className={`material-symbols-outlined text-[20px] ${summary.errors24h ? "text-red-500" : ""}`}>error</span>
          </div>
          <div className="mt-3">
            <span className={`text-2xl font-bold tracking-tight ${summary.errors24h ? "text-red-500 dark:text-red-400" : "text-text-muted"}`}>{count(summary.errors24h)}</span>
            <span className="block text-xs text-text-muted mt-0.5">Fails open (never blocks)</span>
          </div>
        </Card>
      </div>

      {/* Rule Groups */}
      <Card>
        <div className="mb-3">
          <h3 className="font-semibold text-text-main flex items-center gap-2">
            <span className="material-symbols-outlined text-[18px] text-text-muted">tune</span>
            Rule groups
          </h3>
          <p className="text-xs text-text-muted mt-0.5">
            Default follows the default mode. The known group matches values from ~/.config/pii-guard/known.json.
          </p>
        </div>
        <div className="divide-y divide-border border-t border-border">
          {groupsList.map(group => {
            const rulesInGroup = groupRules.get(group.id) || [];
            if (!rulesInGroup.length) return null;
            const totals = rulesInGroup.reduce((acc, r) => {
              const byRule = summary.byRule?.[r.id] || {};
              return { unique: acc.unique + (byRule.unique || 0), hits: acc.hits + (byRule.hits || 0) };
            }, { unique: 0, hits: 0 });
            const modes = rulesInGroup.map(r => config.rules?.[r.id] || "default");
            const shared = modes.length > 0 && modes.every(m => m === modes[0]) ? modes[0] : "mixed";
            return (
              <div key={group.id} className="py-2.5">
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <details className="group min-w-0 flex-1">
                    <summary className="cursor-pointer list-none flex items-center gap-2 text-sm">
                      <span className="material-symbols-outlined text-[18px] text-text-muted transition-transform group-open:rotate-90">
                        chevron_right
                      </span>
                      <span className="font-semibold text-text-main">{group.label}</span>
                      <button
                        type="button"
                        onClick={(e) => { e.preventDefault(); setGroupFilter(group.id); scrollToTable(); }}
                        className="text-xs text-text-muted font-mono hover:text-primary cursor-pointer"
                        title="Filter table by this group"
                      >
                        {count(totals.unique)} unique / {count(totals.hits)} hits / {rangeLabel}
                      </button>
                    </summary>
                    <div className="mt-2 space-y-2 pl-6 border-l border-border-subtle">
                      {rulesInGroup.map(r => {
                        const byRule = summary.byRule?.[r.id] || {};
                        const warning = summary.ruleWarnings?.[r.id];
                        return (
                          <div key={r.id} className="flex items-center justify-between gap-4 py-1.5 flex-wrap">
                            <div className="min-w-0 space-y-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-mono text-sm font-semibold text-text-main">{r.label || r.id}</span>
                                <Badge size="sm" variant={KIND_CONFIG[r.kind]?.badge || "default"}>{r.kind}</Badge>
                                {r.id === "known" && (
                                  <span className="text-xs text-text-muted">({count(r.count)} values)</span>
                                )}
                                <span className="text-xs text-text-muted font-mono">
                                  · {count(byRule.unique)} unique / {count(byRule.hits)} hits / {rangeLabel}
                                </span>
                              </div>
                              {warning && (
                                <div>
                                  <span className="inline-block cursor-help" title={`${Math.round(warning.share * 100)}% in ${humanizeSource(warning.topSource)}`}>
                                    <Badge variant="warning" size="sm" icon="warning">
                                      Mostly in {humanizeSource(warning.topSource)}; Redact cannot rewrite it there
                                    </Badge>
                                  </span>
                                </div>
                              )}
                            </div>
                            <SegmentedControl
                              size="sm"
                              options={RULE_MODES}
                              value={config.rules?.[r.id] || "default"}
                              onChange={mode => { if (confirmBlock(mode)) save({ rules: { [r.id]: mode } }); }}
                            />
                          </div>
                        );
                      })}
                    </div>
                  </details>
                  <div className="flex items-center gap-2">
                    {shared === "mixed" && (
                      <span className="text-xs font-medium text-amber-600 dark:text-amber-400">Mixed</span>
                    )}
                    <SegmentedControl
                      size="sm"
                      options={RULE_MODES}
                      value={shared === "mixed" ? null : shared}
                      onChange={mode => { if (confirmBlock(mode)) save({ rules: Object.fromEntries(rulesInGroup.map(r => [r.id, mode])) }); }}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Findings Table Card */}
      <Card>
        <div ref={tableRef} />
        <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
          <div>
            <h3 className="font-semibold text-text-main flex items-center gap-2">
              <span className="material-symbols-outlined text-[18px] text-text-muted">search_check</span>
              Values seen ({rangeLabel})
              <span className="text-xs font-normal text-text-muted">
                ({count(filteredRows.length)}{filteredRows.length !== (summary.groups || []).length ? ` of ${count((summary.groups || []).length)}` : ""})
              </span>
              {summary.truncated && (
                <Badge variant="warning" size="sm">Partial log</Badge>
              )}
            </h3>
            <p className="text-xs text-text-muted mt-1">
              Each row is one unique value (by hash), not one request. Turns = requests that contained it.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button size="sm" variant="secondary" onClick={load}>Refresh</Button>
          </div>
        </div>

        {/* Filter row */}
        <div className="flex items-center gap-3 mb-3 flex-wrap">
          <div className="w-full sm:w-40">
            <Select value={groupFilter} onChange={e => setGroupFilter(e.target.value)} options={groupOptions} />
          </div>
          <div className="w-full sm:w-44">
            <Select value={ruleFilter} onChange={e => setRuleFilter(e.target.value)} options={ruleFilterOptions} />
          </div>
          <div className="w-full sm:w-36">
            <Select value={actionFilter} onChange={e => setActionFilter(e.target.value)} options={[
              { value: "all", label: "All actions" },
              { value: "leaked", label: "Leaked" },
              { value: "block", label: "Blocked" },
              { value: "redact", label: "Redacted" },
              { value: "observe", label: "Observed" },
            ]} />
          </div>
          <div className="w-full sm:w-40">
            <Select value={whereFilter} onChange={e => setWhereFilter(e.target.value)} options={whereOptions} />
          </div>
          <div className="w-full sm:w-36">
            <Select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} options={[
              { value: "active", label: "Active" },
              { value: "ignored", label: "Ignored" },
              { value: "all", label: "All" },
            ]} />
          </div>
          <div className="relative flex-1 min-w-[200px]">
            <span className="material-symbols-outlined absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-text-muted text-[18px]">search</span>
            <input
              type="text"
              placeholder="Filter by rule, name, or hash..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              aria-label="Filter findings by rule, name, or hash"
              className="w-full py-2.5 pl-9 pr-3 text-sm text-text-main bg-surface-2 rounded-[10px] border border-transparent placeholder-text-muted/70 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500/40"
            />
          </div>
        </div>

        {/* Chips */}
        {activeChips.length > 0 && (
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            {activeChips.map(chip => (
              <button
                key={chip.key}
                type="button"
                onClick={chip.clear}
                className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2.5 py-1 text-xs font-medium text-text-main hover:bg-surface-2/70 transition-colors cursor-pointer"
              >
                {chip.label}
                <span className="material-symbols-outlined text-[14px]">close</span>
              </button>
            ))}
            <button type="button" onClick={clearAllFilters} className="text-xs text-primary hover:underline cursor-pointer">Clear all</button>
          </div>
        )}

        {/* Bulk actions */}
        {filteredRows.length > 0 && (
          <div className="flex items-center gap-3 mb-3 flex-wrap text-sm">
            <label className="flex items-center gap-2 text-xs text-text-muted cursor-pointer">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={toggleAll}
                aria-label={`Select all ${filteredRows.length} filtered rows`}
                className="size-4 accent-brand-500 cursor-pointer"
              />
              Select all
            </label>
            {selectedVisible.length > 0 && (
              <span className="text-xs text-text-muted font-medium">{count(selectedVisible.length)} selected</span>
            )}
            <Button size="sm" variant="secondary" disabled={bulkDisabled} onClick={bulkIgnore}>
              {anySelectedVisible ? "Ignore selected" : "Unignore selected"}
            </Button>
            {ruleFilter !== "all" && (
              <Button size="sm" variant="secondary" onClick={ignoreThisRule} disabled={!ruleHashes.length || ruleHashes.length > 1000}>
                Ignore all shown for this rule
              </Button>
            )}
            <div className="flex items-center gap-2 ml-auto">
              <Select aria-label="Ignore values first seen in the last" className="w-32" value={recentMinutes} onChange={e => setRecentMinutes(e.target.value)} options={RECENT_MINUTES} />
              <Button size="sm" variant="secondary" onClick={ignoreRecent}>Ignore recent</Button>
            </div>
          </div>
        )}

        {filteredRows.length === 0 ? (
          <div className="py-8 text-center text-sm text-text-muted">No findings matched filter.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-text-muted border-b border-border">
                <tr>
                  <th className="py-2.5 pr-3 font-semibold w-8"><span className="sr-only">Select</span></th>
                  <th className="py-2.5 pr-3 font-semibold cursor-pointer" onClick={() => handleSort("name")} aria-sort={ariaSort("name")}>
                    Name {sortKey === "name" ? (sortDir === "asc" ? "▲" : "▼") : ""}
                  </th>
                  <th className="py-2.5 pr-3 font-semibold">Where</th>
                  <th className="py-2.5 pr-3 font-semibold">What happened</th>
                  <th className="py-2.5 pr-3 font-semibold cursor-pointer" onClick={() => handleSort("firstSeen")} aria-sort={ariaSort("firstSeen")}>
                    First seen {sortKey === "firstSeen" ? (sortDir === "asc" ? "▲" : "▼") : ""}
                  </th>
                  <th className="py-2.5 pr-3 font-semibold cursor-pointer" onClick={() => handleSort("lastSeen")} aria-sort={ariaSort("lastSeen")}>
                    Last seen {sortKey === "lastSeen" ? (sortDir === "asc" ? "▲" : "▼") : ""}
                  </th>
                  <th className="py-2.5 pr-3 font-semibold cursor-pointer" onClick={() => handleSort("turns")} aria-sort={ariaSort("turns")}>
                    Turns {sortKey === "turns" ? (sortDir === "asc" ? "▲" : "▼") : ""}
                  </th>
                  <th className="py-2.5 text-right font-semibold">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {displayedRows.map(group => {
                  const ruleMeta = ruleLabelMap.get(group.rule);
                  const groupLabel = groupLabelMap.get(ruleMeta?.group) || ruleMeta?.group;
                  return (
                    <ValueRow
                      key={`${group.rule}:${group.hash}`}
                      group={group}
                      ruleMeta={ruleMeta}
                      groupLabel={groupLabel}
                      ignored={!!group.ignored}
                      selected={selected.has(group.hash)}
                      onToggle={() => toggleRow(group.hash)}
                      onIgnore={() => save({ ignore: group.hash, on: !group.ignored })}
                      leakedView={actionFilter === "leaked"}
                    />
                  );
                })}
              </tbody>
            </table>
            {/* ponytail: windowed rendering of 50 rows; switch to @tanstack/react-virtual if rows exceed ~5k */}
            {visibleCount < filteredRows.length && (
              <div ref={sentinelRef} className="h-1" aria-hidden="true" />
            )}
          </div>
        )}
        {filteredRows.length > 0 && (
          <div className="p-3 text-center border-t border-border bg-surface-2/30 text-xs text-text-muted">
            Showing {count(Math.min(visibleCount, filteredRows.length))} of {count(filteredRows.length)}
          </div>
        )}
      </Card>

      {/* Details disclosure */}
      <details className="rounded-xl border border-border bg-surface p-4" onToggle={e => setDetailsOpen(e.target.open)}>
        <summary className="cursor-pointer text-sm font-medium text-text-main hover:text-primary transition-colors">
          Details
        </summary>
        <div className="mt-4 space-y-6">
          {/* Where values appeared */}
          <Card className="p-4 sm:p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-text-main flex items-center gap-2">
                <span className="material-symbols-outlined text-[18px] text-text-muted">location_on</span>
                Where values appeared
              </h3>
            </div>
            {sortedSources.length === 0 ? (
              <p className="text-xs text-text-muted">No source activity in the {rangeLabel}.</p>
            ) : (
              <div className="space-y-3">
                {sortedSources.map(item => {
                  const pct = Math.max(2, Math.round((item.hits / maxSourceHits) * 100));
                  return (
                    <div key={item.source} className="space-y-1">
                      <div className="flex items-center justify-between text-xs gap-2">
                        <span className="font-medium text-text-main truncate">{item.label}</span>
                        <span className="text-text-muted shrink-0 text-right font-mono">
                          <span className="font-semibold text-text-main">{count(item.hits)}</span> hits
                        </span>
                      </div>
                      <div role="progressbar" aria-label={`${item.label}: ${count(item.hits)}`} aria-valuenow={item.hits} aria-valuemin={0} aria-valuemax={maxSourceHits} className="h-2 w-full overflow-hidden rounded-full bg-surface-2">
                        <div className="h-full rounded-full bg-brand-500/80 transition-all duration-300" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          {/* Scanner Health Card */}
          <Card>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-text-main flex items-center gap-2">
                <span className="material-symbols-outlined text-[18px] text-text-muted">monitor_heart</span>
                Scanner health
              </h3>
              <div className="flex items-center gap-1.5">
                <span className={`inline-block size-2.5 rounded-full ${health?.loaded ? "bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]" : "bg-red-500"}`} aria-hidden="true" />
                <span className="text-xs font-medium text-text-main">{health?.loaded ? "Loaded" : "Not loaded"}</span>
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
              <div className="rounded-lg bg-surface-2/60 p-2.5 border border-border-subtle">
                <span className="text-xs text-text-muted block font-medium">Known values</span>
                <strong className="block text-base font-semibold text-text-main mt-0.5">{count(health?.knownCount)}</strong>
                <span className="text-[11px] text-text-muted block mt-0.5">{age(knownUpdated)}</span>
              </div>
              <div className="rounded-lg bg-surface-2/60 p-2.5 border border-border-subtle">
                <span className="text-xs text-text-muted block font-medium">Scanner errors</span>
                <strong className={`block text-base font-semibold mt-0.5 ${health?.errors ? "text-red-500" : "text-text-main"}`}>{count(health?.errors)}</strong>
                <span className="text-[11px] text-text-muted block mt-0.5 truncate" title={health?.lastError ? `${age(health.lastError.ts)} (${health.lastError.stage})` : "No errors"}>
                  {health?.lastError ? `Last: ${age(health.lastError.ts)} (${health.lastError.stage})` : "No errors"}
                </span>
              </div>
              <div className="rounded-lg bg-surface-2/60 p-2.5 border border-border-subtle">
                <span className="text-xs text-text-muted block font-medium">Requests</span>
                <strong className="block text-base font-semibold text-text-main mt-0.5">{count(health?.requests)}</strong>
                <span className="text-[11px] text-text-muted block mt-0.5">
                  {health?.withFindings !== undefined ? `${count(health.withFindings)} findings` : "all time"}
                </span>
              </div>
              <div className="rounded-lg bg-surface-2/60 p-2.5 border border-border-subtle">
                <span className="text-xs text-text-muted block font-medium">Scan latency</span>
                <strong className="block text-base font-semibold text-text-main mt-0.5 font-mono">p95 {count(health?.p95ScanMs)} ms</strong>
                <span className="text-[11px] text-text-muted block mt-0.5 font-mono">max {count(health?.maxScanMs)} ms</span>
              </div>
              <div className="rounded-lg bg-surface-2/60 p-2.5 border border-border-subtle">
                <span className="text-xs text-text-muted block font-medium">Images not scanned (no OCR)</span>
                <strong className="block text-base font-semibold text-text-main mt-0.5">{count(health?.unscanned?.images)}</strong>
              </div>
              <div className="rounded-lg bg-surface-2/60 p-2.5 border border-border-subtle">
                <span className="text-xs text-text-muted block font-medium">Files not scanned</span>
                <strong className="block text-base font-semibold text-text-main mt-0.5">{count(health?.unscanned?.files)}</strong>
              </div>
              <div className="rounded-lg bg-surface-2/60 p-2.5 border border-border-subtle">
                <span className="text-xs text-text-muted block font-medium cursor-help" title="Signed thinking signatures and encrypted reasoning cannot be read; they are skipped.">Encrypted reasoning skipped</span>
                <strong className="block text-base font-semibold text-text-main mt-0.5">{count(health?.unscanned?.opaque)}</strong>
              </div>
              <div className="rounded-lg bg-surface-2/60 p-2.5 border border-border-subtle">
                <span className="text-xs text-text-muted block font-medium">Scanner uptime</span>
                <strong className="block text-base font-semibold text-text-main mt-0.5">{uptime(health?.since)}</strong>
                <span className="text-[11px] text-text-muted block mt-0.5">{count(health?.seen)} total seen</span>
              </div>
            </div>
          </Card>

          {/* Recent event details */}
          <details className="text-xs">
            <summary className="cursor-pointer text-text-muted font-medium hover:text-text-main transition-colors">
              Recent event details ({eventsList.length} events)
            </summary>
            <ul className="mt-2 space-y-1 max-h-64 overflow-y-auto rounded-lg bg-surface-2/40 p-2.5 border border-border-subtle font-mono text-[11px]">
              {eventsList.map((event, i) => (
                <li key={`${event.ts}:${i}`} className="text-text-muted">
                  <span className="text-text-main">{event.ts}</span> · {event.model || event.stage || "event"} · {Object.entries(event.counts || {}).map(([k, n]) => `${k}=${n}`).join(", ")} · {[...(event.hits || event.new || []).map(hit => hit.action).filter(Boolean), ...(event.blocked ? ["blocked"] : []), ...(event.redacted ? ["redacted"] : [])].join(", ")}
                </li>
              ))}
            </ul>
            {eventsLoading && <p className="text-xs text-text-muted mt-1">Loading...</p>}
            {nextBefore && !eventsLoading && (
              <div ref={eventsSentinelRef} className="h-1" aria-hidden="true" />
            )}
          </details>

          {/* Scanner Test Card */}
          <Card>
            <div className="mb-3">
              <h3 className="font-semibold text-text-main flex items-center gap-2">
                <span className="material-symbols-outlined text-[18px] text-text-muted">science</span>
                Scanner test
              </h3>
              <p className="text-xs text-text-muted mt-0.5">
                Scan a text to preview a mode before you save it. The text is not sent to any provider.
              </p>
            </div>
            <textarea
              value={text}
              onChange={e => setText(e.target.value)}
              rows={3}
              aria-label="Text to scan"
              className="w-full rounded-[10px] border border-border bg-surface-2 p-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-500/30"
            />
            <div className="mt-3 flex items-end gap-2 flex-wrap">
              <Select label="Test with" className="w-56" value={testMode} onChange={e => { setTestMode(e.target.value); setResult(null); }} options={[{ value: "current", label: "Current settings" }, ...MODES.map(m => ({ value: m.value, label: `${m.label} (all rules)` }))]} />
              <Select label="Where" className="w-44" value={testWhere} onChange={e => { setTestWhere(e.target.value); setResult(null); }} options={TEST_WHERES} />
              <Button variant="secondary" onClick={runTest}>Scan</Button>
            </div>
            {result && (
              <div className="mt-4 space-y-3 pt-3 border-t border-border text-sm">
                {result.findings.length === 0 ? (
                  <p className="text-text-muted text-xs">No findings detected.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {result.findings.map((f, i) => (
                      <li key={i} className="flex items-center gap-2 font-mono text-xs flex-wrap">
                        <Badge size="sm" variant={ACTION_BADGE_VARIANT[f.action] || "default"}>{f.action}</Badge>
                        <span className="font-semibold text-text-main">{f.name || f.rule}:</span>
                        <span className="rounded bg-surface-2 px-1.5 py-0.5 text-text-muted">{f.match}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {result.blocked.length > 0 && (
                  <p className="text-xs text-red-500 font-medium">A real request would be blocked: {result.blocked.join(", ")}</p>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {result.before !== undefined && (
                    <div>
                      <p className="text-xs text-text-muted mb-1 font-medium">Before</p>
                      <pre className="whitespace-pre-wrap rounded-[10px] bg-surface-2 p-3 font-mono text-xs text-text-muted border border-border-subtle">{result.before}</pre>
                    </div>
                  )}
                  <div>
                    <p className="text-xs text-text-muted mb-1 font-medium">Sent upstream</p>
                    <pre className="whitespace-pre-wrap rounded-[10px] bg-surface-2 p-3 font-mono text-xs text-text-main border border-border-subtle">
                      <PlaceholderText text={result.redacted} />
                    </pre>
                  </div>
                </div>
              </div>
            )}
          </Card>
        </div>
      </details>
    </div>
  );
}
