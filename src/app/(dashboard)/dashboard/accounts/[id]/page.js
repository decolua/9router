"use client";

import { useState, useEffect, use } from "react";
import Link from "next/link";
import Card from "@/shared/components/Card";
import Badge from "@/shared/components/Badge";
import ProviderIcon from "@/shared/components/ProviderIcon";
import { CardSkeleton } from "@/shared/components/Loading";
import { useBlurEmails } from "@/shared/hooks/useBlurEmails";
import { parseQuotaData, calculatePercentage } from "../../usage/components/ProviderLimits/utils";
import QuotaProgressBar from "../../usage/components/ProviderLimits/QuotaProgressBar";
import AccountActions from "./AccountActions";
import ActivityChart from "./ActivityChart";
import ValueChart from "./ValueChart";
import {
  fmtMoney, fmtCount, fmtRelative, fmtMonthLabel, fmtTimeOfDay, looksLikeEmail,
} from "./formatters";

function Tile({ label, value, foot }) {
  return (
    <Card padding="none" className="px-4 py-3.5">
      <p className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-text-subtle">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums tracking-tight">{value}</p>
      {foot && <p className="mt-0.5 text-[11.5px] text-text-muted">{foot}</p>}
    </Card>
  );
}

function Row({ label, children }) {
  return (
    <div className="flex items-center justify-between gap-4 border-t border-border-subtle py-2.5 text-[13px] first:border-t-0 first:pt-0">
      <span className="text-text-muted">{label}</span>
      <span className="text-right font-medium tabular-nums">{children}</span>
    </div>
  );
}

function SectionHeading({ title, subtitle, action }) {
  return (
    <div className="mb-3.5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <div>
        <h2 className="text-[13.5px] font-semibold tracking-tight">{title}</h2>
        {subtitle && <p className="mt-0.5 text-[12.5px] text-text-muted">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export default function AccountDetailPage({ params }) {
  const { id } = use(params);
  const { blurClass } = useBlurEmails();

  const [data, setData] = useState(null);
  const [quota, setQuota] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  // Bumped by the action panel so an edit/toggle re-reads the page's data.
  const reload = () => setRefreshKey((k) => k + 1);

  useEffect(() => {
    let cancelled = false;

    fetch(`/api/usage/connection-detail/${id}`, { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `Request failed (${res.status})`);
        }
        return res.json();
      })
      .then((json) => { if (!cancelled) setData(json); })
      .catch((e) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [id, refreshKey]);

  // Live quota is a separate, slower call — the page renders without it.
  // The raw payload is provider-shaped, so it goes through the same parser the
  // quota cards use rather than being read field-by-field here.
  useEffect(() => {
    if (!data?.connection?.provider) return undefined;
    let cancelled = false;
    fetch(`/api/usage/${id}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((raw) => {
        if (cancelled || !raw) return;
        setQuota({
          quotas: parseQuotaData(data.connection.provider, raw),
          message: raw.message || null,
          raw,
        });
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [id, data?.connection?.provider]);

  if (loading) return <CardSkeleton />;

  if (error || !data) {
    return (
      <div className="flex flex-col gap-4">
        <Link href="/dashboard/quota" className="text-[12.5px] text-text-muted hover:text-primary">
          ← All accounts
        </Link>
        <Card padding="md">
          <p className="text-sm text-red-600 dark:text-red-400">{error || "Account not found."}</p>
        </Card>
      </div>
    );
  }

  const { connection: conn, tokenStatus, usage, value } = data;
  const title = conn.name?.trim() || conn.email?.trim() || conn.provider;
  const titleIsEmail = looksLikeEmail(title);
  const totals = usage?.totals || {};
  const quotas = quota?.quotas || [];

  const multiple = value.lifetimePaid > 0 ? value.lifetimeCost / value.lifetimePaid : null;
  const maxModel = Math.max(...(usage?.byModel || []).map((m) => m.cost), 0.0001);

  const rawCredits = quota?.raw?.resetCredits?.availableCount;
  const creditCount = Number.isFinite(Number(rawCredits)) ? Math.max(0, Number(rawCredits)) : 0;

  return (
    <div className="flex min-w-0 flex-col gap-4 px-1 sm:px-0">
      <Link href="/dashboard/quota" className="w-fit text-[12.5px] text-text-muted transition-colors hover:text-primary">
        ← All accounts
      </Link>

      {/* Identity */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-xl">
          <ProviderIcon
            src={`/providers/${conn.provider}.png`}
            alt={conn.provider}
            size={44}
            className="object-contain"
            fallbackText={conn.provider?.slice(0, 2).toUpperCase() || "PR"}
          />
        </div>
        <div className="min-w-0">
          {/* The heading is often the email itself, so it has to honour the
              blur toggle too — and must not be title-cased like a provider. */}
          <h1 className={`text-lg font-semibold tracking-tight ${titleIsEmail ? blurClass : "capitalize"}`}>
            {title}
          </h1>
          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-text-subtle">
            <span className="capitalize">{conn.provider}</span>
            {conn.email && !titleIsEmail && (
              <>
                <span>·</span>
                <span className={`truncate ${blurClass}`}>{conn.email}</span>
              </>
            )}
            {conn.plan && <Badge variant="neutral" size="xs">{conn.plan}</Badge>}
            <Badge variant={conn.isActive ? "success" : "neutral"} size="xs">
              {conn.isActive ? "Active" : "Disabled"}
            </Badge>
          </div>
        </div>
      </div>

      {/* Headline numbers */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Tile label="Requests" value={fmtCount(totals.requests || 0)} foot={`${usage?.requests7d || 0} in last 7d`} />
        <Tile
          label="Tokens"
          value={fmtCount((totals.promptTokens || 0) + (totals.completionTokens || 0))}
          foot={`${fmtCount(totals.cachedTokens || 0)} from cache`}
        />
        <Tile
          label="Quota left"
          value={quotas.length ? `${calculatePercentage(quotas[0].used, quotas[0].total)}%` : "—"}
          foot={quotas.length ? quotas[0].name : "No quota data"}
        />
        <Tile
          label="Errors (7d)"
          value={usage?.errors7d ?? 0}
          foot={usage?.requests7d ? `${(((usage.errors7d || 0) / usage.requests7d) * 100).toFixed(1)}% of requests` : "—"}
        />
        <Tile
          label="API value"
          value={fmtMoney(value.lifetimeCost)}
          foot={multiple ? `${multiple >= 10 ? Math.round(multiple) : multiple.toFixed(1)}× what you paid` : "at list prices"}
        />
      </div>

      {/* Activity */}
      <Card padding="none" className="px-4 py-4 sm:px-5">
        <SectionHeading
          title="Activity"
          subtitle={`Requests per day, last ${usage?.daily?.length || 14} days.`}
          action={<Badge variant="neutral" size="sm">{fmtCount(totals.requests || 0)} total</Badge>}
        />
        <ActivityChart daily={usage?.daily || []} />
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.45fr_1fr]">
        {/* Quota */}
        <Card padding="none" className="px-4 py-4 sm:px-5">
          <SectionHeading title="Usage & quota" subtitle="What's left on the plan right now." />
          {quotas.length > 0 ? (
            <div className="flex flex-col gap-4">
              {/* Reused rather than restyled, so the colour thresholds and
                  reset countdown match the quota cards exactly. */}
              {quotas.map((q, i) => (
                <QuotaProgressBar
                  key={`${q.name}-${i}`}
                  label={q.name}
                  used={q.used}
                  total={q.total}
                  percentage={calculatePercentage(q.used, q.total)}
                  unlimited={q.total === 0 || q.total === null}
                  resetTime={q.resetAt}
                  recurring={q.recurring !== false}
                />
              ))}
            </div>
          ) : (
            <p className="py-2 text-sm text-text-muted">No quota data for this provider.</p>
          )}

          <div className="mt-4 flex flex-col">
            <Row label="Total value at list prices">{fmtMoney(totals.cost || 0)}</Row>
            <Row label="First seen">{totals.firstDateKey || "—"}</Row>
            <Row label="Last request">
              {usage?.recent?.[0] ? fmtRelative(usage.recent[0].timestamp) : "—"}
            </Row>
          </div>
        </Card>

        {/* Token status */}
        <Card padding="none" className="px-4 py-4 sm:px-5">
          <SectionHeading title="Token status" subtitle="Credentials for this connection." />
          <div className="flex flex-col">
            <Row label="Access token">
              {tokenStatus.hasAccessToken ? (
                <span className={tokenStatus.expiresAt && new Date(tokenStatus.expiresAt) < new Date()
                  ? "text-amber-600 dark:text-amber-400" : "text-green-600 dark:text-green-400"}>
                  {tokenStatus.expiresAt
                    ? (new Date(tokenStatus.expiresAt) < new Date() ? "Expired" : `Valid · ${fmtRelative(tokenStatus.expiresAt)}`)
                    : "Stored"}
                </span>
              ) : "Missing"}
            </Row>
            <Row label="Refresh token">{tokenStatus.hasRefreshToken ? "Stored" : "None"}</Row>
            <Row label="ID token">{tokenStatus.hasIdToken ? "Parsed" : "None"}</Row>
            <Row label="Last refreshed">{fmtRelative(tokenStatus.lastRefreshAt)}</Row>
            <Row label="Auth type">{conn.authType || "—"}</Row>
            <Row label="Priority">{conn.priority ?? "—"}</Row>
          </div>

          <div className="mt-4 border-t border-border-subtle pt-4">
            <SectionHeading title="Manage" subtitle="Actions that used to sit on the quota card." />
            <AccountActions
              connection={conn}
              resetCredits={{ available: creditCount }}
              onChanged={reload}
            />
          </div>
        </Card>
      </div>

      {/* Subscription value */}
      {conn.authType === "oauth" && (
        <Card padding="none" className="px-4 py-4 sm:px-5">
          <SectionHeading
            title="Subscription value"
            subtitle="What this sub delivered, priced at pay-as-you-go API rates."
            action={<Badge variant="primary" size="sm">Lifetime</Badge>}
          />

          <div className="mb-4 flex flex-wrap items-end gap-x-9 gap-y-4 border-b border-border-subtle pb-4">
            {multiple != null ? (
              <div className="flex items-baseline gap-2.5">
                <span className="text-3xl font-semibold leading-none tracking-tight tabular-nums text-primary">
                  {multiple >= 10 ? Math.round(multiple) : multiple.toFixed(1)}×
                </span>
                <span className="max-w-[22ch] text-[12.5px] text-text-muted">return on what you&apos;ve paid</span>
              </div>
            ) : (
              <div className="flex items-baseline gap-2.5">
                <span className="text-3xl font-semibold leading-none tracking-tight tabular-nums text-primary">
                  {fmtMoney(value.lifetimeCost)}
                </span>
                <span className="max-w-[24ch] text-[12.5px] text-text-muted">
                  {value.monthlyCost === 0
                    ? "delivered, and this sub is free"
                    : "delivered — set a monthly price to see the return"}
                </span>
              </div>
            )}

            <div className="flex flex-col gap-px">
              <span className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-text-subtle">API value</span>
              <span className="text-[17px] font-semibold tabular-nums tracking-tight">{fmtMoney(value.lifetimeCost)}</span>
              <span className="text-[11.5px] text-text-muted">at list prices</span>
            </div>

            <div className="flex flex-col gap-px">
              <span className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-text-subtle">Paid</span>
              <span className="text-[17px] font-semibold tabular-nums tracking-tight">
                {value.lifetimePaid == null ? "—" : fmtMoney(value.lifetimePaid)}
              </span>
              <span className="text-[11.5px] text-text-muted">
                {value.monthlyCost == null
                  ? "no price set"
                  : `${fmtMoney(value.monthlyCost)}/mo × ${value.months} month${value.months === 1 ? "" : "s"}`}
              </span>
            </div>

            {value.breakEvenDay && (
              <div className="flex flex-col gap-px">
                <span className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-text-subtle">Break-even</span>
                <span className="text-[17px] font-semibold tabular-nums tracking-tight">Day {value.breakEvenDay}</span>
                <span className="text-[11.5px] text-text-muted">of an average month</span>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            <div>
              <h3 className="text-[12.5px] font-semibold">
                {value.monthlyCost > 0
                  ? `Recent value against the ${fmtMoney(value.monthlyCost)} you pay`
                  : "Value accrued recently"}
              </h3>
              <div className="mt-2.5">
                <ValueChart daily={usage?.daily || []} monthlyCost={value.monthlyCost} />
              </div>
            </div>

            <div>
              <h3 className="text-[12.5px] font-semibold">Value by model</h3>
              <div className="mt-3.5 flex flex-col gap-2.5">
                {(usage?.byModel || []).length === 0 && (
                  <p className="text-sm text-text-muted">No model usage recorded yet.</p>
                )}
                {(usage?.byModel || []).map((m) => (
                  <div key={m.model} className="grid grid-cols-[minmax(88px,132px)_1fr_auto] items-center gap-3">
                    <span className="truncate text-[12.5px] text-text-muted" title={m.model}>{m.model}</span>
                    <span className="block h-2.5 overflow-hidden rounded-[5px] bg-surface-2">
                      <span className="block h-full rounded-[5px] bg-primary" style={{ width: `${(m.cost / maxModel) * 100}%` }} />
                    </span>
                    <span className="text-[12.5px] font-medium tabular-nums">{fmtMoney(m.cost)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.45fr_1fr]">
        {/* Month by month */}
        <Card padding="none" className="px-4 py-4 sm:px-5">
          <SectionHeading title="Month by month" subtitle="Usage and value for every month on record." />
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm tabular-nums">
              <thead>
                <tr className="text-[10.5px] uppercase tracking-[0.05em] text-text-subtle">
                  <th className="pb-2 pr-3 font-semibold">Month</th>
                  <th className="pb-2 px-3 text-right font-semibold">Requests</th>
                  <th className="pb-2 px-3 text-right font-semibold">Tokens</th>
                  <th className="pb-2 px-3 text-right font-semibold">API value</th>
                  {value.monthlyCost > 0 && <th className="pb-2 pl-3 text-right font-semibold">Return</th>}
                </tr>
              </thead>
              <tbody>
                {(usage?.monthly || []).length === 0 && (
                  <tr><td colSpan={5} className="py-4 text-center text-text-muted">No usage recorded yet.</td></tr>
                )}
                {(usage?.monthly || []).map((m) => (
                  <tr key={m.month} className="border-t border-border-subtle">
                    <td className="py-2 pr-3 whitespace-nowrap">{fmtMonthLabel(m.month)}</td>
                    <td className="py-2 px-3 text-right text-text-muted">{fmtCount(m.requests)}</td>
                    <td className="py-2 px-3 text-right text-text-muted">{fmtCount(m.tokens)}</td>
                    <td className="py-2 px-3 text-right">{fmtMoney(m.cost)}</td>
                    {value.monthlyCost > 0 && (
                      <td className="py-2 pl-3 text-right font-semibold text-primary">
                        {Math.round(m.cost / value.monthlyCost)}×
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        {/* Recent requests */}
        <Card padding="none" className="px-4 py-4 sm:px-5">
          <SectionHeading title="Recent requests" subtitle="Most recent calls through this account." />
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm tabular-nums">
              <thead>
                <tr className="text-[10.5px] uppercase tracking-[0.05em] text-text-subtle">
                  <th className="pb-2 pr-3 font-semibold">Time</th>
                  <th className="pb-2 px-3 font-semibold">Model</th>
                  <th className="pb-2 pl-3 text-right font-semibold">Value</th>
                </tr>
              </thead>
              <tbody>
                {(usage?.recent || []).length === 0 && (
                  <tr><td colSpan={3} className="py-4 text-center text-text-muted">Nothing yet.</td></tr>
                )}
                {(usage?.recent || []).map((r, i) => (
                  <tr key={`${r.timestamp}-${i}`} className="border-t border-border-subtle">
                    <td className="py-2 pr-3 whitespace-nowrap font-mono text-xs text-text-muted">
                      {fmtTimeOfDay(r.timestamp)}
                    </td>
                    <td className="py-2 px-3 truncate" title={r.model}>{r.model}</td>
                    <td className="py-2 pl-3 text-right">{fmtMoney(r.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}
