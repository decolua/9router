"use client";

import { useState } from "react";
import PropTypes from "prop-types";
import { fmtDayLabel, fmtCount } from "./formatters";

const W = 880, H = 200, PAD_L = 46, PAD_R = 14, PAD_T = 14, PAD_B = 26;
const PLOT_W = W - PAD_L - PAD_R;
const PLOT_H = H - PAD_T - PAD_B;

/**
 * Requests per day. Single measure, single axis — quota lives in its own chart
 * rather than sharing this one, since two scales on one plot make unrelated
 * series look correlated.
 */
export default function ActivityChart({ daily }) {
  const [hover, setHover] = useState(null);

  if (!daily?.length) {
    return <p className="py-10 text-center text-sm text-text-muted">No activity recorded yet.</p>;
  }

  const max = Math.max(...daily.map((d) => d.requests), 1);
  // Round the axis top to a 1/2/5×10^n step so ticks land on readable numbers
  // (0/50/100/150/200) instead of dividing the raw peak (0/53/106/159/212).
  const niceMax = (() => {
    const rough = max / 4;
    const mag = 10 ** Math.floor(Math.log10(rough));
    const step = [1, 2, 5, 10].find((m) => m * mag >= rough) * mag;
    return step * 4;
  })();
  const bw = PLOT_W / daily.length;
  const barX = (i) => PAD_L + i * bw + bw * 0.18;
  const barW = bw * 0.64;
  const y = (v) => PAD_T + PLOT_H - (v / niceMax) * PLOT_H;

  const ticks = [0, 1, 2, 3, 4].map((t) => (niceMax / 4) * t);
  const labelIdx = [0, Math.floor(daily.length / 3), Math.floor((daily.length * 2) / 3), daily.length - 1];

  const onMove = (e) => {
    const box = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * W;
    const i = Math.max(0, Math.min(daily.length - 1, Math.floor((px - PAD_L) / bw)));
    setHover(i);
  };

  return (
    <div className="relative overflow-x-auto">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="block w-full h-auto"
        role="img"
        aria-label={`Requests per day over the last ${daily.length} days, peaking at ${max}.`}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        {ticks.map((v) => (
          <g key={v}>
            <line
              x1={PAD_L} x2={W - PAD_R} y1={y(v)} y2={y(v)}
              className="stroke-text-subtle/20" strokeWidth="1"
            />
            <text
              x={PAD_L - 8} y={y(v) + 3.5} textAnchor="end"
              className="fill-text-subtle text-[10.5px] tabular-nums"
            >
              {fmtCount(v)}
            </text>
          </g>
        ))}

        {daily.map((d, i) => (
          <rect
            key={d.date}
            x={barX(i)} y={y(d.requests)}
            width={barW} height={Math.max(0, PAD_T + PLOT_H - y(d.requests))}
            rx="4"
            className="fill-indigo-500"
            opacity={hover === null || hover === i ? 0.95 : 0.45}
          />
        ))}

        {labelIdx.map((i) => (
          <text
            key={i}
            x={barX(i) + barW / 2} y={H - 8} textAnchor="middle"
            className="fill-text-subtle text-[10.5px] tabular-nums"
          >
            {fmtDayLabel(daily[i]?.date)}
          </text>
        ))}
      </svg>

      {hover !== null && (
        <div
          className="pointer-events-none absolute z-10 whitespace-nowrap rounded-[9px] border border-border bg-surface px-2.5 py-1.5 text-xs shadow-[var(--shadow-elevated)]"
          style={{
            left: `min(max(${((barX(hover) + barW / 2) / W) * 100}% - 60px, 4px), calc(100% - 150px))`,
            top: `${(y(daily[hover].requests) / H) * 100}%`,
            transform: "translateY(-115%)",
          }}
        >
          <span className="block text-[11px] text-text-muted">{fmtDayLabel(daily[hover].date)}</span>
          <span className="font-semibold tabular-nums">{daily[hover].requests}</span> requests
        </div>
      )}
    </div>
  );
}

ActivityChart.propTypes = {
  daily: PropTypes.arrayOf(PropTypes.shape({
    date: PropTypes.string,
    requests: PropTypes.number,
    cost: PropTypes.number,
  })),
};
