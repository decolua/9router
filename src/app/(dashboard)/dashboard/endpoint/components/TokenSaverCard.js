"use client";

import PropTypes from "prop-types";
import { Card, Toggle } from "@/shared/components";
import { CAVEMAN_LEVELS } from "../utils/endpointConstants";

export function TokenSaverCard({
  rtkEnabled,
  cavemanEnabled,
  cavemanLevel,
  cavemanLevels,
  onRtkEnabledChange,
  onCavemanEnabledChange,
  onCavemanLevelChange,
}) {
  // Use filtered levels from parent (locale-gated) or fall back to all levels
  const levels = cavemanLevels ?? CAVEMAN_LEVELS;
  return (
    <Card id="rtk">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <span className="material-symbols-outlined text-primary">bolt</span>
          Token Saver
        </h2>
      </div>
      <div className="flex items-center justify-between pt-2 pb-4 border-b border-border gap-4">
        <div className="min-w-0 flex-1">
          <p className="font-medium">
            Compress tool output{" "}
            <a
              href="https://github.com/rtk-ai/rtk"
              target="_blank"
              rel="noreferrer"
              className="text-xs font-normal text-primary underline hover:opacity-80"
            >
              (RTK)
            </a>
          </p>
          <p className="text-sm text-text-muted">
            git/grep/ls/tree/logs → 60-90% fewer input tokens
          </p>
        </div>
        <Toggle
          checked={rtkEnabled}
          onChange={() => onRtkEnabledChange(!rtkEnabled)}
        />
      </div>
      <div className="flex items-center justify-between pt-4 gap-4 flex-wrap">
        <div className="min-w-0 flex-1">
          <p className="font-medium">
            Compress LLM output{" "}
            <a
              href="https://github.com/JuliusBrussee/caveman"
              target="_blank"
              rel="noreferrer"
              className="text-xs font-normal text-primary underline hover:opacity-80"
            >
              (Caveman)
            </a>
          </p>
          <p className="text-sm text-text-muted">
            Terse-style system prompt → ~65% fewer output tokens (up to 87%)
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {cavemanEnabled && (
            <div className="flex items-center gap-1.5">
              {levels.map((lvl) => (
                <button
                  key={lvl.id}
                  onClick={() => onCavemanLevelChange(lvl.id)}
                  className={`px-3 py-1.5 rounded text-xs font-medium border transition-colors ${
                    cavemanLevel === lvl.id
                      ? "bg-primary text-white border-primary"
                      : "bg-transparent border-border text-text-muted hover:bg-surface-2"
                  }`}
                  title={lvl.desc}
                >
                  {lvl.label}
                </button>
              ))}
            </div>
          )}
          <Toggle
            checked={cavemanEnabled}
            onChange={() => onCavemanEnabledChange(!cavemanEnabled)}
          />
        </div>
      </div>
    </Card>
  );
}

TokenSaverCard.propTypes = {
  rtkEnabled: PropTypes.bool.isRequired,
  cavemanEnabled: PropTypes.bool.isRequired,
  cavemanLevel: PropTypes.string.isRequired,
  cavemanLevels: PropTypes.arrayOf(PropTypes.object),
  onRtkEnabledChange: PropTypes.func.isRequired,
  onCavemanEnabledChange: PropTypes.func.isRequired,
  onCavemanLevelChange: PropTypes.func.isRequired,
};
