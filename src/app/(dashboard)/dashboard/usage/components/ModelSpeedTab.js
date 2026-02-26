"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import Card from "@/shared/components/Card";
import Badge from "@/shared/components/Badge";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function timeAgo(ts) {
  if (!ts) return "—";
  const diff = Math.floor((Date.now() - new Date(ts)) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function fmtSpeed(v) {
  if (v == null || v === 0) return "—";
  return `${v.toFixed(1)} tok/s`;
}

// ─── Sub-components (module scope, not inside render) ────────────────────────

function SpeedBar({ speed, maxSpeed }) {
  const ratio = maxSpeed > 0 ? Math.min(speed / maxSpeed, 1) : 0;
  let colorClass = "bg-error";
  if (ratio >= 0.75) colorClass = "bg-success";
  else if (ratio >= 0.4) colorClass = "bg-warning";

  return (
    <div className="flex items-center gap-2 min-w-[100px]">
      <div className="flex-1 h-1.5 rounded-full bg-black/10 dark:bg-white/10 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${colorClass}`}
          style={{ width: `${ratio * 100}%` }}
        />
      </div>
    </div>
  );
}

function SortIcon({ field, sortField, sortOrder }) {
  if (sortField !== field) {
    return (
      <span className="material-symbols-outlined text-[14px] opacity-30">
        unfold_more
      </span>
    );
  }
  return (
    <span className="material-symbols-outlined text-[14px] text-primary">
      {sortOrder === "asc" ? "arrow_upward" : "arrow_downward"}
    </span>
  );
}

// ─── Constants ────────────────────────────────────────────────────────────────

const TH_CLS =
  "px-4 py-3 text-left text-xs font-semibold text-text-muted uppercase tracking-wide select-none";
const TH_BTN_CLS =
  "flex items-center gap-1 hover:text-text transition-colors cursor-pointer";

// ─── Main component ───────────────────────────────────────────────────────────

export default function ModelSpeedTab() {
  const [models, setModels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [sortField, setSortField] = useState("avgSpeed");
  const [sortOrder, setSortOrder] = useState("desc");
  const [error, setError] = useState(null);
  const hasFetched = useRef(false);

  useEffect(() => {
    if (hasFetched.current) return;
    hasFetched.current = true;

    let cancelled = false;
    fetch("/api/usage/model-speed")
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((data) => {
        if (!cancelled) {
          setModels(data.models || []);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          console.error("[ModelSpeedTab] fetch error:", err);
          setError("Failed to load model speed data.");
          setLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, []);

  const maxSpeed = useMemo(
    () => Math.max(...models.map((m) => m.avgSpeed), 0),
    [models]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = q
      ? models.filter(
          (m) =>
            m.model.toLowerCase().includes(q) ||
            (m.provider || "").toLowerCase().includes(q)
        )
      : [...models];

    list.sort((a, b) => {
      let vA = a[sortField];
      let vB = b[sortField];
      if (typeof vA === "string") vA = vA.toLowerCase();
      if (typeof vB === "string") vB = vB.toLowerCase();
      if (vA < vB) return sortOrder === "asc" ? -1 : 1;
      if (vA > vB) return sortOrder === "asc" ? 1 : -1;
      return 0;
    });
    return list;
  }, [models, search, sortField, sortOrder]);

  function handleSort(field) {
    if (sortField === field) {
      setSortOrder((o) => (o === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortOrder("desc");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Search bar */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-text-muted pointer-events-none">
            search
          </span>
          <input
            id="model-speed-search"
            type="text"
            placeholder="Search model or provider…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-border bg-bg-subtle text-sm text-text placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text transition-colors"
            >
              <span className="material-symbols-outlined text-[16px]">close</span>
            </button>
          )}
        </div>

        <span className="text-xs text-text-muted">
          {loading
            ? "Loading…"
            : `${filtered.length} model${filtered.length !== 1 ? "s" : ""}`}
        </span>
      </div>

      {/* Table */}
      <Card padding="none">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-black/5 dark:border-white/5">
                <th className={TH_CLS}>
                  <button
                    type="button"
                    onClick={() => handleSort("model")}
                    className={TH_BTN_CLS}
                  >
                    Model{" "}
                    <SortIcon
                      field="model"
                      sortField={sortField}
                      sortOrder={sortOrder}
                    />
                  </button>
                </th>
                <th className={TH_CLS}>Provider</th>
                <th className={`${TH_CLS} text-right`}>
                  <button
                    type="button"
                    onClick={() => handleSort("avgSpeed")}
                    className={`${TH_BTN_CLS} justify-end`}
                  >
                    Avg Speed{" "}
                    <SortIcon
                      field="avgSpeed"
                      sortField={sortField}
                      sortOrder={sortOrder}
                    />
                  </button>
                </th>
                <th className={`${TH_CLS} hidden sm:table-cell`}>Speed Bar</th>
                <th className={`${TH_CLS} text-right hidden md:table-cell`}>
                  <button
                    type="button"
                    onClick={() => handleSort("minSpeed")}
                    className={`${TH_BTN_CLS} justify-end`}
                  >
                    Min{" "}
                    <SortIcon
                      field="minSpeed"
                      sortField={sortField}
                      sortOrder={sortOrder}
                    />
                  </button>
                </th>
                <th className={`${TH_CLS} text-right hidden md:table-cell`}>
                  <button
                    type="button"
                    onClick={() => handleSort("maxSpeed")}
                    className={`${TH_BTN_CLS} justify-end`}
                  >
                    Max{" "}
                    <SortIcon
                      field="maxSpeed"
                      sortField={sortField}
                      sortOrder={sortOrder}
                    />
                  </button>
                </th>
                <th className={`${TH_CLS} text-right hidden sm:table-cell`}>
                  <button
                    type="button"
                    onClick={() => handleSort("sampleCount")}
                    className={`${TH_BTN_CLS} justify-end`}
                  >
                    Samples{" "}
                    <SortIcon
                      field="sampleCount"
                      sortField={sortField}
                      sortOrder={sortOrder}
                    />
                  </button>
                </th>
                <th className={`${TH_CLS} text-right`}>
                  <button
                    type="button"
                    onClick={() => handleSort("lastUsed")}
                    className={`${TH_BTN_CLS} justify-end`}
                  >
                    Last Used{" "}
                    <SortIcon
                      field="lastUsed"
                      sortField={sortField}
                      sortOrder={sortOrder}
                    />
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} className="p-10 text-center text-text-muted">
                    <div className="flex items-center justify-center gap-2">
                      <span className="material-symbols-outlined animate-spin text-[20px]">
                        progress_activity
                      </span>
                      Loading speed data…
                    </div>
                  </td>
                </tr>
              ) : error ? (
                <tr>
                  <td colSpan={8} className="p-10 text-center text-error">
                    {error}
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-10 text-center text-text-muted">
                    {search
                      ? `No models matching "${search}"`
                      : "No speed data recorded yet. Run some requests first."}
                  </td>
                </tr>
              ) : (
                filtered.map((m, i) => (
                  <tr
                    key={`${m.provider}/${m.model}`}
                    className="border-b border-black/5 dark:border-white/5 last:border-b-0 hover:bg-black/2 dark:hover:bg-white/2 transition-colors"
                  >
                    {/* Rank + model */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-text-muted w-5 text-right shrink-0">
                          {i + 1}
                        </span>
                        <span
                          className="text-sm font-mono text-text-main truncate max-w-[220px]"
                          title={m.model}
                        >
                          {m.model}
                        </span>
                      </div>
                    </td>

                    {/* Provider */}
                    <td className="px-4 py-3">
                      {m.provider ? (
                        <Badge variant="neutral" size="sm">
                          {m.provider}
                        </Badge>
                      ) : (
                        <span className="text-text-muted text-xs">—</span>
                      )}
                    </td>

                    {/* Avg speed */}
                    <td className="px-4 py-3 text-right">
                      <span
                        className={`text-sm font-mono font-semibold ${
                          m.avgSpeed > 0 ? "text-text-main" : "text-text-muted"
                        }`}
                      >
                        {fmtSpeed(m.avgSpeed)}
                      </span>
                    </td>

                    {/* Speed bar */}
                    <td className="px-4 py-3 hidden sm:table-cell w-[120px]">
                      <SpeedBar speed={m.avgSpeed} maxSpeed={maxSpeed} />
                    </td>

                    {/* Min */}
                    <td className="px-4 py-3 text-right text-sm font-mono text-text-muted hidden md:table-cell">
                      {fmtSpeed(m.minSpeed)}
                    </td>

                    {/* Max */}
                    <td className="px-4 py-3 text-right text-sm font-mono text-text-muted hidden md:table-cell">
                      {fmtSpeed(m.maxSpeed)}
                    </td>

                    {/* Samples */}
                    <td className="px-4 py-3 text-right text-sm text-text-muted hidden sm:table-cell">
                      {m.sampleCount.toLocaleString()}
                    </td>

                    {/* Last used */}
                    <td className="px-4 py-3 text-right text-xs text-text-muted whitespace-nowrap">
                      {timeAgo(m.lastUsed)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Legend */}
      {!loading && filtered.length > 0 && (
        <div className="flex items-center gap-4 text-xs text-text-muted px-1">
          <span className="font-medium">Speed:</span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-1.5 rounded-full bg-success" />
            Fast (&gt;75% of max)
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-1.5 rounded-full bg-warning" />
            Medium
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-1.5 rounded-full bg-error" />
            Slow
          </span>
        </div>
      )}
    </div>
  );
}
