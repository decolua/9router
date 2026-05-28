"use client";

import PropTypes from "prop-types";
import { Card, Input, Toggle } from "@/shared/components";

export function StreamStabilityCard({
  autoRetryOverloaded,
  maxRetryAttempts,
  retryDelayMs,
  midStreamResumeEnabled,
  onAutoRetryOverloadedChange,
  onMaxRetryAttemptsChange,
  onRetryDelayMsChange,
  onMidStreamResumeEnabledChange,
}) {
  return (
    <Card id="stream-stability">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <span className="material-symbols-outlined text-primary">
            sync_saved_locally
          </span>
          Stream Stability & Auto Retry
        </h2>
      </div>

      <div className="flex items-center justify-between pt-2 pb-4 border-b border-border gap-4">
        <div className="min-w-0 flex-1">
          <p className="font-medium">Auto-Retry Overloaded Errors</p>
          <p className="text-sm text-text-muted">
            Automatically retry initial requests when providers return
            &quot;overloaded&quot; (503/529) or busy 429 status codes.
          </p>
        </div>
        <Toggle
          checked={autoRetryOverloaded}
          onChange={() => onAutoRetryOverloadedChange(!autoRetryOverloaded)}
        />
      </div>

      {autoRetryOverloaded && (
        <div className="flex items-center gap-6 pt-4 pb-4 border-b border-border flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-text-muted">
              Max Attempts:
            </span>
            <Input
              type="number"
              min="1"
              max="10"
              value={maxRetryAttempts}
              onChange={(e) => onMaxRetryAttemptsChange(e.target.value)}
              className="w-20 text-center"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-text-muted">
              Delay (ms):
            </span>
            <Input
              type="number"
              min="500"
              max="10000"
              step="500"
              value={retryDelayMs}
              onChange={(e) => onRetryDelayMsChange(e.target.value)}
              className="w-28 text-center"
            />
          </div>
        </div>
      )}

      <div className="flex items-center justify-between pt-4 gap-4">
        <div className="min-w-0 flex-1">
          <p className="font-medium">Mid-stream Transparent Resuming</p>
          <p className="text-sm text-text-muted">
            If the stream disconnects unexpectedly mid-generation, 9Router will
            seamlessly request the provider to write the remaining response from
            where it left off.
          </p>
        </div>
        <Toggle
          checked={midStreamResumeEnabled}
          onChange={() =>
            onMidStreamResumeEnabledChange(!midStreamResumeEnabled)
          }
        />
      </div>
    </Card>
  );
}

StreamStabilityCard.propTypes = {
  autoRetryOverloaded: PropTypes.bool.isRequired,
  maxRetryAttempts: PropTypes.number.isRequired,
  retryDelayMs: PropTypes.number.isRequired,
  midStreamResumeEnabled: PropTypes.bool.isRequired,
  onAutoRetryOverloadedChange: PropTypes.func.isRequired,
  onMaxRetryAttemptsChange: PropTypes.func.isRequired,
  onRetryDelayMsChange: PropTypes.func.isRequired,
  onMidStreamResumeEnabledChange: PropTypes.func.isRequired,
};
