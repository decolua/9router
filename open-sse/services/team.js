/**
 * Team combo strategy — an internal multi-agent pipeline behind a single API call.
 *
 * Pipeline (all stages internal / non-streaming / tools stripped, except the final
 * compressor call which keeps the client's stream flag + tools):
 *
 *   Planner ─► plan
 *      │ (planReview) Plan Reviewer revises the plan once
 *      ▼
 *   ┌─ LOOP (≤ maxIters) ───────────────────────────────────┐
 *   │ Worker    ─► answer (plan + prior feedback)             │
 *   │ Reviewers ─► critiques (parallel panel via collectPanel)│
 *   │ Judge     ─► { score, feedback } (synthesise)           │
 *   │ score ≥ passThreshold ? break : feed feedback back ─────┘
 *      ▼ (pass, or cap → best-scored iteration)
 *   Compressor ("turn into haiku") ─► condense into the final streamed answer
 *
 * Fail-open at every stage: a failed role degrades the pipeline; it never throws.
 * Reuses the fusion primitives (panel collection, prose extraction, turn append)
 * from combo.js and the fallback-error classifier from accountFallback.js.
 */

import {
  appendUserTurn,
  extractPanelText,
  collectPanel,
  withTimeout,
  flattenToolHistory,
  FUSION_DEFAULTS,
} from "./combo.js";
import { checkFallbackError } from "./accountFallback.js";

// Loop / role defaults. Overridable per-combo via settings.comboStrategies[name].team.
const TEAM_DEFAULTS = {
  maxIters: 2,
  passThreshold: 8,
  planReview: true,
};

function toChain(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  return value ? [value] : [];
}

// Strip tools + force non-streaming for an internal stage, flattening tool turns
// to prose so internal models keep context without emitting tool_calls.
function internalBody(body) {
  const { tools, tool_choice, ...rest } = body;
  const next = { ...rest, stream: false };
  if (Array.isArray(next.messages)) next.messages = flattenToolHistory(next.messages);
  else if (Array.isArray(next.input)) next.input = flattenToolHistory(next.input);
  return next;
}

/**
 * Invoke a single-slot role as a fallback chain: try each model in order, return the
 * first response that is ok. On a non-ok response, consult checkFallbackError to decide
 * whether to move on (a non-fallback error short-circuits and returns that response).
 * A thrown error always falls through to the next model. Returns null if the chain is
 * fully exhausted with no usable response.
 *
 * @returns {Promise<Response|null>}
 */
async function callRole(models, body, handleSingleModel, log, roleName) {
  const chain = toChain(models);
  let lastRes = null;
  for (const model of chain) {
    let res;
    try {
      res = await handleSingleModel(body, model, true);
    } catch (e) {
      log.warn("TEAM", `${roleName} ${model} threw`, { error: e?.message || String(e) });
      continue;
    }
    if (res && res.ok) return res;
    lastRes = res;
    const status = res?.status ?? 0;
    const { shouldFallback } = checkFallbackError(status, "");
    log.warn("TEAM", `${roleName} ${model} failed (status ${status})${shouldFallback ? " — falling through" : ""}`);
    if (!shouldFallback) return res; // non-fallback error: surface it, stop the chain
  }
  return lastRes && lastRes.ok ? lastRes : null;
}

// Read prose out of a role Response, or "" if it can't be parsed.
async function readText(res) {
  if (!res) return "";
  try {
    return extractPanelText(await res.clone().json()) || "";
  } catch {
    return "";
  }
}

function buildPlannerPrompt() {
  return [
    "You are the PLANNER on an engineering team.",
    "Produce a concise, ordered plan for how to best answer the user's most recent request.",
    "Focus on approach, key points to cover, and pitfalls to avoid. Output only the plan.",
  ].join(" ");
}

function buildPlanReviewPrompt(plan) {
  return [
    "You are the PLAN REVIEWER. A draft plan for answering the user's request is below.",
    "Tighten it: fix gaps, remove filler, sharpen the approach. Output only the improved plan.",
    "",
    "=== DRAFT PLAN ===",
    plan,
    "=== END DRAFT PLAN ===",
  ].join("\n");
}

function buildWorkerPrompt(plan, feedback) {
  const parts = ["You are the WORKER. Answer the user's most recent request directly and completely."];
  if (plan) parts.push("", "Follow this plan:", plan);
  if (feedback) parts.push("", "Reviewers flagged these issues with your previous attempt — fix them:", feedback);
  parts.push("", "Output only the answer to the user.");
  return parts.join("\n");
}

function buildReviewerPrompt(answer) {
  return [
    "You are a REVIEWER. Critique the candidate answer below for correctness, completeness, and clarity.",
    "List concrete flaws, omissions, and errors. Be specific and terse. Do not rewrite the answer.",
    "",
    "=== CANDIDATE ANSWER ===",
    answer,
    "=== END CANDIDATE ANSWER ===",
  ].join("\n");
}

function buildSynthesisPrompt(answer, critiques) {
  const panel = critiques.map((c, i) => `[Reviewer ${i + 1}]\n${c}`).join("\n\n");
  return [
    "You are the JUDGE synthesising reviewer feedback on a candidate answer.",
    "Weigh the critiques, discard the wrong ones, and decide how good the answer is.",
    'Respond with ONLY a JSON object: {"score": <0-10 integer>, "feedback": "<what the worker must fix, empty if none>"}.',
    "",
    "=== CANDIDATE ANSWER ===",
    answer,
    "=== END CANDIDATE ANSWER ===",
    "",
    "=== REVIEWS ===",
    panel,
    "=== END REVIEWS ===",
  ].join("\n");
}

function buildCompressorPrompt(answer) {
  return [
    "Condense the approved answer below into its tightest complete form for the user.",
    "Preserve every substantive point; drop filler, hedging, and repetition. Keep the user's original language/format.",
    "Output only the final answer.",
    "",
    "=== APPROVED ANSWER ===",
    answer,
    "=== END APPROVED ANSWER ===",
  ].join("\n");
}

// Parse the judge's JSON verdict defensively. Unparseable → treat as a fail (score 0)
// and hand the raw text back as feedback, but never throw.
function parseVerdict(text) {
  if (!text) return { score: 0, feedback: "" };
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try {
      const obj = JSON.parse(text.slice(start, end + 1));
      const score = Number(obj.score);
      return {
        score: Number.isFinite(score) ? score : 0,
        feedback: typeof obj.feedback === "string" ? obj.feedback : "",
      };
    } catch { /* fall through */ }
  }
  return { score: 0, feedback: text };
}

function jsonResponse(payload, status) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Handle a team combo. See the file header for the pipeline.
 *
 * @param {Object} options
 * @param {Object} options.body - Request body (client format)
 * @param {string[]} options.models - Combo model list (role default source)
 * @param {Function} options.handleSingleModel - (body, modelStr, isInternal) => Promise<Response>
 * @param {Object} options.log - Logger
 * @param {string} [options.comboName] - Combo name (logging)
 * @param {Object} [options.team] - Role + loop config (see TEAM_DEFAULTS / spec)
 * @returns {Promise<Response>}
 */
export async function handleTeamChat({ body, models, handleSingleModel, log, comboName, team }) {
  const list = Array.isArray(models) ? models.filter(Boolean) : [];
  if (list.length === 0) {
    return jsonResponse({ error: { message: "Team combo has no models" } }, 400);
  }

  const cfg = { ...TEAM_DEFAULTS, ...(team || {}) };
  const roles = {
    planner: toChain(cfg.planner).length ? toChain(cfg.planner) : [list[0]],
    worker: toChain(cfg.worker).length ? toChain(cfg.worker) : [list[0]],
    reviewers: toChain(cfg.reviewers).length ? toChain(cfg.reviewers) : list,
    judge: toChain(cfg.judge).length ? toChain(cfg.judge) : [list[0]],
  };
  roles.compressor = toChain(cfg.compressor).length ? toChain(cfg.compressor) : roles.judge;
  const maxIters = Math.max(1, Number(cfg.maxIters) || TEAM_DEFAULTS.maxIters);
  const passThreshold = Number.isFinite(Number(cfg.passThreshold)) ? Number(cfg.passThreshold) : TEAM_DEFAULTS.passThreshold;

  // Nothing to orchestrate when every role resolves to the same single model.
  const distinct = new Set([
    ...roles.planner, ...roles.worker, ...roles.reviewers, ...roles.judge, ...roles.compressor,
  ]);
  if (distinct.size <= 1) {
    log.info("TEAM", `Combo "${comboName}" resolves to a single model — answering directly`);
    return handleSingleModel(body, [...distinct][0] || list[0]);
  }

  log.info("TEAM", `Combo "${comboName}" | worker=[${roles.worker.join(",")}] reviewers=[${roles.reviewers.join(",")}] judge=[${roles.judge.join(",")}] maxIters=${maxIters} pass>=${passThreshold}`);

  const internal = internalBody(body);

  // 1. Plan.
  let plan = "";
  const plannerRes = await callRole(roles.planner, appendUserTurn(internal, buildPlannerPrompt()), handleSingleModel, log, "planner");
  plan = await readText(plannerRes);
  if (!plan) log.warn("TEAM", "Planner produced no plan — worker will answer the raw prompt");

  // 1b. Optional plan review.
  if (plan && cfg.planReview) {
    const reviewRes = await callRole(roles.planner, appendUserTurn(internal, buildPlanReviewPrompt(plan)), handleSingleModel, log, "plan-reviewer");
    const revised = await readText(reviewRes);
    if (revised) plan = revised;
  }

  // 2. Worker → Reviewers → Judge loop.
  let best = null; // { answer, score }
  let feedback = "";
  for (let iter = 1; iter <= maxIters; iter++) {
    const workerRes = await callRole(roles.worker, appendUserTurn(internal, buildWorkerPrompt(plan, feedback)), handleSingleModel, log, "worker");
    const answer = await readText(workerRes);
    if (!answer) {
      log.warn("TEAM", `Worker produced nothing on iteration ${iter}`);
      if (best) break; // keep the best prior iteration
      return jsonResponse({ error: { message: "Team worker failed to produce an answer" } }, 503);
    }

    // Reviewers — parallel panel.
    const tuning = FUSION_DEFAULTS;
    const reviewCalls = roles.reviewers.map((m) =>
      withTimeout(handleSingleModel(appendUserTurn(internal, buildReviewerPrompt(answer)), m, true), tuning.panelHardTimeoutMs));
    const settled = await collectPanel(reviewCalls, { ...tuning, minPanel: Math.min(tuning.minPanel, roles.reviewers.length) });
    const critiques = [];
    for (const res of settled) {
      if (!res || res.__timeout || res.__error || !res.ok) continue;
      const text = await readText(res);
      if (text) critiques.push(text);
    }

    // No usable critiques → accept this answer as-is (nothing to judge/refine).
    if (critiques.length === 0) {
      log.warn("TEAM", `No reviewer critiques on iteration ${iter} — accepting worker answer`);
      best = { answer, score: passThreshold };
      break;
    }

    // Judge synthesises a score + actionable feedback.
    const judgeRes = await callRole(roles.judge, appendUserTurn(internal, buildSynthesisPrompt(answer, critiques)), handleSingleModel, log, "judge");
    const verdict = parseVerdict(await readText(judgeRes));
    log.info("TEAM", `Iteration ${iter}: score=${verdict.score} (pass>=${passThreshold})`);

    if (!best || verdict.score > best.score) best = { answer, score: verdict.score };
    if (verdict.score >= passThreshold) break;
    feedback = verdict.feedback || "Improve correctness, completeness, and clarity.";
  }

  if (!best) {
    return jsonResponse({ error: { message: "Team produced no answer" } }, 503);
  }

  // 3. Compressor → the only client-facing, streamed call. Falls back to the
  // approved answer verbatim if the compressor chain is exhausted.
  const compBody = { ...appendUserTurn(body, buildCompressorPrompt(best.answer)) };
  const chain = roles.compressor;
  for (const model of chain) {
    let res;
    try {
      res = await handleSingleModel(compBody, model, false);
    } catch (e) {
      log.warn("TEAM", `compressor ${model} threw`, { error: e?.message || String(e) });
      continue;
    }
    if (res && res.ok) return res;
    log.warn("TEAM", `compressor ${model} failed (status ${res?.status ?? 0})`);
  }

  log.warn("TEAM", "Compressor exhausted — returning the approved answer uncompressed");
  return jsonResponse({
    choices: [{ index: 0, message: { role: "assistant", content: best.answer }, finish_reason: "stop" }],
  }, 200);
}
