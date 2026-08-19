"use client";

import { useState, useMemo } from "react";
import PropTypes from "prop-types";
import { fmtMoney, fmtDayLabel } from "./formatters";

const W = 460, H = 190, PAD_L = 48, PAD_R = 12, PAD_T = 12, PAD_B = 26;
const PLOT_W = W - PAD_L - PAD_R;
const PLOT_H = H - PAD_T - PAD_B;

/**
 * Cumulative API value this month against a reference line at the sub's price.
 * The crossover is the point the subscription paid for itself.
 */
export default function ValueChart({ daily, monthlyCost }) {
  const [hover, setHover] = useState(null);

  const cum = useMemo(
    () => (daily || []).reduce((acc, d) => {
      const previous = acc.length ? acc[acc.length - 1].value : 0;
      acc.push({ date: d.date, value: previous + (d.cost || 0), day: d.cost || 0 });
      return acc;
    }, []),
    [daily],
  );

  if (!cum.length || cum.at(-1).value <= 0) {
    return <p className="py-10 text-center text-sm text-text-muted">No value recorded in this window yet.</p>;
  }

  const showCost = typeof monthlyCost === "number" && monthlyCost > 0;
  const peak = cum.at(-1).value;
  const niceMax = Math.max(
    Math.ceil(peak / 4) * 4,
    showCost ? monthlyCost * 1.15 : 0,
  ) || 4;

  const x = (i) => PAD_L + (i / Math.max(1, cum.length - 1)) * PLOT_W;
  const y = (v) => PAD_T + PLOT_H - (v / niceMax) * PLOT_H;

  const crossIdx = showCost ? cum.findIndex((p) => p.value >= monthlyCost) : -1;
  const pts = cum.map((p, i) => `${x(i)},${y(p.value)}`).join(" ");
  const ticks = [0, 1, 2, 3, 4].map((t) => (niceMax / 4) * t);
  const labelIdx = [...new Set([0, Math.floor(cum.length / 2), cum.length - 1])];

  const onMove = (e) => {
    const box = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * W;
    const i = Math.max(0, Math.min(cum.length - 1, Math.round(((px - PAD_L) / PLOT_W) * (cum.length - 1))));
    setHover(i);
  };

  return (
    <div className="relative overflow-x-auto">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="block w-full h-auto"
        role="img"
        aria-label={
          showCost
            ? `Cumulative API value reaching ${fmtMoney(peak)} against a subscription cost of ${fmtMoney(monthlyCost)}.`
            : `Cumulative API value reaching ${fmtMoney(peak)}.`
        }
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id="valueFade" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-primary)" stopOpacity="0.2" />
            <stop offset="100%" stopColor="var(--color-primary)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {ticks.map((v) => (
          <g key={v}>
            <line
              x1={PAD_L} x2={W - PAD_R} y1={y(v)} y2={y(v)}
              className="stroke-text-subtle/20" strokeWidth="1"
            />
            <text
              x={PAD_L - 7} y={y(v) + 3.5} textAnchor="end"
              className="fill-text-subtle text-[10.5px] tabular-nums"
            >
              {fmtMoney(v)}
            </text>
          </g>
        ))}

        <polygon fill="url(#valueFade)" points={`${PAD_L},${y(0)} ${pts} ${x(cum.length - 1)},${y(0)}`} />
        <polyline
          fill="none" points={pts} strokeWidth="2" strokeLinejoin="round"
          stroke="var(--color-primary)"
        />

        {showCost && (
          <>
            <line
              x1={PAD_L} x2={W - PAD_R} y1={y(monthlyCost)} y2={y(monthlyCost)}
              className="stroke-text-subtle" strokeWidth="1.5" strokeDasharray="5 4"
            />
            <text
              x={W - PAD_R} y={y(monthlyCost) - 6} textAnchor="end"
              className="fill-text-muted text-[10.5px] font-semibold tabular-nums"
            >
              {fmtMoney(monthlyCost)}/mo
            </text>
          </>
        )}

        {crossIdx >= 0 && (
          <>
            <line
              x1={x(crossIdx)} x2={x(crossIdx)}
              y1={y(cum[crossIdx].value) - 7} y2={y(cum[crossIdx].value) - 21}
              className="stroke-text-subtle" strokeWidth="1"
            />
            <circle
              cx={x(crossIdx)} cy={y(cum[crossIdx].value)} r="4.5"
              fill="var(--color-primary)" className="stroke-surface" strokeWidth="2"
            />
            <text
              x={x(crossIdx) + 7} y={y(cum[crossIdx].value) - 26}
              className="fill-text-main text-[10.5px] font-semibold"
            >
              Paid off {fmtDayLabel(cum[crossIdx].date)}
            </text>
          </>
        )}

        {labelIdx.map((i, n) => (
          <text
            key={i}
            x={x(i)} y={H - 8}
            textAnchor={n === 0 ? "start" : n === labelIdx.length - 1 ? "end" : "middle"}
            className="fill-text-subtle text-[10.5px] tabular-nums"
          >
            {fmtDayLabel(cum[i]?.date)}
          </text>
        ))}

        {hover !== null && (
          <>
            <line
              x1={x(hover)} x2={x(hover)} y1={PAD_T} y2={PAD_T + PLOT_H}
              className="stroke-text-subtle/25" strokeWidth="1"
            />
            <circle
              cx={x(hover)} cy={y(cum[hover].value)} r="4"
              fill="var(--color-primary)" className="stroke-surface" strokeWidth="2"
            />
          </>
        )}
      </svg>

      {hover !== null && (
        <div
          className="pointer-events-none absolute z-10 whitespace-nowrap rounded-[9px] border border-border bg-surface px-2.5 py-1.5 text-xs shadow-[var(--shadow-elevated)]"
          style={{
            left: `min(max(${(x(hover) / W) * 100}% - 70px, 4px), calc(100% - 175px))`,
            top: `${(y(cum[hover].value) / H) * 100}%`,
            transform: "translateY(-115%)",
          }}
        >
          <span className="block text-[11px] text-text-muted">
            {fmtDayLabel(cum[hover].date)} · +{fmtMoney(cum[hover].day)}
          </span>
          <span className="font-semibold tabular-nums">{fmtMoney(cum[hover].value)}</span> cumulative
        </div>
      )}
    </div>
  );
}

ValueChart.propTypes = {
  daily: PropTypes.arrayOf(PropTypes.shape({
    date: PropTypes.string,
    cost: PropTypes.number,
  })),
  monthlyCost: PropTypes.number,
};
