"use client";

import { useState, useEffect } from "react";
import PropTypes from "prop-types";
import Card from "@/shared/components/Card";

// Compact token counts, matching the formatter the API key page already uses so
// the same number reads the same way in both places.
function formatTokens(n) {
  const v = Number(n) || 0;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}k`;
  return String(v);
}

function pad(n) {
  return String(n).padStart(2, "0");
}

function formatCountdown(ms) {
  if (ms <= 0) return "now";
  const total = Math.floor(ms / 1000);
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (days > 0) return `${days}d ${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  if (hours > 0) return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  return `${pad(minutes)}:${pad(seconds)}`;
}

/**
 * The signing-in key's own token allowance.
 *
 * /api/usage/api-keys already narrows to the session's key, so this shows the
 * holder their own limit and nothing else: no other key's name, quota or model
 * scope ever reaches the browser for them.
 */
export default function KeyQuotaCard({ quota }) {
  const [, setTick] = useState(0);

  const nextResetAt = quota?.nextResetAt || null;
  useEffect(() => {
    // Nothing to count down to when the window never rolls over.
    if (!nextResetAt) return undefined;
    const timer = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(timer);
  }, [nextResetAt]);

  const limit = Number(quota?.tokenLimit) || 0;
  const used = Number(quota?.usedTokens) || 0;
  const hasLimit = limit > 0;
  const remaining = hasLimit ? Math.max(0, limit - used) : 0;
  const percent = hasLimit ? Math.min(100, (used / limit) * 100) : 0;

  let barColor = "bg-primary";
  if (percent >= 100) barColor = "bg-red-500";
  else if (percent >= 80) barColor = "bg-amber-500";

  const remainingMs = nextResetAt ? new Date(nextResetAt).getTime() - Date.now() : null;

  return (
    <Card padding="sm" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="material-symbols-outlined text-[18px] text-primary">
            key
          </span>
          <span className="truncate text-sm font-semibold text-text-main">
            {quota?.name || "This key"}
          </span>
        </div>
        {!hasLimit && (
          <span className="text-xs text-text-muted">No token limit</span>
        )}
      </div>

      {hasLimit ? (
        <>
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <span className="text-sm text-text-muted">
              {`${formatTokens(used)} of ${formatTokens(limit)} tokens used`}
            </span>
            <span className="text-sm font-semibold text-text-main">
              {`${formatTokens(remaining)} left`}
            </span>
          </div>

          <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
            <div
              className={`h-full rounded-full transition-all ${barColor}`}
              // A key that has not been used yet should read as "empty", not as
              // a bar that failed to render.
              style={{ width: `${Math.max(percent, 1.5)}%` }}
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-text-muted">
            <span>{`${percent.toFixed(0)}% of the allowance used`}</span>
            {remainingMs !== null && Number.isFinite(remainingMs) && (
              <span>{`Resets in ${formatCountdown(remainingMs)}`}</span>
            )}
          </div>
        </>
      ) : (
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-xs text-text-muted">
          <span>{`${formatTokens(used)} tokens used in the current window`}</span>
        </div>
      )}
    </Card>
  );
}

KeyQuotaCard.propTypes = {
  quota: PropTypes.shape({
    name: PropTypes.string,
    tokenLimit: PropTypes.number,
    usedTokens: PropTypes.number,
    nextResetAt: PropTypes.string,
  }),
};
