const DAY = 24 * 60 * 60 * 1000;
const RANK = { leaked: 0, block: 1, redact: 2, observe: 3, ignored: 4 };

export function summarize(events, { since, until, now = Date.now(), ignore = [] } = {}) {
  const sinceMs = Number.isFinite(since) ? since : now - DAY;
  const untilMs = Number.isFinite(until) ? until : now;
  const groups = new Map();
  const ruleHits = Object.create(null), ruleStuck = Object.create(null), ruleHashes = Object.create(null), ruleSources = Object.create(null), bySource = Object.create(null);
  const leaked = new Set(), blocked = new Set(), unique = new Set();
  let errors24h = 0;
  let requests = 0;

  const ocrStatus = { scanned: 0, partial: 0, empty: 0, failed: 0, skipped: 0 };
  let cacheHit = 0, cacheMiss = 0, cacheCoalesced = 0, cacheNone = 0;
  const missOcrMs = [];
  let imagesWithHits = 0;
  let totalOcrEvents = 0;
  const recentOcr = [], reasons = Object.create(null);

  for (const event of Array.isArray(events) ? events : []) {
    if (event?.type === "test" || event?.test === true) continue;
    const ts = Date.parse(event?.ts);
    if (!Number.isFinite(ts) || ts < sinceMs || ts > untilMs) continue;
    if (event.type === "error") { errors24h += Number.isInteger(event.count) && event.count > 0 ? event.count : 1; continue; }
    if (event.type === "stats") continue;

    if (event.type === "ocr") {
      totalOcrEvents++;
      if (event.reason) reasons[event.reason] = (reasons[event.reason] || 0) + 1;
      recentOcr.push({ ts: event.ts, requestId: event.requestId, model: event.model, endpoint: event.endpoint, imageIndex: event.imageIndex, status: event.status, ...(event.reason && { reason: event.reason }), cache: event.cache, ocrMs: event.ocrMs, mode: event.mode, rules: [...new Set((Array.isArray(event.hits) ? event.hits : []).filter(hit => hit && hit.action !== "ignored").map(hit => hit.name || hit.rule).filter(Boolean))] });
      if (Object.hasOwn(ocrStatus, event.status)) {
        ocrStatus[event.status]++;
      }
      if (event.cache === "hit") cacheHit++;
      else if (event.cache === "miss") {
        cacheMiss++;
        if (typeof event.ocrMs === "number") missOcrMs.push(event.ocrMs);
      } else if (event.cache === "coalesced") cacheCoalesced++;
      else if (event.cache === "none") cacheNone++;

      if (Array.isArray(event.hits) && event.hits.length > 0) {
        imagesWithHits++;
      }
    } else {
      requests++;
    }

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
      // Warnings count only places Redact cannot rewrite (hit.where is set for those).
      if (typeof hit.where === "string") {
        ruleStuck[hit.rule] = (ruleStuck[hit.rule] || 0) + 1;
        ruleSources[hit.rule] ||= Object.create(null);
        ruleSources[hit.rule][hit.where] = (ruleSources[hit.rule][hit.where] || 0) + 1;
      }
      const newTurn = !distinct.has(key);
      if (newTurn) {
        (ruleHashes[hit.rule] ||= new Set()).add(key);
        distinct.add(key);
      }
      let group = groups.get(key);
      if (!group) {
        group = { hash: hit.hash, rule: hit.rule, name: hit.name, kind: hit.kind, sources: [], actions: [], action, actionTs: ts, leakedWhere: [], firstSeen: event.ts, lastSeen: event.ts, turns: new Set(), ignored: false };
        groups.set(key, group);
      }
      if (!group.name && hit.name) group.name = hit.name;
      if (!group.kind && hit.kind) group.kind = hit.kind;
      if (!group.sources.includes(source)) group.sources.push(source);
      if (!group.actions.includes(action)) group.actions.push(action);
      if (ts > group.actionTs || (ts === group.actionTs && RANK[action] < RANK[group.action])) { group.action = action; group.actionTs = ts; }
      if (action === "leaked" && typeof hit.where === "string" && !group.leakedWhere.includes(hit.where)) group.leakedWhere.push(hit.where);
      if (ts < Date.parse(group.firstSeen)) group.firstSeen = event.ts;
      if (ts > Date.parse(group.lastSeen)) group.lastSeen = event.ts;
      const turnKey = event.requestId || (event.type === "ocr" ? null : event.ts);
      if (turnKey) {
        group.turns.add(turnKey);
      } else if (group.turns.size === 0) {
        group.turns.add(event.ts);
      }
      if (action === "leaked") leaked.add(hit.hash);
      if ((action === "block" || (Array.isArray(event.blocked) && (event.blocked.includes(hit.name) || event.blocked.includes(hit.rule))))) blocked.add(hit.hash);
    }
  }

  const ignored = new Set(Array.isArray(ignore) ? ignore : []);
  const outputGroups = [...groups.values()].map(({ actionTs, ...group }) => ({
    ...group,
    turns: group.turns.size,
    ignored: ignored.has(group.hash),
    sources: group.sources.sort(),
    actions: group.actions.sort(),
  })).sort((a, b) => Date.parse(b.lastSeen) - Date.parse(a.lastSeen));
  const ruleWarnings = Object.create(null);
  for (const [rule, hits] of Object.entries(ruleHits)) {
    const share = hits ? (ruleStuck[rule] || 0) / hits : 0;
    if (share >= 0.5) {
      const out = Object.entries(ruleSources[rule]).sort((a, b) => b[1] - a[1]);
      ruleWarnings[rule] = { topSource: out[0][0], share };
    }
  }

  const cacheTotal = cacheHit + cacheMiss;
  const cacheHitRate = cacheTotal > 0 ? cacheHit / cacheTotal : 0;
  missOcrMs.sort((a, b) => a - b);
  const p95OcrMs = missOcrMs.length ? missOcrMs[Math.ceil(missOcrMs.length * 0.95) - 1] : 0;

  const ocr = {
    status: ocrStatus,
    cache: {
      hit: cacheHit,
      miss: cacheMiss,
      coalesced: cacheCoalesced,
      none: cacheNone,
      rate: cacheHitRate,
    },
    cacheHitRate,
    coalesced: cacheCoalesced,
    p95OcrMs,
    imagesWithHits,
    totalImages: totalOcrEvents,
    recent: recentOcr.sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts)).slice(0, 20),
    reasons,
  };

  return {
    requests,
    unique24h: unique.size,
    byRule: Object.fromEntries(Object.entries(ruleHits).map(([rule, hits]) => [rule, { unique: ruleHashes[rule]?.size || 0, hits }])),
    bySource, leaked24h: leaked.size, blocked24h: blocked.size, errors24h,
    groups: outputGroups, ruleWarnings,
    range: { from: sinceMs, to: untilMs },
    ocr,
  };
}
