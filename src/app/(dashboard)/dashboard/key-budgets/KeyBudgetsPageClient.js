"use client";

import Link from "next/link";
import { Button, Modal } from "@/shared/components";
import { CardSkeleton } from "@/shared/components/Loading";
import { ApiKeyLimitFormFields } from "../endpoint/components/ApiKeyLimitFormFields";
import { StatusAlert } from "../endpoint/components/StatusAlert";
import {
  buildUsageDetailMessage,
  buildUsageSummaryItems,
  formatLimitState,
  formatUsageHistoryValue,
  formatUsageMetricValue,
  getLimitBadgeClass,
  getUsageHistoryStatusClass,
  getUsageMetricLabel,
  getUsagePeriodLabel,
} from "../endpoint/utils/endpointLimitHelpers";
import { useKeyBudgets } from "./hooks/useKeyBudgets";

function getProgressPercent(key) {
  const state = key.limitState;
  if (!state?.enabled || !state.limitValue) return 0;
  return Math.min(100, Math.max(0, (state.currentValue / state.limitValue) * 100));
}

function maskKey(value) {
  if (!value) return "";
  return value.length > 8 ? `${value.slice(0, 8)}...` : value;
}

function SummaryCard({ icon, label, value, tone = "text-text-main" }) {
  return (
    <div className="rounded-[14px] border border-border-subtle bg-surface p-5 shadow-[var(--shadow-soft)]">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-text-muted">{label}</p>
          <p className={`mt-2 text-2xl font-semibold ${tone}`}>{value}</p>
        </div>
        <span className="material-symbols-outlined text-[28px] text-primary">
          {icon}
        </span>
      </div>
    </div>
  );
}

function BudgetStatus({ keyItem }) {
  const display = formatLimitState(keyItem);
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${getLimitBadgeClass(display.status)}`}
    >
      {display.status === "unlimited" ? "Unlimited" : display.status}
    </span>
  );
}

function BudgetProgress({ keyItem }) {
  const display = formatLimitState(keyItem);
  const percent = getProgressPercent(keyItem);

  if (!keyItem.limitState?.enabled) {
    return <p className="text-sm text-text-muted">No budget configured.</p>;
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="font-medium text-text-main">{display.summary}</span>
        <span className="text-text-muted">{Math.round(percent)}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-surface-2">
        <div
          className="h-full rounded-full bg-primary transition-all"
          style={{ width: `${percent}%` }}
        />
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-muted">
        {display.remaining && <span>{display.remaining}</span>}
        {display.reset && <span>{display.reset}</span>}
      </div>
    </div>
  );
}

function UsageDetails({ details, loading, keyItem }) {
  if (loading) {
    return <p className="text-sm text-text-muted">Loading recent usage...</p>;
  }

  if (!details) {
    return <p className="text-sm text-text-muted">Usage details are not loaded.</p>;
  }

  const history = details.history || [];
  const summaryItems = buildUsageSummaryItems(details.limitState || keyItem.limitState);

  return (
    <div className="mt-4 rounded-lg border border-border-subtle bg-surface-2/40 p-4">
      <div className="mb-3 flex flex-col gap-1">
        <p className="text-sm font-medium text-text-main">Recent usage</p>
        <p className="text-xs text-text-muted">{buildUsageDetailMessage(keyItem)}</p>
      </div>

      {summaryItems.length > 0 && (
        <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
          {summaryItems.map((item) => (
            <div key={item.label} className="rounded-lg bg-surface p-3">
              <p className="text-xs text-text-muted">{item.label}</p>
              <p className="text-sm font-semibold text-text-main">{item.value}</p>
            </div>
          ))}
        </div>
      )}

      {history.length === 0 ? (
        <p className="text-sm text-text-muted">No recent usage recorded for this key.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-subtle text-left text-xs text-text-muted">
                <th className="py-2 font-medium">Time</th>
                <th className="py-2 font-medium">Model</th>
                <th className="py-2 font-medium">Endpoint</th>
                <th className="py-2 font-medium">Status</th>
                <th className="py-2 text-right font-medium">Usage</th>
              </tr>
            </thead>
            <tbody>
              {history.map((entry, index) => (
                <tr key={`${entry.timestamp}-${index}`} className="border-b border-border-subtle/60 last:border-0">
                  <td className="py-2 text-text-muted">{new Date(entry.timestamp).toLocaleString()}</td>
                  <td className="py-2 text-text-main">{entry.model || "-"}</td>
                  <td className="py-2 text-text-muted">{entry.endpoint || "-"}</td>
                  <td className={`py-2 ${getUsageHistoryStatusClass(Number(entry.status) || 200)}`}>
                    {entry.status || "200"}
                  </td>
                  <td className="py-2 text-right text-text-main">{formatUsageHistoryValue(entry)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function KeyBudgetCard({
  keyItem,
  usageDetails,
  expanded,
  loadingUsage,
  onEdit,
  onToggleUsage,
}) {
  const state = keyItem.limitState;
  const metric = state?.enabled ? getUsageMetricLabel(state.metricType) : "No metric";
  const period = state?.enabled ? getUsagePeriodLabel(state.periodType) : "No period";

  return (
    <div className="rounded-[14px] border border-border-subtle bg-surface p-5 shadow-[var(--shadow-soft)]">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <h3 className="text-lg font-semibold text-text-main">{keyItem.name || "Unnamed key"}</h3>
            <BudgetStatus keyItem={keyItem} />
            <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${keyItem.isActive ? "bg-green-500/10 text-green-600 dark:text-green-400" : "bg-surface-2 text-text-muted"}`}>
              {keyItem.isActive ? "Active" : "Paused"}
            </span>
          </div>
          <p className="font-mono text-xs text-text-muted">{maskKey(keyItem.key) || keyItem.id}</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <p className="text-xs text-text-muted">Metric</p>
              <p className="text-sm font-medium text-text-main">{metric}</p>
            </div>
            <div>
              <p className="text-xs text-text-muted">Window</p>
              <p className="text-sm font-medium text-text-main">{period}</p>
            </div>
            <div>
              <p className="text-xs text-text-muted">Current</p>
              <p className="text-sm font-medium text-text-main">
                {state?.enabled ? formatUsageMetricValue(state.currentValue) : "Unlimited"}
              </p>
            </div>
          </div>
          <BudgetProgress keyItem={keyItem} />
        </div>
        <div className="flex flex-wrap gap-2 lg:justify-end">
          <Button variant="secondary" icon="edit" onClick={() => onEdit(keyItem)}>
            Edit Budget
          </Button>
          <Button variant="ghost" icon={expanded ? "expand_less" : "receipt_long"} onClick={() => onToggleUsage(keyItem)}>
            {expanded ? "Hide Usage" : "Recent Usage"}
          </Button>
        </div>
      </div>

      {expanded && (
        <UsageDetails
          details={usageDetails}
          loading={loadingUsage}
          keyItem={keyItem}
        />
      )}
    </div>
  );
}

export default function KeyBudgetsPageClient() {
  const {
    keys,
    loading,
    status,
    summary,
    editingKey,
    editKeyLimit,
    formError,
    savingKeyId,
    expandedKeyId,
    usageDetailsByKeyId,
    loadingUsageKeyId,
    setEditKeyLimit,
    loadKeys,
    openEditModal,
    closeEditModal,
    saveBudget,
    toggleUsageDetails,
  } = useKeyBudgets();

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6 p-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-text-main">Key Budgets</h1>
          <p className="mt-2 max-w-2xl text-sm text-text-muted">
            Manage per-API-key budgets. Full usage analytics stay in the Usage page; this page focuses on limits, remaining budget, and quick edits.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" icon="refresh" onClick={loadKeys}>
            Refresh
          </Button>
          <Link href="/dashboard/usage">
            <Button variant="ghost" icon="bar_chart">Full Usage Analytics</Button>
          </Link>
        </div>
      </div>

      {status && <StatusAlert status={status} />}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard icon="vpn_key" label="Total keys" value={summary.total} />
        <SummaryCard icon="price_check" label="Budgeted" value={summary.budgeted} />
        <SummaryCard icon="all_inclusive" label="Unlimited" value={summary.unlimited} />
        <SummaryCard
          icon="warning"
          label="Needs attention"
          value={summary.attention}
          tone={summary.attention > 0 ? "text-yellow-600 dark:text-yellow-400" : "text-text-main"}
        />
      </div>

      {loading ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <CardSkeleton />
          <CardSkeleton />
        </div>
      ) : keys.length === 0 ? (
        <div className="rounded-[14px] border border-border-subtle bg-surface p-8 text-center shadow-[var(--shadow-soft)]">
          <span className="material-symbols-outlined text-[36px] text-text-muted">vpn_key_off</span>
          <h2 className="mt-3 text-lg font-semibold text-text-main">No API keys yet</h2>
          <p className="mt-1 text-sm text-text-muted">
            Create API keys on the Endpoint page, then manage budgets here.
          </p>
          <Link href="/dashboard/endpoint" className="mt-4 inline-flex">
            <Button icon="api">Go to Endpoint</Button>
          </Link>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {keys.map((keyItem) => (
            <KeyBudgetCard
              key={keyItem.id}
              keyItem={keyItem}
              usageDetails={usageDetailsByKeyId[keyItem.id]}
              expanded={expandedKeyId === keyItem.id}
              loadingUsage={loadingUsageKeyId === keyItem.id}
              onEdit={openEditModal}
              onToggleUsage={toggleUsageDetails}
            />
          ))}
        </div>
      )}

      <Modal
        isOpen={!!editingKey}
        title="Edit Key Budget"
        onClose={closeEditModal}
      >
        <div className="flex flex-col gap-4">
          <div>
            <p className="text-sm font-medium text-text-main">{editingKey?.name}</p>
            <p className="font-mono text-xs text-text-muted">{maskKey(editingKey?.key)}</p>
          </div>
          <ApiKeyLimitFormFields
            form={editKeyLimit}
            onChange={setEditKeyLimit}
            description="Limit state is based on recorded usage. Use Usage for deeper analytics."
          />
          {formError && <StatusAlert status={{ type: "error", message: formError }} />}
          <div className="flex gap-2">
            <Button
              onClick={saveBudget}
              fullWidth
              disabled={!editingKey || savingKeyId === editingKey?.id}
            >
              {savingKeyId === editingKey?.id ? "Saving..." : "Save Budget"}
            </Button>
            <Button onClick={closeEditModal} variant="ghost" fullWidth>
              Cancel
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
