"use client";

import { useState, useEffect, useCallback, useMemo, useRef, memo } from "react";
import { Card, Button, SegmentedControl, Select, Badge } from "@/shared/components";
import RangePicker from "./RangePicker";
import { computeRange, endsAtNow, rangeLabel, isValidPreset } from "./ranges";

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

const ACTION_OPTIONS = [
  { value: "all", label: "All actions" },
  { value: "leaked", label: "Leaked" },
  { value: "block", label: "Blocked" },
  { value: "redact", label: "Redacted" },
  { value: "observe", label: "Observed" },
];
const ACTION_LABEL_MAP = Object.fromEntries(ACTION_OPTIONS.map(o => [o.value, o.label]));

const RULE_MODES = [{ value: "default", label: "Default" }, ...MODES];

const KIND_CONFIG = {
  secret: { badge: "error" },
  pii: { badge: "info" },
  known: { badge: "success" },
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

const SOURCE_BUCKETS = ["User", "Assistant", "Tool result", "System", "Thinking"];

// Raw sources are "role/type" (e.g. "user/tool_result", "-/input_text"). Bucket by role, then by type.
function sourceBucket(source) {
  const [role = "", type = ""] = String(source || "").toLowerCase().split("/");
  if (type.includes("thinking") || type.includes("reasoning")) return "Thinking";
  if (type === "tool_result" || type === "function_call_output") return "Tool result";
  if (role === "user") return "User";
  if (role === "assistant" || role === "model") return "Assistant";
  if (role === "system" || role === "developer") return "System";
  if (role === "tool") return "Tool result";
  if (type === "input_text") return "User";
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
  if (!source || source === "-" || source === "-/-") return "Unknown";
  const parts = source.includes(" · ") ? source.split(" · ") : (source.includes("/") ? source.split("/") : null);
  if (parts && parts.length === 2) {
    const roleDash = parts[0] === "-" || !parts[0] || parts[0].toLowerCase() === "unknown";
    const typeDash = parts[1] === "-" || !parts[1];
    if (roleDash && typeDash) return "Unknown";
    if (typeDash) return parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
    const role = roleDash ? "Unknown" : parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
    const type = parts[1].replace(/_/g, " ");
    return `${role} · ${type}`;
  }
  const clean = source.replace(/_/g, " ");
  return clean === "-" ? "Unknown" : clean;
}


function shortSource(s) {
  if (!s || s === "-" || s === "-/-") return "Unknown";
  const parts = s.includes(" · ") ? s.split(" · ") : (s.includes("/") ? s.split("/") : null);
  if (parts && parts.length === 2) {
    const roleDash = parts[0] === "-" || !parts[0] || parts[0].toLowerCase() === "unknown";
    const typeDash = parts[1] === "-" || !parts[1];
    if (roleDash && typeDash) return "Unknown";
    const r = roleDash ? "Unknown" : parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
    if (typeDash) return r;
    let t = parts[1];
    if (t.startsWith("tool")) t = "tool";
    else if (t.startsWith("function") || t.startsWith("func")) t = "func";
    else if (t.includes("think") || t.includes("reason")) t = "thinking";
    else if (t.includes("image")) t = "image";
    else if (t.includes("text")) t = "text";
    else t = t.replace(/_/g, " ");
    return `${r}·${t}`;
  }
  const str = s.replace(/_/g, " ");
  if (str === "-" || str === "other") return "Unknown";
  if (str === "function call output" || str === "function call") return "Func";
  if (str === "tool result" || str === "tool use") return "Tool";
  if (str.includes("thinking") || str.includes("reasoning")) return "Thinking";
  return str.charAt(0).toUpperCase() + str.slice(1);
}

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

function readUrl() {
  if (typeof window === "undefined") return null;
  const p = new URLSearchParams(window.location.search);
  let range = p.get("range") || "24h";
  if (range === "6h") range = "24h"; // 6h is gone; widen rather than hide findings
  if (range === "custom") {
    const from = p.get("from") ? Number(p.get("from")) : null;
    const to = p.get("to") ? Number(p.get("to")) : null;
    if (!from || !to || !Number.isFinite(from) || !Number.isFinite(to) || from >= to || to - from > 90 * 86400000) {
      range = "24h";
    }
  } else if (!isValidPreset(range)) {
    range = "24h";
  }
  return {
    range,
    from: p.get("from") ? Number(p.get("from")) : null,
    to: p.get("to") ? Number(p.get("to")) : null,
    view: p.get("view") === "events" ? "events" : "values",
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
  const rawSources = (leakedView && group.leakedWhere?.length) ? group.leakedWhere : (group.sources || []);
  const fullTooltip = rawSources.map(humanizeSource).join(", ");
  const shownSources = rawSources.slice(0, 2);
  const remainingSources = rawSources.length - 2;

  return (
    <tr className="align-middle hover:bg-surface-2/40 transition-colors">
      <td className="py-2 pr-3 w-8">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          aria-label={`Select ${group.name || ruleMeta?.label || group.rule}`}
          className="size-4 accent-brand-500 cursor-pointer align-middle"
        />
      </td>
      <td className="py-2 pr-3" title={`${ruleMeta?.label || group.rule} · ${group.name ? group.name + " · " : ""}${group.hash}`}>
        <div className="flex items-center gap-1.5 truncate">
          <span className="font-medium text-text-main truncate">{ruleMeta?.label || group.rule}</span>
          {ruleMeta?.group && (
            <span className="shrink-0 rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-text-muted">
              {groupLabel}
            </span>
          )}
          {!group.name && (
            <span className="shrink-0 font-mono text-[10px] text-text-muted opacity-75">{group.hash}</span>
          )}
        </div>
        {group.name && (
          <div className="text-[11px] text-text-muted truncate max-w-[220px]">
            {group.name} <span className="font-mono text-[10px] opacity-75">{group.hash}</span>
          </div>
        )}
      </td>
      <td className="py-2 pr-3 whitespace-nowrap">
        {rawSources.length === 0 ? (
          <span className="text-text-muted">—</span>
        ) : (
          <div className="flex items-center gap-1 truncate max-w-[200px]" title={fullTooltip}>
            {shownSources.map((s, idx) => (
              <span key={idx} className="shrink-0 inline-block rounded bg-surface-2 px-1.5 py-0.5 text-[11px] text-text-muted">
                {shortSource(s)}
              </span>
            ))}
            {remainingSources > 0 && (
              <span className="shrink-0 text-[11px] text-text-muted font-medium" title={fullTooltip}>
                +{remainingSources}
              </span>
            )}
          </div>
        )}
      </td>
      <td className="py-2 pr-3 whitespace-nowrap" title={actions.length > 0 ? `History: ${actions.join(", ")}` : undefined}>
        {latest ? (
          <Badge size="sm" variant={ACTION_BADGE_VARIANT[latest] || (leakedView ? "error" : "default")}>
            {latest}
          </Badge>
        ) : (
          <span className="text-text-muted">—</span>
        )}
      </td>
      <td className="py-2 pr-3 whitespace-nowrap text-text-muted" title={new Date(group.firstSeen).toLocaleString()}>
        {age(group.firstSeen)}
      </td>
      <td className="py-2 pr-3 whitespace-nowrap font-medium text-text-main" title={new Date(group.lastSeen).toLocaleString()}>
        {age(group.lastSeen)}
      </td>
      <td className="py-2 pr-3 font-mono text-text-muted whitespace-nowrap">
        {count(group.turns)}
      </td>
      <td className="py-2 text-right whitespace-nowrap">
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
  const [view, setView] = useState(urlInit?.view || "values");

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

  const tableRef = useRef(null);
  const scrollContainerRef = useRef(null);
  const sentinelRef = useRef(null);
  const eventsSentinelRef = useRef(null);
  const fingerprintRef = useRef("");
  const loadIdRef = useRef(0);
  const eventsIdRef = useRef(0);
  const debounceRef = useRef(null);

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
    if (rangePreset === "custom" && customFromMs && customToMs) {
      p.set("range", "custom");
      p.set("from", String(customFromMs));
      p.set("to", String(customToMs));
    } else if (rangePreset) {
      p.set("range", rangePreset);
    }
    if (view === "events") p.set("view", "events");
    if (groupFilter !== "all") p.set("group", groupFilter);
    if (ruleFilter !== "all") p.set("rule", ruleFilter);
    if (actionFilter !== "all") p.set("action", actionFilter);
    if (whereFilter !== "all") p.set("where", whereFilter);
    if (statusFilter !== "active") p.set("status", statusFilter);
    if (debouncedSearch) p.set("q", debouncedSearch);
    if (sortKey !== "lastSeen") p.set("sort", sortKey);
    if (sortDir !== "desc") p.set("dir", sortDir);
    const qs = p.toString();
    history.replaceState(null, "", qs ? `${window.location.pathname}?${qs}` : window.location.pathname);
  }, [rangePreset, customFromMs, customToMs, view, groupFilter, ruleFilter, actionFilter, whereFilter, statusFilter, debouncedSearch, sortKey, sortDir]);

  const load = useCallback(() => {
    if (typeof document !== "undefined" && document.hidden) return;
    const r = computeRange(rangePreset, customFromMs, customToMs);
    const id = ++loadIdRef.current;
    fetch(`/api/pii-guard?from=${r.from}&to=${r.to}`)
      .then(async res => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        if (id !== loadIdRef.current) return;
        const { range: _range, ...summary } = data.summary || {};
        const fp = JSON.stringify([data.config, data.health, data.rules, summary]);
        if (fp === fingerprintRef.current) return;
        fingerprintRef.current = fp;
        setState(data);
        setError("");
      })
      .catch(e => { if (id === loadIdRef.current) setError(e.message); });
  }, [rangePreset, customFromMs, customToMs]);

  // initial + polling
  useEffect(() => {
    load();
    if (!endsAtNow(rangePreset)) return;
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [load, rangePreset]);

  // visibility
  useEffect(() => {
    const onVis = () => { if (!document.hidden) load(); };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [load]);

  const save = patch => call(patch).then(() => { setError(""); fingerprintRef.current = ""; load(); return true; }).catch(e => { setError(e.message); return false; });

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
  }, [state]);

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

  const handleGroupChange = useCallback((newGroup) => {
    setGroupFilter(newGroup);
    if (ruleFilter !== "all") {
      const r = ruleLabelMap.get(ruleFilter);
      const gid = r?.group || "other";
      if (newGroup !== "all" && gid !== newGroup) {
        setRuleFilter("all");
      }
    }
  }, [ruleFilter, ruleLabelMap]);

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
        if (actionFilter === "leaked") {
          if (!(group.actions || []).includes("leaked") && group.action !== "leaked") return false;
        } else {
          const targetAction = actionFilter === "blocked" ? "block" : actionFilter;
          const lastAction = group.action || (group.actions || [])[(group.actions || []).length - 1];
          if (lastAction !== targetAction) return false;
        }
      }
      if (whereFilter !== "all") {
        const buckets = (group.sources || []).map(sourceBucket);
        if (!buckets.includes(whereFilter)) return false;
      }
      if (statusFilter === "active" && group.ignored) return false;
      if (statusFilter === "ignored" && !group.ignored) return false;
      const q = debouncedSearch.trim().toLowerCase();
      if (q) {
        const matchLabel = (ruleMeta?.label || "").toLowerCase().includes(q);
        const matchRule = (group.rule || "").toLowerCase().includes(q);
        const matchName = (group.name || "").toLowerCase().includes(q);
        const matchHash = (group.hash || "").toLowerCase().includes(q);
        if (!matchLabel && !matchRule && !matchName && !matchHash) return false;
      }
      return true;
    });

    const dir = sortDir === "asc" ? 1 : -1;
    list.sort((a, b) => {
      if (sortKey === "name") {
        const an = ruleLabelMap.get(a.rule)?.label || a.rule || "";
        const bn = ruleLabelMap.get(b.rule)?.label || b.rule || "";
        const cmp = an.localeCompare(bn);
        if (cmp !== 0) return cmp * dir;
        const an2 = a.name || a.hash || "";
        const bn2 = b.name || b.hash || "";
        return an2.localeCompare(bn2) * dir;
      }
      if (sortKey === "firstSeen") return (Date.parse(a.firstSeen) - Date.parse(b.firstSeen)) * dir;
      if (sortKey === "lastSeen") return (Date.parse(a.lastSeen) - Date.parse(b.lastSeen)) * dir;
      if (sortKey === "turns") return (a.turns - b.turns) * dir;
      return 0;
    });
    return list;
  }, [state?.summary?.groups, groupFilter, ruleFilter, actionFilter, whereFilter, statusFilter, debouncedSearch, sortKey, sortDir, ruleLabelMap]);

  // Reset pagination and selection on filter or range change
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelected(new Set());
    setVisibleCount(50);
  }, [groupFilter, ruleFilter, actionFilter, whereFilter, statusFilter, debouncedSearch, sortKey, sortDir, rangePreset, customFromMs, customToMs]);

  // sentinel observer bound to the scroll block
  useEffect(() => {
    const el = sentinelRef.current;
    const root = scrollContainerRef.current;
    if (!el || !root || view !== "values") return;
    const io = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && visibleCount < filteredRows.length) {
        setVisibleCount(c => Math.min(c + 50, filteredRows.length));
      }
    }, { root });
    io.observe(el);
    return () => io.disconnect();
  }, [visibleCount, filteredRows.length, view]);

  const displayedRows = filteredRows.slice(0, visibleCount);

  const ignoredByHash = useMemo(() => {
    const map = new Map();
    (state?.summary?.groups || []).forEach(g => map.set(g.hash, !!g.ignored));
    return map;
  }, [state?.summary?.groups]);

  // events pagination
  const loadEventsPage = useCallback(async (cursor) => {
    const id = ++eventsIdRef.current;
    setEventsLoading(true);
    try {
      const r = computeRange(rangePreset, customFromMs, customToMs);
      const url = `/api/pii-guard?events=1&limit=50&from=${r.from}&to=${r.to}` + (cursor ? `&before=${cursor.before}&skip=${cursor.skip}` : "");
      const res = await fetch(url);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      if (id !== eventsIdRef.current) return;
      if (cursor) setEventsList(prev => [...prev, ...(data.events || [])]);
      else setEventsList(data.events || []);
      setNextBefore(data.next);
    } catch (e) { if (id === eventsIdRef.current) setError(e.message); }
    finally { if (id === eventsIdRef.current) setEventsLoading(false); }
  }, [rangePreset, customFromMs, customToMs]);

  // Load first page of events when events tab is selected, and reset on range changes
  useEffect(() => {
    if (view !== "events") return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEventsList([]);
    setNextBefore(null);
    loadEventsPage(null);
    const eventsId = eventsIdRef;
    return () => { eventsId.current++; };
  }, [view, rangePreset, customFromMs, customToMs, loadEventsPage]);

  const hasState = !!state;
  // sentinel observer for events pagination inside scroll block
  useEffect(() => {
    const el = eventsSentinelRef.current;
    const root = scrollContainerRef.current;
    if (!el || !root || view !== "events") return;
    const io = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && nextBefore && !eventsLoading) {
        loadEventsPage(nextBefore);
      }
    }, { root });
    io.observe(el);
    return () => io.disconnect();
  }, [view, nextBefore, eventsLoading, loadEventsPage, hasState]); // the scroll block mounts once the summary loads

  const handleRangeChange = useCallback(({ preset, from, to }) => {
    setRangePreset(preset);
    setCustomFromMs(from);
    setCustomToMs(to);
  }, []);

  if (!state) return <div className="p-6 text-text-muted">{error || "Loading..."}</div>;

  const {
    config = { mode: "observe", rules: {}, ignore: [] },
    summary = {},
    health = null,
    enabled,
    available,
  } = state;

  const knownUpdated = health?.knownUpdated;
  const activeRangeLabel = rangeLabel(rangePreset, customFromMs, customToMs);

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
  const allSelected = visibleHashes.size > 0 && selectedVisible.length === visibleHashes.size; // a hash can appear under two rules
  const toggleAll = () => {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filteredRows.map(g => g.hash)));
    }
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

  const handleSort = (key) => {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("desc"); }
  };

  const ariaSort = (key) => sortKey === key ? (sortDir === "asc" ? "ascending" : "descending") : "none";

  const activeChips = [];
  if (groupFilter !== "all") activeChips.push({ key: "group", label: `Group: ${groupLabelMap.get(groupFilter) || groupFilter}`, clear: () => handleGroupChange("all") });
  if (ruleFilter !== "all") activeChips.push({ key: "rule", label: `Rule: ${ruleLabelMap.get(ruleFilter)?.label || ruleFilter}`, clear: () => setRuleFilter("all") });
  if (actionFilter !== "all") activeChips.push({ key: "action", label: `Action: ${ACTION_LABEL_MAP[actionFilter] || actionFilter}`, clear: () => setActionFilter("all") });
  if (whereFilter !== "all") activeChips.push({ key: "where", label: `Where: ${whereFilter}`, clear: () => setWhereFilter("all") });
  if (statusFilter !== "active") activeChips.push({ key: "status", label: `Status: ${statusFilter === "all" ? "All" : statusFilter === "ignored" ? "Ignored" : "Active"}`, clear: () => setStatusFilter("active") });
  if (debouncedSearch) activeChips.push({ key: "q", label: `Search: ${debouncedSearch}`, clear: () => { setSearchQuery(""); setDebouncedSearch(""); } });

  const clearAllFilters = () => {
    setGroupFilter("all");
    setRuleFilter("all");
    setActionFilter("all");
    setWhereFilter("all");
    setStatusFilter("active");
    setSearchQuery("");
    setDebouncedSearch("");
  };

  const scrollToTable = () => tableRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });

  return (
    <div className="space-y-6">
      {/* Sticky page-level toolbar directly under header */}
      {/* Offsets cancel DashboardLayout's p-6 lg:p-10 so the bar sits flush under the header. */}
      <div className="sticky -top-6 lg:-top-10 z-20 bg-bg border-b border-border -mt-6 lg:-mt-10 -mx-6 lg:-mx-10 px-6 lg:px-10 py-2.5">
        <div className="flex items-center justify-end gap-2">
          <span className="text-xs text-text-muted">Data for</span>
          <RangePicker
            preset={rangePreset}
            from={customFromMs}
            to={customToMs}
            onChange={handleRangeChange}
          />
        </div>
      </div>

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

      {/* 1. Mode Card - keeps only mode control */}
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
          <SegmentedControl options={MODES} value={config.mode} onChange={mode => chooseMode(mode)} />
        </div>
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

      {/* 2. Stat cards row - equal height */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="h-full flex flex-col justify-between p-4">
          <div className="flex items-center justify-between text-text-muted">
            <span className="text-xs font-semibold uppercase tracking-wider">Unique values</span>
            <span className={`material-symbols-outlined text-[20px] ${summary.unique24h ? "text-brand-500" : ""}`}>fingerprint</span>
          </div>
          <div className="mt-3">
            <span className={`text-2xl font-bold tracking-tight ${summary.unique24h ? "text-text-main" : "text-text-muted"}`}>{count(summary.unique24h)}</span>
            <span className="block text-xs text-text-muted mt-0.5">{activeRangeLabel}</span>
          </div>
        </Card>

        <Card className={`h-full p-4 ${actionFilter === "leaked" ? "border-red-500/40" : ""}`}>
          <button
            type="button"
            onClick={() => setActionFilter(a => a === "leaked" ? "all" : "leaked")}
            aria-pressed={actionFilter === "leaked"}
            className="w-full h-full text-left cursor-pointer flex flex-col justify-between"
          >
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
          </button>
        </Card>

        <Card className="h-full flex flex-col justify-between p-4">
          <div className="flex items-center justify-between text-text-muted">
            <span className="text-xs font-semibold uppercase tracking-wider">Blocked</span>
            <span className={`material-symbols-outlined text-[20px] ${summary.blocked24h ? "text-amber-500" : ""}`}>block</span>
          </div>
          <div className="mt-3">
            <span className={`text-2xl font-bold tracking-tight ${summary.blocked24h ? "text-amber-500 dark:text-amber-400" : "text-text-muted"}`}>{count(summary.blocked24h)}</span>
            <span className="block text-xs text-text-muted mt-0.5">Requests rejected (400)</span>
          </div>
        </Card>

        <Card className="h-full flex flex-col justify-between p-4">
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

      {/* 3. Scanner Health Card */}
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

      {/* 4. Rule Groups Card */}
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
                        onClick={(e) => {
                          e.preventDefault();
                          setGroupFilter(group.id);
                          setRuleFilter("all");
                          scrollToTable();
                        }}
                        className="py-1.5 px-2 rounded text-xs text-text-muted font-mono hover:text-primary hover:bg-surface-2 transition-colors cursor-pointer inline-flex items-center min-h-[28px]"
                        title="Filter table by this group"
                      >
                        {count(totals.unique)} unique / {count(totals.hits)} hits / {activeRangeLabel}
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
                                  · {count(byRule.unique)} unique / {count(byRule.hits)} hits / {activeRangeLabel}
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
                              className="p-0.5"
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
                      className="p-0.5"
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

      {/* 5. Scanner Test Card */}
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

      {/* 6. Where values appeared Card */}
      <Card className="p-4 sm:p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-text-main flex items-center gap-2">
            <span className="material-symbols-outlined text-[18px] text-text-muted">location_on</span>
            Where values appeared
          </h3>
        </div>
        {sortedSources.length === 0 ? (
          <p className="text-xs text-text-muted">No source activity for {activeRangeLabel}.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2.5">
            {sortedSources.map(item => {
              const pct = Math.max(2, Math.round((item.hits / maxSourceHits) * 100));
              return (
                <div key={item.source} className="space-y-1">
                  <div className="flex items-center justify-between text-xs gap-2">
                    <span className="font-medium text-text-main truncate">{item.label}</span>
                    <span className="shrink-0 text-right">
                      <span className="font-medium text-text-main">{count(item.hits)}</span>{" "}
                      <span className="text-text-muted">hits</span>
                    </span>
                  </div>
                  <div role="progressbar" aria-label={`${item.label}: ${count(item.hits)}`} aria-valuenow={item.hits} aria-valuemin={0} aria-valuemax={maxSourceHits} className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
                    <div className="h-full rounded-full bg-brand-500/80 transition-all duration-300" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* 7. Findings Table & Recent Events Card */}
      <Card>
        <div ref={tableRef} />

        {/* Section Header: Title + range phrase + count badge on left, small Tab switch + Refresh on right */}
        <div className="flex items-center justify-between gap-3 mb-1 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold text-text-main flex items-center gap-2">
              <span className="material-symbols-outlined text-[18px] text-text-muted">search_check</span>
              Values seen
            </h3>
            <span className="text-xs text-text-muted">({activeRangeLabel})</span>
            {view === "values" && (
              <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-medium text-text-main">
                {count(filteredRows.length)}{filteredRows.length !== (summary.groups || []).length ? ` of ${count((summary.groups || []).length)}` : ""}
              </span>
            )}
            {view === "events" && eventsList.length > 0 && (
              <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-medium text-text-main">
                {count(eventsList.length)} events
              </span>
            )}
            {summary.truncated && (
              <Badge variant="warning" size="sm">Partial log</Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            <SegmentedControl
              size="sm"
              options={[
                { value: "values", label: "Values" },
                { value: "events", label: "Event log" },
              ]}
              value={view}
              onChange={setView}
            />
            <button
              type="button"
              onClick={view === "events" ? () => { setEventsList([]); setNextBefore(null); loadEventsPage(null); } : load}
              aria-label="Refresh"
              title="Refresh"
              className="inline-flex size-9 items-center justify-center rounded-[10px] bg-surface-2 text-text-muted hover:text-text-main hover:bg-surface-2/80 transition-colors cursor-pointer"
            >
              <span className="material-symbols-outlined text-[18px]">refresh</span>
            </button>
          </div>
        </div>

        {view === "values" && (
          <div>
            {/* One-line explanation in smaller muted text */}
            <p className="text-xs text-text-muted mb-3">
              Each row is one unique value (by hash), not one request. Turns = requests that contained it.
            </p>

            {/* Single toolbar: search + 5 compact selects + secondary ignore-recent control */}
            <div className="flex items-center gap-2.5 mb-3 flex-wrap">
              <div className="relative flex-1 min-w-[200px]">
                <span className="material-symbols-outlined absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-text-muted text-[18px]">search</span>
                <input
                  type="text"
                  placeholder="Filter by rule, name, or hash..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  aria-label="Filter findings by rule, name, or hash"
                  className="h-9 w-full pl-9 pr-3 text-sm text-text-main bg-surface-2 rounded-[10px] border border-transparent placeholder-text-muted/70 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500/40"
                />
              </div>
              <Select size="sm" className="w-auto min-w-[130px]" value={groupFilter} onChange={e => handleGroupChange(e.target.value)} options={groupOptions} />
              <Select size="sm" className="w-auto min-w-[130px]" value={ruleFilter} onChange={e => setRuleFilter(e.target.value)} options={ruleFilterOptions} />
              <Select size="sm" className="w-auto min-w-[120px]" value={actionFilter} onChange={e => setActionFilter(e.target.value)} options={ACTION_OPTIONS} />
              <Select size="sm" className="w-auto min-w-[130px]" value={whereFilter} onChange={e => setWhereFilter(e.target.value)} options={whereOptions} />
              <Select size="sm" className="w-auto min-w-[100px]" value={statusFilter} onChange={e => setStatusFilter(e.target.value)} options={[
                { value: "active", label: "Active" },
                { value: "ignored", label: "Ignored" },
                { value: "all", label: "All" },
              ]} />
              <div className="flex items-center gap-1.5 shrink-0">
                <Select size="sm" aria-label="Ignore values first seen in the last" className="w-24" value={recentMinutes} onChange={e => setRecentMinutes(e.target.value)} options={RECENT_MINUTES} />
                <Button size="sm" variant="secondary" className="h-9 whitespace-nowrap" onClick={ignoreRecent}>Ignore recent</Button>
              </div>
            </div>

            {/* Filter chips with "Clear all", shown only when a filter is active */}
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

            {/* Bulk action bar - slim highlighted bar, appears only when at least one row is selected */}
            {selectedVisible.length > 0 && (
              <div className="flex items-center justify-between gap-3 px-3 py-2 mb-3 rounded-lg bg-brand-500/10 border border-brand-500/20 text-xs flex-wrap">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-brand-600 dark:text-brand-400">
                    {count(selectedVisible.length)} selected
                  </span>
                  {!allSelected && (
                    <button
                      type="button"
                      onClick={toggleAll}
                      className="text-primary hover:underline font-medium cursor-pointer"
                    >
                      Select all {count(filteredRows.length)}
                    </button>
                  )}
                  <span className="text-text-muted">·</span>
                  <Button size="sm" variant="secondary" className="h-7 text-xs" disabled={bulkDisabled} onClick={bulkIgnore}>
                    {anySelectedVisible ? "Ignore selected" : "Unignore selected"}
                  </Button>
                  {ruleFilter !== "all" && (
                    <Button size="sm" variant="secondary" className="h-7 text-xs" onClick={ignoreThisRule} disabled={!ruleHashes.length || ruleHashes.length > 1000}>
                      Ignore all shown for this rule
                    </Button>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setSelected(new Set())}
                  className="text-text-muted hover:text-text-main cursor-pointer"
                >
                  Deselect all
                </button>
              </div>
            )}

            {filteredRows.length === 0 ? (
              <div className="py-8 text-center text-sm text-text-muted">No findings matched filter.</div>
            ) : (
              <div ref={scrollContainerRef} className="max-h-[60vh] overflow-y-auto overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 z-10 bg-surface text-left text-xs uppercase text-text-muted border-b border-border">
                    <tr>
                      <th className="py-2.5 pr-3 font-semibold w-8">
                        <input
                          type="checkbox"
                          checked={allSelected}
                          onChange={toggleAll}
                          aria-label={`Select all ${filteredRows.length}`}
                          title={`Select all ${filteredRows.length}`}
                          className="size-4 accent-brand-500 cursor-pointer align-middle"
                        />
                      </th>
                      <th className="py-2.5 pr-3 font-semibold whitespace-nowrap" aria-sort={ariaSort("name")}>
                        <button type="button" className="uppercase font-semibold hover:text-text-main" onClick={() => handleSort("name")}>
                          Name {sortKey === "name" ? (sortDir === "asc" ? "▲" : "▼") : ""}
                        </button>
                      </th>
                      <th className="py-2.5 pr-3 font-semibold whitespace-nowrap">Where</th>
                      <th className="py-2.5 pr-3 font-semibold whitespace-nowrap">Action</th>
                      <th className="py-2.5 pr-3 font-semibold whitespace-nowrap" aria-sort={ariaSort("firstSeen")}>
                        <button type="button" className="uppercase font-semibold hover:text-text-main whitespace-nowrap" onClick={() => handleSort("firstSeen")}>
                          First seen {sortKey === "firstSeen" ? (sortDir === "asc" ? "▲" : "▼") : ""}
                        </button>
                      </th>
                      <th className="py-2.5 pr-3 font-semibold whitespace-nowrap" aria-sort={ariaSort("lastSeen")}>
                        <button type="button" className="uppercase font-semibold hover:text-text-main whitespace-nowrap" onClick={() => handleSort("lastSeen")}>
                          Last seen {sortKey === "lastSeen" ? (sortDir === "asc" ? "▲" : "▼") : ""}
                        </button>
                      </th>
                      <th className="py-2.5 pr-3 font-semibold whitespace-nowrap" aria-sort={ariaSort("turns")}>
                        <button type="button" className="uppercase font-semibold hover:text-text-main whitespace-nowrap" onClick={() => handleSort("turns")}>
                          Turns {sortKey === "turns" ? (sortDir === "asc" ? "▲" : "▼") : ""}
                        </button>
                      </th>
                      <th className="py-2.5 text-right font-semibold whitespace-nowrap w-24">
                        <span className="sr-only">Ignore</span>
                      </th>
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
          </div>
        )}

        {view === "events" && (
          <div>
            <p className="text-xs text-text-muted mb-3">
              Raw scanner events recorded for this range.
            </p>
            {eventsList.length === 0 && !eventsLoading ? (
              <div className="py-8 text-center text-sm text-text-muted">No events recorded in this range.</div>
            ) : (
              <div ref={scrollContainerRef} className="max-h-[60vh] overflow-y-auto divide-y divide-border border border-border rounded-lg bg-surface">
                {eventsList.map((event, i) => {
                  const actions = [...new Set([
                    ...(event.hits || event.new || []).map(hit => hit.action).filter(Boolean),
                    ...(event.blocked ? ["block"] : []),
                    ...(event.redacted ? ["redact"] : []),
                  ])];
                  const countsEntries = Object.entries(event.counts || {});
                  const countsStr = countsEntries.length > 0
                    ? countsEntries.map(([rule, n]) => `${ruleLabelMap.get(rule)?.label || rule}: ${count(n)}`).join(" · ")
                    : "";
                  return (
                    <div
                      key={`${event.ts}:${i}`}
                      className="flex items-center gap-3 py-2 px-3 text-xs hover:bg-surface-2/40 transition-colors truncate"
                      title={event.ts ? new Date(event.ts).toLocaleString() : undefined}
                    >
                      <span className="shrink-0 text-text-muted whitespace-nowrap w-20 text-[11px]">
                        {age(event.ts)}
                      </span>
                      <span className="shrink-0 font-medium text-text-main truncate max-w-[180px]">
                        {event.model || event.endpoint || event.stage || "request"}
                      </span>
                      <div className="shrink-0 flex items-center gap-1">
                        {actions.map(a => (
                          <Badge key={a} size="sm" variant={ACTION_BADGE_VARIANT[a] || "default"}>
                            {a}
                          </Badge>
                        ))}
                      </div>
                      {countsStr && (
                        <span className="text-text-muted truncate min-w-0 font-mono text-[11px]">
                          {countsStr}
                        </span>
                      )}
                    </div>
                  );
                })}
                {eventsLoading && (
                  <div className="py-3 text-center text-xs text-text-muted">Loading events...</div>
                )}
                {nextBefore && !eventsLoading && (
                  <div ref={eventsSentinelRef} className="h-1" aria-hidden="true" />
                )}
              </div>
            )}
            {eventsList.length > 0 && (
              <div className="p-3 text-center border-t border-border bg-surface-2/30 text-xs text-text-muted mt-3 rounded-b-lg">
                Showing {count(eventsList.length)} events{nextBefore ? " (scroll for more)" : ""}
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
