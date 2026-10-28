/**
 * Model search filtering utility with support for:
 * 1. Case-insensitive substring matching
 * 2. Negation / exclusion tokens (!keyword or -keyword)
 * 3. Combined queries (e.g. "claude !haiku")
 * 4. Regular expressions (/pattern/flags or /pattern/)
 */

/**
 * Parse a raw search query into a structured query object.
 * @param {string|null|undefined} rawQuery
 * @returns {{
 *   raw: string,
 *   isEmpty: boolean,
 *   isRegex: boolean,
 *   regex: RegExp|null,
 *   positiveTerms: string[],
 *   negativeTerms: string[]
 * }}
 */
export function parseSearchQuery(rawQuery) {
  if (!rawQuery || typeof rawQuery !== "string") {
    return {
      raw: "",
      isEmpty: true,
      isRegex: false,
      regex: null,
      positiveTerms: [],
      negativeTerms: [],
    };
  }

  const trimmed = rawQuery.trim();
  if (!trimmed) {
    return {
      raw: "",
      isEmpty: true,
      isRegex: false,
      regex: null,
      positiveTerms: [],
      negativeTerms: [],
    };
  }

  // Check for regex syntax: /pattern/flags or /pattern/
  if (trimmed.startsWith("/")) {
    const fullRegexMatch = trimmed.match(/^\/(.+)\/([a-z]*)$/i);
    if (fullRegexMatch) {
      try {
        const flags = fullRegexMatch[2] || "i";
        const regex = new RegExp(fullRegexMatch[1], flags);
        return {
          raw: trimmed,
          isEmpty: false,
          isRegex: true,
          regex,
          positiveTerms: [],
          negativeTerms: [],
        };
      } catch {
        // Invalid regex flags or syntax - fallback to literal
      }
    } else if (trimmed.length > 1) {
      // Allow live typing for leading slash, e.g. /claude.*
      try {
        const regex = new RegExp(trimmed.slice(1), "i");
        return {
          raw: trimmed,
          isEmpty: false,
          isRegex: true,
          regex,
          positiveTerms: [],
          negativeTerms: [],
        };
      } catch {
        // Syntax not yet valid while typing (e.g. unclosed parenthesis)
      }
    }
  }

  // Standard term parsing with negation support
  const tokens = trimmed.split(/\s+/);
  const positiveTerms = [];
  const negativeTerms = [];

  for (const token of tokens) {
    if (!token) continue;
    if ((token.startsWith("!") || token.startsWith("-")) && token.length > 1) {
      negativeTerms.push(token.slice(1).toLowerCase());
    } else {
      positiveTerms.push(token.toLowerCase());
    }
  }

  return {
    raw: trimmed,
    isEmpty: positiveTerms.length === 0 && negativeTerms.length === 0,
    isRegex: false,
    regex: null,
    positiveTerms,
    negativeTerms,
  };
}

/**
 * Check if a set of candidate strings matches the parsed query.
 * @param {string|string[]|object} target
 * @param {ReturnType<typeof parseSearchQuery>|string} queryOrParsed
 * @returns {boolean}
 */
export function matchesSearch(target, queryOrParsed) {
  const parsed = typeof queryOrParsed === "string" || !queryOrParsed
    ? parseSearchQuery(queryOrParsed)
    : queryOrParsed;

  if (parsed.isEmpty) {
    return true;
  }

  // Extract candidate strings from target
  let candidates = [];
  if (typeof target === "string") {
    candidates = [target];
  } else if (Array.isArray(target)) {
    candidates = target.filter((t) => typeof t === "string");
  } else if (target && typeof target === "object") {
    candidates = [
      target.name,
      target.id,
      target.value,
      target.alias,
      target.provider,
    ].filter((t) => typeof t === "string");
  }

  if (candidates.length === 0) {
    return false;
  }

  // Handle Regex
  if (parsed.isRegex && parsed.regex) {
    // Each target is an independent search, including for global/sticky regexes.
    parsed.regex.lastIndex = 0;
    const fullText = candidates.join(" ");
    const hasNegativeAssertion = /\(\?!|\(\?<!/.test(parsed.raw);
    if (hasNegativeAssertion) {
      return parsed.regex.test(fullText);
    }
    return candidates.some((text) => parsed.regex.test(text)) || parsed.regex.test(fullText);
  }

  const lowerCandidates = candidates.map((c) => c.toLowerCase());

  // Handle Negations: reject if ANY candidate contains ANY negative term
  if (parsed.negativeTerms.length > 0) {
    for (const neg of parsed.negativeTerms) {
      if (lowerCandidates.some((c) => c.includes(neg))) {
        return false;
      }
    }
  }

  // Handle Positive Terms: ALL positive terms must match at least one candidate
  if (parsed.positiveTerms.length > 0) {
    for (const pos of parsed.positiveTerms) {
      if (!lowerCandidates.some((c) => c.includes(pos))) {
        return false;
      }
    }
  }

  return true;
}

/**
 * Filter an array of model or combo objects by a search query.
 * @param {Array} items
 * @param {string|ReturnType<typeof parseSearchQuery>} query
 * @returns {Array}
 */
export function filterModelsByQuery(items, query) {
  if (!Array.isArray(items) || items.length === 0) return [];
  const parsed = typeof query === "string" || !query ? parseSearchQuery(query) : query;
  if (parsed.isEmpty) return items;
  return items.filter((item) => matchesSearch(item, parsed));
}
