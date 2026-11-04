"use client";

import PropTypes from "prop-types";

/**
 * Outcome of a REAL probe request against one model.
 *
 * Deliberately distinct from ModelIntelBadges, which renders declared/benchmark
 * data: this badge only ever reflects what happened when we actually called the
 * model. Renders nothing when the model has never been probed, so the picker
 * looks unchanged until the user asks for a detection run.
 */
export default function ProbeBadge({ probe }) {
  if (!probe) return null;

  const { ok, failureKind, capabilities, latencyMs, error, detail, stale } = probe;

  let icon;
  let color;
  let label;
  if (ok) {
    icon = "check_circle";
    color = "text-emerald-500";
    label = `Responded${latencyMs != null ? ` in ${latencyMs}ms` : ""}`;
  } else if (failureKind === "rate_limited") {
    icon = "hourglass_top";
    color = "text-amber-500";
    label = "Rate limited — reachable but throttled";
  } else if (failureKind === "auth") {
    icon = "key_off";
    color = "text-orange-500";
    label = "Auth rejected — check the connection's credentials";
  } else {
    icon = "error";
    color = "text-red-500";
    label = "Failed when called";
  }

  const tip = [
    label,
    error ? `· ${error}` : null,
    detail?.vision ? `vision: ${detail.vision}` : null,
    detail?.tools ? `tools: ${detail.tools}` : null,
    detail?.audioInput ? `audio: ${detail.audioInput}` : null,
    stale ? "(stale — measured over a week ago)" : null,
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <span className={`inline-flex items-center gap-0.5 ${stale ? "opacity-50" : ""}`} title={tip}>
      <span className={`material-symbols-outlined leading-none ${color}`} style={{ fontSize: "11px" }}>
        {icon}
      </span>
      {/* Only show a capability tick when the probe actually proved it. */}
      {capabilities?.vision && (
        <span className="material-symbols-outlined leading-none text-sky-500" style={{ fontSize: "11px" }} title="Vision confirmed by a real image request">
          visibility
        </span>
      )}
      {capabilities?.tools && (
        <span className="material-symbols-outlined leading-none text-violet-500" style={{ fontSize: "11px" }} title="Emitted a real tool_call">
          build
        </span>
      )}
      {capabilities?.audioInput && (
        <span className="material-symbols-outlined leading-none text-teal-500" style={{ fontSize: "11px" }} title="Audio input confirmed by a real audio request">
          graphic_eq
        </span>
      )}
    </span>
  );
}

ProbeBadge.propTypes = {
  probe: PropTypes.shape({
    ok: PropTypes.bool,
    failureKind: PropTypes.string,
    capabilities: PropTypes.object,
    latencyMs: PropTypes.number,
    error: PropTypes.string,
    detail: PropTypes.object,
    stale: PropTypes.bool,
  }),
};
