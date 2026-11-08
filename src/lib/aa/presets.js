/**
 * Capability ranking dimensions powered directly by https://aihot.news/leaderboard.
 *
 * Five dimensions, scored directly from the official aihot.news leaderboard:
 *   - General (综合): 主榜整体能力综合评分
 *   - Coding (编程): 编程子榜评分（终端指令、代码构建、工程解决）
 *   - Research (科研): 科研子榜评分（前沿科学难题、复杂数学推理）
 *   - Professional Office (专业办公): 专业办公子榜评分（工具调用、金融数据分析、长任务智能体）
 *   - Knowledge & QA (知识问答): 知识问答子榜评分（事实准确、长上下文推理、不幻觉）
 */

export const RANKING_PRESETS = {
  general: {
    label: "General (综合)",
    description: "AIHOT 大模型综合榜评分 — 第三方权威评测综合表现",
    dimensionKey: "general",
    weights: { compositeScore: 1.0 },
    multiSource: true,
  },
  coding: {
    label: "Coding (编程)",
    description: "AIHOT 编程子榜评分 — 包含 TerminalBench、LiveBench Coding、SciCode 等工程评测",
    dimensionKey: "coding",
    weights: {
      terminalBench40: 0.35,
      liveBenchCoding: 0.25,
      scicode: 0.20,
      terminalbenchHard: 0.10,
      tau2: 0.10,
    },
    minCoverage: 0.4,
  },
  research: {
    label: "Research (科研)",
    description: "AIHOT 科研子榜评分 — 包含 HLE、CritPt、GPQA、FrontierMath 等前沿科学推理评测",
    dimensionKey: "research",
    weights: {
      hle: 0.30,
      critpt: 0.20,
      gpqa: 0.20,
      scicode: 0.15,
      liveBenchMath: 0.15,
    },
    minCoverage: 0.4,
  },
  office: {
    label: "Professional Office (专业办公)",
    description: "AIHOT 专业办公子榜评分 — 包含 Tau-Bench、Banking、APEX-Agents、GDPval 等智能体评测",
    dimensionKey: "office",
    weights: {
      tau2: 0.25,
      tauBanking: 0.20,
      apexAgents: 0.20,
      gdpvalNormalized: 0.15,
      analystAgent: 0.10,
      liveBenchData: 0.10,
    },
    minCoverage: 0.4,
  },
  knowledge: {
    label: "Knowledge & QA (知识问答)",
    description: "AIHOT 知识问答子榜评分 — 包含长上下文推理 (LCR)、Omniscience、真实性与指令遵循评测",
    dimensionKey: "knowledge",
    weights: {
      intelligenceIndex: 0.30,
      lcr: 0.20,
      gpqa: 0.20,
      omniscience: 0.15,
      ifbench: 0.15,
    },
    minCoverage: 0.4,
  },
};

export const DEFAULT_PRESET = "general";

/** Per-metric bounds across candidate set for raw benchmark metrics */
function computeBounds(models, metrics) {
  const bounds = {};
  for (const metric of metrics) {
    let min = Infinity;
    let max = -Infinity;
    for (const model of models) {
      const value = model?.[metric];
      if (typeof value !== "number" || !Number.isFinite(value)) continue;
      if (value < min) min = value;
      if (value > max) max = value;
    }
    if (Number.isFinite(min) && Number.isFinite(max)) bounds[metric] = { min, max };
  }
  return bounds;
}

function normalizeMetric(value, bound) {
  if (!bound) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (bound.max === bound.min) return 100;
  if (bound.min < 0) return ((value - bound.min) / (bound.max - bound.min)) * 100;
  if (bound.max === 0) return 0;
  return (value / bound.max) * 100;
}

/**
 * Score one model against a dimension.
 * Directly uses aihot.news scores if model has .scores, or falls back to
 * normalized metric weights for raw benchmark records.
 *
 * @param {object} model
 * @param {object} preset
 * @param {object} [bounds]
 * @returns {{score: number|null, coverage: number, usedMetrics: string[], insufficientEvidence?: boolean}}
 */
export function scoreModel(model, preset, bounds = null) {
  const dimKey = preset?.dimensionKey || "general";

  // 1. Primary: Direct aihot.news official scores
  if (model?.scores && typeof model.scores === "object") {
    let score = typeof model.scores[dimKey] === "number" ? model.scores[dimKey] : null;
    let coverage = score !== null ? 1.0 : 0.0;

    if (score === null) {
      if (typeof model.scores.general === "number") {
        score = model.scores.general;
        coverage = 0.5;
      } else if (typeof model.score === "number") {
        score = model.score;
        coverage = 0.5;
      }
    }

    return {
      score,
      coverage,
      usedMetrics: score !== null ? [dimKey] : [],
    };
  }

  // 2. Fallback: Weighted sum over raw benchmark metrics (for legacy records)
  const weights = preset?.weights || {};
  let weighted = 0;
  let availableWeight = 0;
  const usedMetrics = [];

  for (const [metric, weight] of Object.entries(weights)) {
    const scaled = bounds ? normalizeMetric(model?.[metric], bounds[metric]) : model?.[metric];
    if (scaled === null || typeof scaled !== "number" || !Number.isFinite(scaled)) continue;
    weighted += scaled * weight;
    availableWeight += weight;
    usedMetrics.push(metric);
  }

  const totalWeight = Object.values(weights).reduce((sum, w) => sum + w, 0) || 1;
  if (availableWeight === 0) return { score: null, coverage: 0, usedMetrics: [] };

  const coverage = availableWeight / totalWeight;
  if (coverage < (preset?.minCoverage ?? 0)) {
    return { score: null, coverage, usedMetrics, insufficientEvidence: true };
  }

  return { score: weighted / availableWeight, coverage, usedMetrics };
}

/**
 * Rank models by a dimension, strongest first.
 *
 * @param {Array} models
 * @param {string} presetKey
 * @returns {Array<{model: object, score: number|null, coverage: number, usedMetrics: string[]}>}
 */
export function rankModels(models, presetKey = DEFAULT_PRESET) {
  const preset = RANKING_PRESETS[presetKey] || RANKING_PRESETS[DEFAULT_PRESET];
  const list = Array.isArray(models) ? models : [];
  const metrics = Object.keys(preset.weights || {});
  const bounds = computeBounds(list, metrics);

  return list
    .map((model, index) => ({ model, index, ...scoreModel(model, preset, bounds) }))
    .sort((a, b) => {
      if (a.score === null && b.score === null) return a.index - b.index;
      if (a.score === null) return 1;
      if (b.score === null) return -1;
      if (b.score !== a.score) return b.score - a.score;
      return a.index - b.index;
    })
    .map(({ index, ...rest }) => rest);
}
