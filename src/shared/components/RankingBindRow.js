"use client";

import { useState, useEffect, useRef } from "react";
import PropTypes from "prop-types";

const SEARCH_SENTINEL = "__search__";

/**
 * One unmatched/auto-bound model and the leaderboard entry it maps to.
 *
 * The shortlist the matcher produces is similarity-based and sometimes simply
 * does not contain the right model — the leaderboard may list it under a name
 * that shares no tokens with the provider's id. So the dropdown ends with a
 * search escape hatch that queries the whole catalog, rather than trapping the
 * user inside a wrong five-item list.
 */
export default function RankingBindRow({ modelStr, value, suggestions, isAuto, disabled, onBind }) {
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef(null);
  const listId = `aa-catalog-${modelStr.replace(/[^a-zA-Z0-9]/g, "-")}`;

  useEffect(() => {
    if (searching) inputRef.current?.focus();
  }, [searching]);

  // Debounced catalog search — typing a model name fires a request per keystroke
  // otherwise, and the catalog query scans every entry.
  useEffect(() => {
    if (!searching) return;
    const term = query.trim();
    if (term.length < 2) {
      setResults([]);
      return;
    }
    let alive = true;
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/aa/rankings?models=1&q=${encodeURIComponent(term)}`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = await res.json();
        if (alive) setResults(data.models || []);
      } catch {
        // Search is an escape hatch; a failed lookup just shows no options.
      } finally {
        if (alive) setLoading(false);
      }
    }, 250);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [query, searching]);

  const handleSelectChange = (next) => {
    if (next === SEARCH_SENTINEL) {
      setSearching(true);
      return;
    }
    onBind(modelStr, next);
  };

  /** Accept a typed value only if it names a real catalog entry. */
  const commitSearch = () => {
    const term = query.trim();
    if (!term) return;
    const exact =
      results.find((m) => m.slug === term) ||
      results.find((m) => m.name === term) ||
      (results.length === 1 ? results[0] : null);
    if (exact) {
      onBind(modelStr, exact.slug);
      setSearching(false);
      setQuery("");
    }
  };

  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] text-text-muted truncate max-w-[40%]" title={modelStr}>
        {modelStr}
      </span>
      {isAuto && !searching && (
        <span
          className="text-[9px] text-amber-500 border border-amber-500/40 rounded px-1 shrink-0"
          title="Closest match picked automatically — review it, or pick another below"
        >
          auto
        </span>
      )}

      {searching ? (
        <div className="flex-1 min-w-0 flex items-center gap-1">
          <input
            ref={inputRef}
            type="text"
            list={listId}
            value={query}
            disabled={disabled}
            placeholder="Search the leaderboard…"
            onChange={(e) => setQuery(e.target.value)}
            onBlur={commitSearch}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitSearch();
              } else if (e.key === "Escape") {
                setSearching(false);
                setQuery("");
              }
            }}
            className="flex-1 min-w-0 bg-surface border border-border rounded px-1 py-0.5 text-[10px] focus:outline-none focus:ring-1 focus:ring-primary/50 disabled:opacity-50"
          />
          <datalist id={listId}>
            {results.map((m) => (
              <option key={m.slug} value={m.slug}>
                {m.name}
                {m.creator ? ` — ${m.creator}` : ""}
              </option>
            ))}
          </datalist>
          {loading && <span className="text-[9px] text-text-muted shrink-0">…</span>}
          <button
            type="button"
            onClick={() => {
              setSearching(false);
              setQuery("");
            }}
            className="text-[9px] text-text-muted hover:text-primary shrink-0 hover:cursor-pointer"
          >
            cancel
          </button>
        </div>
      ) : (
        <select
          value={value || ""}
          onChange={(e) => handleSelectChange(e.target.value)}
          disabled={disabled}
          className="flex-1 min-w-0 bg-surface border border-border rounded px-1 py-0.5 text-[10px] focus:outline-none focus:ring-1 focus:ring-primary/50 disabled:opacity-50"
        >
          <option value="">— leave unranked —</option>
          {suggestions.map((candidate) => (
            <option key={candidate.slug} value={candidate.slug}>
              {candidate.name} ({Math.round(candidate.score * 100)}% similar)
            </option>
          ))}
          {/* A bound value from search won't be in the shortlist — keep it selectable. */}
          {value && !suggestions.some((c) => c.slug === value) && (
            <option value={value}>{value} (chosen)</option>
          )}
          <option value={SEARCH_SENTINEL}>🔍 Search all models…</option>
        </select>
      )}
    </div>
  );
}

RankingBindRow.propTypes = {
  modelStr: PropTypes.string.isRequired,
  value: PropTypes.string,
  suggestions: PropTypes.array,
  isAuto: PropTypes.bool,
  disabled: PropTypes.bool,
  onBind: PropTypes.func.isRequired,
};

RankingBindRow.defaultProps = {
  suggestions: [],
};
