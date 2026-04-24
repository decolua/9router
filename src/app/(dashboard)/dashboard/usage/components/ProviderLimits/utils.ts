import { getModelsByProviderId } from "@/shared/constants/models";

interface Quota {
  name: string;
  used: number;
  total: number;
  resetAt?: string | null;
  remainingPercentage?: number;
  displayName?: string;
  modelKey?: string;
  message?: string;
}

/**
 * Format ISO date string to countdown format
 */
export function formatResetTime(date: string | Date | null | undefined): string {
  if (!date) return "-";

  try {
    const resetDate = typeof date === "string" ? new Date(date) : date;
    const now = new Date();
    const diffMs = resetDate.getTime() - now.getTime();

    if (diffMs <= 0) return "-";

    const totalMinutes = Math.ceil(diffMs / (1000 * 60));
    
    if (totalMinutes < 60) {
      return `${totalMinutes}m`;
    }
    
    const totalHours = Math.floor(totalMinutes / 60);
    const remainingMinutes = totalMinutes % 60;
    
    if (totalHours < 24) {
      return `${totalHours}h ${remainingMinutes}m`;
    }
    
    const days = Math.floor(totalHours / 24);
    const remainingHours = totalHours % 24;
    return `${days}d ${remainingHours}h ${remainingMinutes}m`;
  } catch (error) {
    return "-";
  }
}

/**
 * Get Tailwind color name based on percentage
 */
export function getStatusColor(percentage: number): "green" | "yellow" | "red" {
  if (percentage > 70) return "green";
  if (percentage >= 30) return "yellow";
  return "red";
}

/**
 * Get status emoji based on percentage
 */
export function getStatusEmoji(percentage: number): string {
  if (percentage > 70) return "🟢";
  if (percentage >= 30) return "🟡";
  return "🔴";
}

/**
 * Calculate remaining percentage
 */
export function calculatePercentage(used: number, total: number): number {
  if (!total || total === 0) return 0;
  if (!used || used < 0) return 100;
  if (used >= total) return 0;

  return Math.round(((total - used) / total) * 100);
}

/** Remaining % for a normalized quota row */
export function getQuotaRemainingPercent(quota: Quota): number {
  if (!quota || typeof quota !== "object") return 0;
  if (quota.remainingPercentage !== undefined) {
    return Math.round(quota.remainingPercentage);
  }
  return calculatePercentage(quota.used, quota.total);
}

/**
 * Tailwind classes for quota health
 */
export function getQuotaHealthStyles(remaining: number) {
  if (remaining > 70) {
    return {
      text: "text-primary dark:text-primary",
      bar: "bg-primary",
      track: "bg-primary/10",
      dot: "bg-primary",
    };
  }
  if (remaining >= 30) {
    return {
      text: "text-muted-foreground dark:text-muted-foreground",
      bar: "bg-yellow-500",
      track: "bg-muted/30",
      dot: "bg-yellow-500",
    };
  }
  return {
    text: "text-destructive dark:text-destructive",
    bar: "bg-destructive",
    track: "bg-destructive/10",
    dot: "bg-destructive",
  };
}

/**
 * Format reset time display
 */
export function formatResetTimeDisplay(resetTime: string | null | undefined): string | null {
  if (!resetTime) return null;

  try {
    const date = new Date(resetTime);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    let dayStr = "";
    if (date >= today && date < tomorrow) {
      dayStr = "Today";
    } else if (
      date >= tomorrow &&
      date < new Date(tomorrow.getTime() + 24 * 60 * 60 * 1000)
    ) {
      dayStr = "Tomorrow";
    } else {
      dayStr = date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      });
    }

    const timeStr = date.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });

    return `${dayStr}, ${timeStr}`;
  } catch {
    return null;
  }
}

/**
 * Parse provider-specific quota structures into normalized array
 */
export function parseQuotaData(provider: string, data: any): Quota[] {
  if (!data || typeof data !== "object") return [];

  const normalizedQuotas: Quota[] = [];

  try {
    switch (provider.toLowerCase()) {
      case "github":
        if (data.quotas) {
          Object.entries(data.quotas).forEach(([name, quota]: [string, any]) => {
            normalizedQuotas.push({
              name,
              used: quota.used || 0,
              total: quota.total || 0,
              resetAt: quota.resetAt || null,
            });
          });
        }
        break;

      case "antigravity":
        if (data.quotas) {
          Object.entries(data.quotas).forEach(([modelKey, quota]: [string, any]) => {
            normalizedQuotas.push({
              name: quota.displayName || modelKey,
              modelKey: modelKey,
              used: quota.used || 0,
              total: quota.total || 0,
              resetAt: quota.resetAt || null,
              remainingPercentage: quota.remainingPercentage,
            });
          });
        }
        break;

      case "codex":
      case "kiro":
        if (data.quotas) {
          Object.entries(data.quotas).forEach(([quotaType, quota]: [string, any]) => {
            normalizedQuotas.push({
              name: quotaType,
              used: quota.used || 0,
              total: quota.total || 0,
              resetAt: quota.resetAt || null,
            });
          });
        }
        break;

      case "claude":
        if (data.message) {
          normalizedQuotas.push({
            name: "error",
            used: 0,
            total: 0,
            resetAt: null,
            message: data.message,
          });
        } else if (data.quotas) {
          Object.entries(data.quotas).forEach(([name, quota]: [string, any]) => {
            normalizedQuotas.push({
              name,
              used: quota.used || 0,
              total: quota.total || 0,
              resetAt: quota.resetAt || null,
            });
          });
        }
        break;

      default:
        if (data.quotas) {
          Object.entries(data.quotas).forEach(([name, quota]: [string, any]) => {
            normalizedQuotas.push({
              name,
              used: quota.used || 0,
              total: quota.total || 0,
              resetAt: quota.resetAt || null,
            });
          });
        }
    }
  } catch (error) {
    console.error(`Error parsing quota data for ${provider}:`, error);
    return [];
  }

  // Sort quotas according to PROVIDER_MODELS order
  const modelOrder = getModelsByProviderId(provider);
  if (modelOrder.length > 0) {
    const orderMap = new Map(modelOrder.map((m, i) => [m.id, i]));
    
    normalizedQuotas.sort((a, b) => {
      const keyA = a.modelKey || a.name;
      const keyB = b.modelKey || b.name;
      const orderA = orderMap.get(keyA) ?? 999;
      const orderB = orderMap.get(keyB) ?? 999;
      return orderA - orderB;
    });
  }

  return normalizedQuotas;
}
