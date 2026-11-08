/**
 * Fixed evidence budget across leaderboard sources.
 *
 * Ten independent source groups, 10% each, totalling 100%. Where one operator
 * publishes several boards, those boards SPLIT their group's 10% rather than
 * each drawing a full share — otherwise an operator could dominate the ranking
 * simply by publishing more boards, which is the correlated-source problem this
 * whole scheme exists to prevent.
 *
 * `family` groups boards that measure the same underlying thing, so related
 * boards under different names cannot quietly control the result together.
 *
 * A source with no reachable snapshot contributes nothing: its budget is NOT
 * redistributed to the sources that did report. Vacant budget only reduces the
 * evidence behind affected models (visible as coverage), never inflates the
 * influence of whoever happened to be up.
 */

export const SOURCE_GROUPS = {
  aa: {
    id: "aa",
    label: "AA Index",
    operator: "Artificial Analysis",
    budget: 0.1,
    family: "composite-intelligence",
    description: "Intelligence Index — many public evals re-run in one environment.",
    url: "https://artificialanalysis.ai/leaderboards/models",
  },
  epoch: {
    id: "epoch",
    label: "Epoch ECI",
    operator: "Epoch AI",
    budget: 0.1,
    family: "composite-intelligence",
    description: "Fits 50+ evals across time onto one capability scale.",
    url: "https://epoch.ai/data/ai-capabilities-index",
  },
  livebench: {
    id: "livebench",
    label: "LiveBench",
    operator: "LiveBench",
    budget: 0.1,
    family: "objective-rolling",
    description: "Continuously refreshed, verifiable-answer tasks across seven categories.",
    url: "https://livebench.ai",
  },
  lmarena: {
    id: "lmarena",
    label: "LMArena",
    operator: "LMArena",
    budget: 0.1,
    family: "user-preference",
    description: "Anonymous pairwise human preference — covers what objective sets cannot.",
    url: "https://lmarena.ai/leaderboard",
    // One operator, two boards: they split the group's 10% (5% each).
    metrics: [
      { id: "arena-text", label: "Arena Text", share: 0.5 },
      { id: "arena-webdev", label: "Arena WebDev", share: 0.5 },
    ],
  },
  eqbench: {
    id: "eqbench",
    label: "EQ-Bench",
    operator: "EQ-Bench",
    budget: 0.1,
    family: "emotional-understanding",
    description: "Emotional understanding in dialogue; creative writing, longform, Judgemark.",
    url: "https://eqbench.com",
  },
  vals: {
    id: "vals",
    label: "Vals Index",
    operator: "Vals AI",
    budget: 0.1,
    family: "professional-agent",
    description: "Finance and coding tasks; only Overall counts as this source's vote.",
    url: "https://www.vals.ai",
  },
  apex: {
    id: "apex",
    label: "APEX-Agents",
    operator: "APEX",
    budget: 0.1,
    family: "professional-agent",
    description: "Long-horizon banking, consulting and legal tasks.",
    url: "https://www.apexbench.com",
    metrics: [
      { id: "apex-1", label: "APEX metric 1", share: 0.5 },
      { id: "apex-2", label: "APEX metric 2", share: 0.5 },
    ],
  },
  ale: {
    id: "ale",
    label: "Agents' Last Exam",
    operator: "Agents' Last Exam",
    budget: 0.1,
    family: "professional-agent",
    description: "Full split with harness and reasoning-tier detail; scored to the base model.",
    url: "https://agentslastexam.com",
  },
  deepswe: {
    id: "deepswe",
    label: "DeepSWE v1.1",
    operator: "DeepSWE",
    budget: 0.1,
    family: "software-engineering",
    description: "Code models compared under one mini-swe-agent harness.",
    url: "https://deepswe.ai",
  },
  llm2014: {
    id: "llm2014",
    label: "llm2014",
    operator: "llm2014",
    budget: 0.1,
    family: "software-engineering",
    description: "Eight task grades with scaffold detail; scored to the base model.",
    url: "https://llm2014.com",
    metrics: [
      { id: "llm2014-agent", label: "llm2014 Agent", share: 0.5 },
      { id: "llm2014-reasoning", label: "llm2014 Reasoning", share: 0.5 },
    ],
  },
};

/** Cap on how much any one evidence family may contribute in total. */
export const FAMILY_CAP = 0.3;

/**
 * Flatten the groups into individual metrics with their absolute budget.
 * A single-board source is one metric holding the group's whole 10%.
 *
 * @returns {Array<{id, groupId, label, budget, family}>}
 */
export function listMetrics() {
  const out = [];
  for (const group of Object.values(SOURCE_GROUPS)) {
    if (Array.isArray(group.metrics) && group.metrics.length > 0) {
      for (const metric of group.metrics) {
        out.push({
          id: metric.id,
          groupId: group.id,
          label: metric.label,
          budget: group.budget * metric.share,
          family: group.family,
        });
      }
    } else {
      out.push({
        id: group.id,
        groupId: group.id,
        label: group.label,
        budget: group.budget,
        family: group.family,
      });
    }
  }
  return out;
}

/** Total budget per evidence family — used to check the correlated-source cap. */
export function familyTotals() {
  const totals = {};
  for (const metric of listMetrics()) {
    totals[metric.family] = (totals[metric.family] || 0) + metric.budget;
  }
  return totals;
}
