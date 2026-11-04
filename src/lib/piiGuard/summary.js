const DAY = 24 * 60 * 60 * 1000;

export function summarize(events, { now = Date.now(), ignore = [] } = {}) {
  const since = now - DAY;
  const groups = new Map();
  const ruleHits = Object.create(null), ruleHashes = Object.create(null), ruleSources = Object.create(null), bySource = Object.create(null);
  const leaked = new Set(), blocked = new Set(), unique = new Set();
  let errors24h = 0;

  for (const event of Array.isArray(events) ? events : []) {
    const ts = Date.parse(event?.ts);
    if (!Number.isFinite(ts) || ts < since || ts > now) continue;
    if (event.type === "error") { errors24h += Number.isInteger(event.count) && event.count > 0 ? event.count : 1; continue; }
    if (event.type === "stats") continue;
    const raw = Array.isArray(event.hits) ? event.hits : Array.isArray(event.new) ? event.new : [];
    const distinct = new Set();
    for (const hit of raw) {
      if (!hit || typeof hit.hash !== "string" || typeof hit.rule !== "string") continue;
      const key = `${hit.hash}\0${hit.rule}`;
      unique.add(hit.hash);
      const source = typeof hit.source === "string" ? hit.source : "-/-";
      const action = typeof hit.action === "string" ? hit.action : "observe";
      ruleHits[hit.rule] = (ruleHits[hit.rule] || 0) + 1;
      bySource[source] = (bySource[source] || 0) + 1;
      ruleSources[hit.rule] ||= Object.create(null);
      ruleSources[hit.rule][source] = (ruleSources[hit.rule][source] || 0) + 1;
      const newTurn = !distinct.has(key);
      if (newTurn) {
        (ruleHashes[hit.rule] ||= new Set()).add(key);
        distinct.add(key);
      }
      let group = groups.get(key);
      if (!group) {
        group = { hash: hit.hash, rule: hit.rule, name: hit.name, kind: hit.kind, sources: [], actions: [], firstSeen: event.ts, lastSeen: event.ts, turns: new Set(), ignored: false };
        groups.set(key, group);
      }
      if (!group.name && hit.name) group.name = hit.name;
      if (!group.kind && hit.kind) group.kind = hit.kind;
      if (!group.sources.includes(source)) group.sources.push(source);
      if (!group.actions.includes(action)) group.actions.push(action);
      if (ts < Date.parse(group.firstSeen)) group.firstSeen = event.ts;
      if (ts > Date.parse(group.lastSeen)) group.lastSeen = event.ts;
      group.turns.add(event.ts);
      if (action === "leaked") leaked.add(hit.hash);
      if ((action === "block" || (Array.isArray(event.blocked) && (event.blocked.includes(hit.name) || event.blocked.includes(hit.rule))))) blocked.add(hit.hash);
    }
  }

  const ignored = new Set(Array.isArray(ignore) ? ignore : []);
  const outputGroups = [...groups.values()].map(group => ({
    ...group,
    turns: group.turns.size,
    ignored: ignored.has(group.hash),
    sources: group.sources.sort(),
    actions: group.actions.sort(),
  })).sort((a, b) => Date.parse(b.lastSeen) - Date.parse(a.lastSeen));
  const ruleWarnings = Object.create(null);
  for (const [rule, hits] of Object.entries(ruleHits)) {
    const sources = Object.entries(ruleSources[rule] || {});
    const out = sources.filter(([source]) => /^(assistant|system)\//.test(source));
    const count = out.reduce((sum, [, n]) => sum + n, 0);
    const share = hits ? count / hits : 0;
    if (share >= 0.5) {
      out.sort((a, b) => b[1] - a[1]);
      ruleWarnings[rule] = { topSource: out[0]?.[0] || "assistant/-", share };
    }
  }

  return {
    unique24h: unique.size,
    byRule: Object.fromEntries(Object.entries(ruleHits).map(([rule, hits]) => [rule, { unique: ruleHashes[rule]?.size || 0, hits }])),
    bySource, leaked24h: leaked.size, blocked24h: blocked.size, errors24h,
    groups: outputGroups, ruleWarnings,
  };
}
