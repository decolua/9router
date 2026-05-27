import { LIMIT_METRIC_OPTIONS, LIMIT_PERIOD_OPTIONS } from "./endpoint-constants";

export function createDefaultLimitForm() {
  return {
    enabled: false,
    metricType: "requests",
    periodType: "daily",
    limitValue: "",
  };
}

export function buildLimitPayload(limitForm) {
  return {
    limitEnabled: !!limitForm.enabled,
    metricType: limitForm.metricType,
    periodType: limitForm.periodType,
    limitValue:
      limitForm.limitValue === "" ? null : Number(limitForm.limitValue),
  };
}

export function buildLimitFormFromKey(key) {
  if (!key?.limit) return createDefaultLimitForm();
  return {
    enabled: true,
    metricType: key.limit.metricType || "requests",
    periodType: key.limit.periodType || "daily",
    limitValue:
      key.limit.limitValue === undefined || key.limit.limitValue === null
        ? ""
        : String(key.limit.limitValue),
  };
}

export function getLimitBadgeClass(status) {
  if (status === "exceeded") return "bg-red-500/10 text-red-500";
  if (status === "near")
    return "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400";
  if (status === "healthy")
    return "bg-green-500/10 text-green-600 dark:text-green-400";
  return "bg-surface-2 text-text-muted";
}

export function formatLimitState(key) {
  const state = key?.limitState;
  if (!state || !state.enabled) {
    return {
      summary: "Unlimited",
      remaining: null,
      reset: null,
      status: "unlimited",
    };
  }
  return {
    summary: `${state.metricType}: ${state.currentValue}/${state.limitValue} · ${state.periodType}`,
    remaining: `${state.remainingValue} remaining`,
    reset: state.nextResetAt
      ? `Reset: ${new Date(state.nextResetAt).toLocaleString()}`
      : null,
    status: state.status || "healthy",
  };
}

export function normalizeLimitForm(limitForm) {
  if (!limitForm.enabled) return "";
  if (limitForm.limitValue === "") return "Limit value is required";
  const numericValue = Number(limitForm.limitValue);
  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return "Limit value must be greater than 0";
  }
  return "";
}

export function formatUsageMetricValue(value) {
  if (value == null) return "0";
  return Number.isInteger(value)
    ? String(value)
    : Number(value).toLocaleString(undefined, {
        minimumFractionDigits: 0,
        maximumFractionDigits: 4,
      });
}

export function formatUsageHistoryValue(entry) {
  if (entry.cost != null && Number(entry.cost) > 0) {
    return `$${formatUsageMetricValue(Number(entry.cost))}`;
  }
  if (entry.totalTokens != null && Number(entry.totalTokens) > 0) {
    return `${formatUsageMetricValue(Number(entry.totalTokens))} tokens`;
  }
  return `${formatUsageMetricValue(1)} request`;
}

export function getUsageHistoryStatusClass(status) {
  if (status >= 400) return "text-red-500";
  if (status >= 300) return "text-yellow-600 dark:text-yellow-400";
  return "text-green-600 dark:text-green-400";
}

export function buildUsageSummaryItems(limitState) {
  if (!limitState?.enabled) return [];
  return [
    {
      label: "Current",
      value: formatUsageMetricValue(limitState.currentValue),
    },
    {
      label: "Limit",
      value: formatUsageMetricValue(limitState.limitValue),
    },
    {
      label: "Remaining",
      value: formatUsageMetricValue(limitState.remainingValue),
    },
  ];
}

export function getUsageMetricLabel(metricType) {
  return (
    LIMIT_METRIC_OPTIONS.find((option) => option.value === metricType)?.label ||
    metricType ||
    "Usage"
  );
}

export function getUsagePeriodLabel(periodType) {
  return (
    LIMIT_PERIOD_OPTIONS.find((option) => option.value === periodType)?.label ||
    periodType ||
    "Period"
  );
}

export function buildUpdatedKey(existingKey, updatedFields, responseKey) {
  return {
    ...existingKey,
    ...updatedFields,
    ...(responseKey || {}),
    limit: responseKey?.limit ?? updatedFields.limit ?? existingKey.limit,
    limitState:
      responseKey?.limitState ??
      updatedFields.limitState ??
      existingKey.limitState,
  };
}

export function buildCreatedKeyValue(createdKey) {
  if (!createdKey) return "";
  if (typeof createdKey === "string") return createdKey;
  return createdKey.key || "";
}

export function buildUsageDetailMessage(key) {
  if (!key?.limitState?.enabled) {
    return "This key has no limit configured yet.";
  }
  return `${getUsageMetricLabel(key.limitState.metricType)} tracked on a ${getUsagePeriodLabel(key.limitState.periodType).toLowerCase()} window.`;
}
