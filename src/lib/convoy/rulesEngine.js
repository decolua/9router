/**
 * Input guard rule engine.
 * Applies text replacement rules to a JSON request body before it reaches upstream.
 *
 * Rules are applied in priority order (lower number = first).
 * Each rule walks the entire JSON tree and replaces/deletes matching text in all string values.
 */

/**
 * Escape regex special characters for literal matching.
 */
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Apply rules to a request body. Returns { body, hits }.
 *
 * @param {object}  body  - Parsed JSON request body
 * @param {Array}   rules - Array of rule objects: { id, name, enabled, priority, matchType, action, pattern, replacement, caseSensitive }
 * @returns {{ body: object, hits: Array<{ruleId: string, ruleName: string, count: number}> }}
 */
export function applyConvoyRules(body, rules, providerId = null) {
  const active = rules
    .filter((r) => {
      if (!r.enabled) return false;
      const providerIds = Array.isArray(r.providerIds) ? r.providerIds : [];
      return providerIds.length === 0 || (providerId && providerIds.includes(providerId));
    })
    .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));

  if (active.length === 0) return { body, hits: [] };

  const hits = [];
  const cleaned = walk(body, active, hits, "$");
  return { body: cleaned, hits };
}

function walk(value, rules, hits, path) {
  if (typeof value === "string") {
    let result = value;
    for (const rule of rules) {
      const flags = rule.caseSensitive ? "g" : "gi";
      let re;
      try {
        re = rule.matchType === "regex"
          ? new RegExp(rule.pattern, flags)
          : new RegExp(escapeRegex(rule.pattern), flags);
      } catch {
        continue;
      }

      const matches = result.match(re);
      if (matches?.length) {
        const replacement = rule.action === "delete" ? "" : (rule.replacement ?? "");
        result = result.replace(re, () => replacement);
        const existing = hits.find((h) => h.ruleId === rule.id);
        if (existing) {
          existing.count += matches.length;
        } else {
          hits.push({ ruleId: rule.id, ruleName: rule.name, count: matches.length });
        }
      }
    }
    return result;
  }

  if (Array.isArray(value)) {
    return value.map((item, i) => walk(item, rules, hits, `${path}[${i}]`));
  }

  if (value !== null && typeof value === "object") {
    const result = {};
    for (const [key, val] of Object.entries(value)) {
      result[key] = walk(val, rules, hits, `${path}.${key}`);
    }
    return result;
  }

  return value;
}
