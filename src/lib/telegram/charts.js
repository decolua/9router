// Chart rendering: pulls aggregated usage from the in-process repos (no HTTP)
// and produces a PNG buffer suitable for Telegram sendPhoto.
//
// Stack: chart.js (pure JS) + @napi-rs/canvas (Skia binary, prebuilt for Linux musl).
// No Cairo/Pango/native gyp deps. Adds ~6 MB to the runner image.

import { createCanvas, GlobalFonts } from "@napi-rs/canvas";
import { Chart, registerables } from "chart.js";

let _registered = false;
function ensureRegistered() {
  if (_registered) return;
  Chart.register(...registerables);
  _registered = true;
}

const W = 1280;
const H = 720;

// 9Router brand palette, dark-first (matches Telegram dark mode).
// Primary brand orange #E56A4A; complementary cool tones for series.
const FG = "#f4ece4";
const FG_MUTED = "rgba(244,236,228,0.65)";
const BG = "#181412";
const GRID = "rgba(244,236,228,0.06)";
const SERIES = [
  "#E56A4A", // brand orange
  "#FFB287", // light orange / coral
  "#7BC9C0", // teal
  "#A8B5FF", // periwinkle
  "#F3C969", // amber
  "#E891B9", // rose
  "#9DD191", // sage
  "#C9A8FF", // lavender
];

function newCanvas() {
  const canvas = createCanvas(W, H);
  // Solid background — chart.js default is transparent
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);
  return { canvas, ctx };
}

function commonOptions(title) {
  return {
    responsive: false,
    animation: false,
    devicePixelRatio: 1,
    plugins: {
      title: {
        display: !!title,
        text: title,
        color: FG,
        font: { size: 22, weight: "bold" },
        padding: { top: 8, bottom: 16 },
      },
      legend: {
        labels: { color: FG, font: { size: 14 } },
        position: "bottom",
      },
      tooltip: { enabled: false },
    },
    scales: {
      x: { ticks: { color: FG, font: { size: 13 } }, grid: { color: GRID } },
      y: { ticks: { color: FG, font: { size: 13 }, callback: (v) => fmtCompact(v) }, grid: { color: GRID }, beginAtZero: true },
    },
  };
}

function fmtCompact(n) {
  const abs = Math.abs(n);
  if (abs >= 1e9) return (n / 1e9).toFixed(1) + "B";
  if (abs >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (abs >= 1e3) return (n / 1e3).toFixed(1) + "k";
  return String(Math.round(n));
}

async function renderToPng(buildChart) {
  ensureRegistered();
  const { canvas, ctx } = newCanvas();
  const chart = new Chart(ctx, buildChart());
  // chart.js renders synchronously when animation:false
  chart.draw();
  const buffer = canvas.toBuffer("image/png");
  chart.destroy();
  return buffer;
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Renders a stacked bar chart of total tokens per day for the last N days.
 * Input: chartData = array of {label, totalTokens, promptTokens, completionTokens}.
 */
export async function renderDailyTokens(chartData, { title = "Tokens per day" } = {}) {
  return renderToPng(() => ({
    type: "bar",
    data: {
      labels: chartData.map((d) => d.label),
      datasets: [
        {
          label: "Prompt tokens",
          data: chartData.map((d) => d.promptTokens || 0),
          backgroundColor: SERIES[0],
          stack: "tokens",
        },
        {
          label: "Completion tokens",
          data: chartData.map((d) => d.completionTokens || 0),
          backgroundColor: SERIES[1],
          stack: "tokens",
        },
      ],
    },
    options: {
      ...commonOptions(title),
      scales: {
        ...commonOptions(title).scales,
        x: { ...commonOptions(title).scales.x, stacked: true },
        y: { ...commonOptions(title).scales.y, stacked: true },
      },
    },
  }));
}

/**
 * Horizontal bar chart of tokens per provider (one period).
 * Input: rows = [{provider, tokens, requests}], pre-sorted desc by tokens.
 */
export async function renderTokensByProvider(rows, { title = "Tokens by provider (today)" } = {}) {
  const top = rows.slice(0, 10);
  return renderToPng(() => ({
    type: "bar",
    data: {
      labels: top.map((r) => r.provider || "unknown"),
      datasets: [
        {
          label: "Tokens",
          data: top.map((r) => r.tokens || 0),
          backgroundColor: top.map((_, i) => SERIES[i % SERIES.length]),
          borderWidth: 0,
        },
      ],
    },
    options: {
      ...commonOptions(title),
      indexAxis: "y",
      plugins: { ...commonOptions(title).plugins, legend: { display: false } },
    },
  }));
}

/**
 * Multi-line chart: tokens-per-day, one line per provider.
 * Input: providers = [{name, points: [tokens0, tokens1, ...]}], labels = ['Mon','Tue',...].
 */
export async function renderProvidersOverTime(providers, labels, { title = "Tokens per provider (last 7 days)" } = {}) {
  return renderToPng(() => ({
    type: "line",
    data: {
      labels,
      datasets: providers.slice(0, 8).map((p, i) => ({
        label: p.name,
        data: p.points,
        borderColor: SERIES[i % SERIES.length],
        backgroundColor: SERIES[i % SERIES.length] + "33",
        borderWidth: 2,
        tension: 0.25,
        pointRadius: 3,
      })),
    },
    options: commonOptions(title),
  }));
}
