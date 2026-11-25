"use client";

import { useEffect, useId, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { getCurrentLocale, onLocaleChange, translate } from "@/i18n/runtime";
import { parseUsageRange } from "@/lib/usage/range.js";

import { Badge, Button, Card, Input, SegmentedControl, Select } from "@/shared/components";
import { REQUEST_COLOR } from "./UsageChart";

const PERIODS = [
  { value: "1h", label: "1h" },
  { value: "24h", label: "24h" },
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
  { value: "90d", label: "90d" },
  { value: "custom", label: "Custom range" },
  { value: "all", label: "All time" },
];

const dimensions = { provider: "Provider", model: "Model", apiKey: "API key", connection: "Connection" };
const metrics = { requests: "Requests", failed: "Failed", tokens: "Tokens", cost: "Estimated cost" };
const totals = {
  requests: "Requests",
  success: "Successful",
  failed: "Failed",
  inputTokens: "Input tokens",
  outputTokens: "Output tokens",
  cachedTokens: "Cached tokens",
  reasoningTokens: "Reasoning tokens",
  usageUnreported: "Usage not reported",
  estimatedCost: "Estimated cost",
};
const totalColors = {
  inputTokens: "text-primary",
  outputTokens: "text-success",
  cachedTokens: "text-info",
  estimatedCost: "text-warning",
  failed: "text-danger",
};
const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const fmt = (n, locale) => (n == null ? "—" : n.toLocaleString(locale, { maximumFractionDigits: 2 }));
const money = (v, locale) =>
  v.toLocaleString(locale, { style: "currency", currency: "USD", maximumFractionDigits: 6 });

function RangeControls({ query, setQuery }) {
  const [period, setPeriod] = useState("7d");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const id = useId();
  let custom = "";
  if (from && to) {
    const params = new URLSearchParams({ from: from + "Z", to: to + "Z" });
    try {
      parseUsageRange(params);
      custom = params.toString();
    } catch {
      /* Show inline validation. */
    }
  }
  function change(value) {
    setPeriod(value);
    setQuery(value === "custom" ? custom : "period=" + value);
  }
  return (
    <div className="flex min-w-0 max-w-full flex-wrap items-end gap-3">
      <fieldset className="min-w-0 max-w-full">
        <legend className="mb-1.5 text-sm font-medium">
          <span>Period</span>
          <span className="sr-only">: {PERIODS.find((option) => option.value === period).label}</span>
        </legend>
        <SegmentedControl
          size="sm"
          className="max-w-full"
          options={PERIODS}
          value={period}
          onChange={change}
        />
      </fieldset>
      {period === "custom" && (
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (custom) setQuery(custom);
          }}
        >
          {[
            [from, setFrom, "From (UTC)", "from"],
            [to, setTo, "To (UTC, exclusive)", "to"],
          ].map(([value, set, label, key]) => (
            <Input
              key={key}
              id={id + key}
              label={label}
              type="datetime-local"
              required
              value={value}
              onChange={(e) => {
                set(e.target.value);
                setQuery("");
              }}
            />
          ))}
          <Button type="submit" disabled={!custom || custom === query}>
            Apply
          </Button>
          {from && to && !custom && <span role="alert">End must follow start, within two years.</span>}
        </form>
      )}
    </div>
  );
}

function Breakdown({ title, rows, locale }) {
  const id = useId();
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState({ key: "requests", ascending: false });
  const cols = {
    name: title,
    requests: "Requests",
    tokens: "Tokens",
    cost: "Estimated cost",
    errorRate: "Error rate",
  };
  const label = (row) => row.name ?? (row.id || translate("Unknown"));
  const visible = rows
    .filter((r) =>
      [label(r), r.id, r.project].some((v) =>
        v?.toLocaleLowerCase(locale).includes(filter.toLocaleLowerCase(locale)),
      ),
    )
    .sort(
      (a, b) =>
        (sort.key === "name" ? label(a).localeCompare(label(b), locale) : a[sort.key] - b[sort.key]) *
        (sort.ascending ? 1 : -1),
    );
  return (
    <Card className="min-w-0" title={<span id={id}>{title}</span>}>
      <Input
        id={id + "search"}
        label="Search"
        type="search"
        className="mb-3"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      <div className="overflow-x-auto" role="region" aria-labelledby={id} tabIndex={0}>
        <table className="w-full min-w-max text-left text-sm tabular-nums">
          <caption className="sr-only">{title}</caption>
          <thead className="border-b border-border bg-bg text-text-muted">
            <tr>
              {Object.entries(cols).map(([key, text]) => (
                <th
                  scope="col"
                  key={key}
                  className="pr-3"
                  aria-sort={
                    sort.key === key ? (sort.ascending ? "ascending" : "descending") : undefined
                  }
                >
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="px-1"
                    onClick={() =>
                      setSort({ key, ascending: sort.key === key ? !sort.ascending : key === "name" })
                    }
                  >
                    <span>{text}</span>
                    {sort.key === key && <span aria-hidden="true">{sort.ascending ? " ↑" : " ↓"}</span>}
                  </Button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {visible.map((r, i) => (
              <tr key={r.id || i} className="transition-colors hover:bg-surface-2/50">
                <th scope="row" className="py-2 pr-3 font-normal">
                  <span data-i18n-skip>{label(r)}</span>
                  {r.project && (
                    <div>
                      <Badge variant="primary" size="sm">
                        <span data-i18n-skip>{r.project}</span>
                      </Badge>
                    </div>
                  )}
                  {r.id && (
                    <small className="block text-text-muted" data-i18n-skip>
                      {r.id}
                    </small>
                  )}
                </th>
                {[
                  fmt(r.requests, locale),
                  fmt(r.tokens, locale),
                  money(r.cost, locale),
                  fmt(r.errorRate * 100, locale) + "%",
                ].map((v, j) => (
                  <td key={j} className="pr-3">
                    {v}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {!visible.length && <p className="py-2 text-text-muted">No matching rows</p>}
      </div>
    </Card>
  );
}

function Activity({ data, locale }) {
  const [metric, setMetric] = useState("requests");
  const id = useId();
  const dateFormat = new Intl.DateTimeFormat(locale, {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    ...(data.range.bucketSeconds < 86400 && { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }),
  });
  // A numeric UTC axis preserves gaps between occupied buckets.
  const series = data.timeSeries
    .map((row) => ({ ...row, time: Date.parse(row.timestamp) }))
    .filter((row) => Number.isFinite(row.time));
  const counts = new Map(data.heatmap.map((r) => [r.day * 24 + r.hour, r.requests]));
  const max = Math.max(1, ...counts.values());
  return (
    <>
      <Card
        className="min-w-0"
        title="Activity over time (UTC)"
        action={
          <Select
            value={metric}
            aria-label={translate("Chart metric")}
            placeholder=""
            selectClassName="h-9 py-1! [&>option:first-child]:hidden"
            onChange={(e) => setMetric(e.target.value)}
            options={Object.entries(metrics).map(([value, label]) => ({ value, label }))}
          />
        }
      >
        {series.length ? (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={series}>
              <CartesianGrid vertical={false} strokeOpacity={0.18} />
              <XAxis
                dataKey="time"
                type="number"
                scale="utc"
                domain={["dataMin", "dataMax"]}
                tickFormatter={(v) => dateFormat.format(new Date(v))}
                minTickGap={24}
              />
              <YAxis width={60} />
              <Tooltip
                contentStyle={{
                  backgroundColor: "var(--color-bg)",
                  border: "1px solid var(--color-border)",
                  borderRadius: "8px",
                  fontSize: "12px",
                }}
                labelFormatter={(v) => dateFormat.format(new Date(v))}
              />
              <Bar
                dataKey={metric}
                name={translate(metrics[metric])}
                fill={REQUEST_COLOR}
                isAnimationActive={false}
              />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <p>No data for this period</p>
        )}
      </Card>
      <Card className="min-w-0" title={<span id={id}>Hourly activity (UTC)</span>}>
        <div role="region" aria-labelledby={id} tabIndex={0} className="overflow-x-auto">
          <table className="w-full min-w-max border-separate text-center text-xs tabular-nums">
            <caption className="sr-only">Requests by weekday and hour</caption>
            <thead>
              <tr>
                <th scope="col">Day</th>
                {Array.from({ length: 24 }, (_, h) => (
                  <th key={h} scope="col">
                    {String(h).padStart(2, "0")}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {days.map((day, d) => (
                <tr key={day}>
                  <th className="pr-2 text-left" scope="row">
                    {day}
                  </th>
                  {Array.from({ length: 24 }, (_, h) => {
                    const n = counts.get(d * 24 + h) || 0;
                    return (
                      <td
                        key={h}
                        className="min-w-6 rounded p-1"
                        style={{
                          backgroundColor: n
                            ? `color-mix(in srgb, var(--color-primary) ${10 + (50 * n) / max}%, transparent)`
                            : undefined,
                        }}
                      >
                        {n}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}

export default function Analytics() {
  const projectInput = useId();
  const [rangeQuery, setQuery] = useState("period=7d");
  const [project, setProject] = useState("");
  const query = rangeQuery && rangeQuery + (project ? "&" + new URLSearchParams({ project }) : "");
  const [result, setResult] = useState(null);
  const [locale, setLocale] = useState(getCurrentLocale);
  useEffect(() => onLocaleChange(() => setLocale(getCurrentLocale())), []);
  useEffect(() => {
    if (!query) return;
    const controller = new AbortController();
    fetch("/api/usage/analytics?" + query, { signal: controller.signal, cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error();
        return res.json();
      })
      .then((data) => {
        if (!controller.signal.aborted) setResult({ query, data });
      })
      .catch(() => {
        if (!controller.signal.aborted) setResult({ query, error: true });
      });
    return () => controller.abort();
  }, [query]);
  const current = query && result?.query === query ? result : null;
  const data = current?.data;
  const download =
    data &&
    new URLSearchParams(
      data.range.from ? { from: data.range.from, to: data.range.to } : { period: "all" },
    );
  if (download && project) download.set("project", project);
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <Card className="flex min-w-0 flex-wrap items-end justify-between gap-4">
        <RangeControls query={rangeQuery} setQuery={setQuery} />
        <search className="min-w-0 max-w-full">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setProject(new FormData(e.currentTarget).get("project").trim());
            }}
            className="flex flex-wrap items-end gap-2"
          >
            <Input
              id={projectInput}
              label="Project"
              name="project"
              maxLength={120}
              placeholder="All projects"
              type="search"
            />
            <Button type="submit">Apply</Button>
          </form>
        </search>
        {data &&
          (data.totals.requests > 1000000 ? (
            <p>Export limit: one million rows. Select a shorter range.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {["csv", "json"].map((f) => (
                <a
                  download
                  key={f}
                  className="inline-flex h-9 items-center justify-center rounded-[10px] border border-border px-4 text-sm font-semibold text-text-main transition-colors hover:border-brand-500/40 hover:bg-surface-2"
                  href={`/api/usage/export?format=${f}&${download}`}
                >
                  {f === "csv" ? "Download CSV" : "Download JSON"}
                </a>
              ))}
            </div>
          ))}
      </Card>
      {query && !current && <p role="status">Loading analytics…</p>}
      {current?.error && <p role="alert">Could not load analytics.</p>}
      {data && (
        <>
          <p className="text-sm text-text-muted">
            Costs are estimates at the recorded tariff, not invoices.
          </p>
          <dl className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 md:grid-cols-3 lg:grid-cols-5">
            {Object.entries(totals).map(([key, label]) => {
              const value =
                key === "estimatedCost"
                  ? money(data.totals[key], locale)
                  : fmt(data.totals[key], locale);
              return (
                <Card
                  key={key}
                  className="flex min-w-0 flex-col items-center gap-1 px-3 py-3 text-center sm:px-4"
                >
                  <dt className="text-xs font-semibold uppercase text-text-muted sm:text-sm">{label}</dt>
                  <dd
                    className={`w-full truncate text-lg font-bold tabular-nums xl:text-xl ${totalColors[key] || ""}`}
                    title={value}
                  >
                    {value}
                  </dd>
                </Card>
              );
            })}
          </dl>
          <Card title="Measured latency (ms)">
            <dl className="mt-2 grid grid-cols-4 gap-2">
              {Object.entries(data.latencyMs).map(([k, v]) => (
                <div key={k}>
                  <dt>{k === "avg" ? "Average" : k}</dt>
                  <dd className="font-semibold">{fmt(v, locale)}</dd>
                </div>
              ))}
            </dl>
          </Card>
          <Activity data={data} locale={locale} />
          <h3 className="font-semibold">Top 20 by requests</h3>
          <div className="grid gap-4 xl:grid-cols-2">
            {Object.entries(dimensions).map(([k, v]) => (
              <Breakdown key={k} title={v} rows={data.breakdowns[k]} locale={locale} />
            ))}
          </div>
          <Card title="Connections with most errors">
            {data.errorConnections.length ? (
              <ol className="divide-y divide-border/50">
                {data.errorConnections.map((r, i) => (
                  <li key={i} className="py-2 text-sm">
                    <b>{r.name ?? translate("Unknown")}</b> · {fmt(r.failed, locale)}
                    <small className="block">
                      {Object.entries(r.categories)
                        .map(([k, v]) => k + ": " + v)
                        .join(" · ")}
                    </small>
                  </li>
                ))}
              </ol>
            ) : (
              <p>No data for this period</p>
            )}
          </Card>
          <Card title="Recorded tariffs">
            {data.tariffs.length ? (
              <ul className="divide-y divide-border/50">
                {data.tariffs.map((r, i) => (
                  <li key={i} className="py-2 text-sm">
                    <Badge size="sm">{r.source === "user" ? "User rate" : "Default rate"}</Badge>
                    {" · "}
                    {r.updatedAt || r.version}
                  </li>
                ))}
              </ul>
            ) : (
              <p>No tariff recorded</p>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
