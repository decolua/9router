/**
 * Model identity: base model vs evaluation configuration.
 *
 * Leaderboards publish the same underlying model under many configurations —
 * `claude-fable-5-max-effort`, `gpt-5.6-sol-max`, `claude-4-1-opus-thinking-32k`.
 * Treated as distinct models these never join across sources, so a model
 * evaluated everywhere still looks like it has one board's worth of evidence.
 *
 * The ranking subject is therefore the BASE model, and a reasoning tier, harness
 * or scaffold is an evaluation configuration attached to it. A date stamp is NOT
 * a configuration: it identifies a genuinely different set of weights and stays
 * part of the identity.
 *
 * Caveat worth knowing: `preview`/`latest` are stripped downstream by
 * `normalizeModelId` (inherited from the existing matcher), so a preview and its
 * GA release do end up sharing a key. That is a deliberate carry-over rather
 * than something this module decides — it is why `baseModelOf` leaves those tags
 * alone instead of compounding the effect.
 *
 * Crucially, the representative configuration is chosen by a fixed priority
 * decided BEFORE any score is read. Picking the best-scoring configuration would
 * let every model be represented by whatever setting flattered it most, which
 * silently rewards vendors that publish many tiers.
 */

/**
 * Evaluation-configuration suffixes, in fixed preference order.
 *
 * Earlier entries win when one source publishes several configurations of the
 * same base model. The bare model (no suffix at all) always wins outright: it is
 * the vendor's own default, which is what a router actually calls.
 */
const CONFIG_SUFFIXES = [
  // Reasoning effort / thinking tiers
  "-max-effort", "-max", "-xhigh", "-high", "-medium", "-low", "-minimal",
  "-extra-low", "-thinking", "-reasoning", "-non-reasoning",
  // Harness / scaffold / serving detail
  "-base", "-agent", "-agentic", "-scaffold", "-tools", "-chat", "-instruct", "-it",
  "-fp8-fast", "-fp8", "-int8", "-int4", "-awq", "-gptq", "-bf16",
];

/** `-thinking-32k`, `-32k`, `-128k` — a context/budget qualifier on a tier. */
const BUDGET_SUFFIX = /-\d+k$/i;

/**
 * Strip evaluation-configuration suffixes to reach the base model id.
 *
 * Applied repeatedly because sources stack them (`-thinking-32k`, `-high-fp8`).
 * Never strips a date, `preview` or `beta` — those identify different weights.
 *
 * @param {string} slug
 * @returns {string}
 */
export function baseModelOf(slug) {
  let id = String(slug || "").trim().toLowerCase();
  if (!id) return "";

  let changed = true;
  while (changed) {
    changed = false;

    if (BUDGET_SUFFIX.test(id)) {
      const stripped = id.replace(BUDGET_SUFFIX, "");
      // Only a qualifier if something recognisable remains.
      if (stripped.length > 3) {
        id = stripped;
        changed = true;
      }
    }

    for (const suffix of CONFIG_SUFFIXES) {
      if (id.endsWith(suffix) && id.length > suffix.length + 2) {
        id = id.slice(0, -suffix.length);
        changed = true;
      }
    }
  }

  return id;
}

/** The configuration part that was stripped, or null for a bare model. */
export function configOf(slug) {
  const full = String(slug || "").trim().toLowerCase();
  const base = baseModelOf(full);
  if (!base || base === full) return null;
  return full.slice(base.length).replace(/^-/, "") || null;
}

/**
 * Preference rank of a configuration — lower is preferred.
 * The bare model is 0; anything else follows CONFIG_SUFFIXES order.
 */
export function configPriority(slug) {
  const config = configOf(slug);
  if (!config) return 0;
  const index = CONFIG_SUFFIXES.findIndex((s) => s.slice(1) === config);
  // Unknown configurations sort after known ones but before nothing.
  return index === -1 ? CONFIG_SUFFIXES.length + 1 : index + 1;
}

/**
 * Reduce one board's entries to a single representative per base model.
 *
 * @param {Array<{slug:string}>} entries
 * @returns {Array} one entry per base model, each tagged with `baseModel` and
 *   `configurations` (every configuration seen, for audit)
 */
export function selectRepresentatives(entries) {
  const byBase = new Map();

  for (const entry of entries || []) {
    const slug = entry?.slug;
    if (!slug) continue;
    const base = baseModelOf(slug);
    if (!base) continue;

    if (!byBase.has(base)) byBase.set(base, []);
    byBase.get(base).push(entry);
  }

  const out = [];
  for (const [base, candidates] of byBase) {
    candidates.sort((a, b) => {
      const pa = configPriority(a.slug);
      const pb = configPriority(b.slug);
      if (pa !== pb) return pa - pb;
      // Deterministic tie-break, still independent of score: the shorter id is
      // closer to the plain model.
      if (a.slug.length !== b.slug.length) return a.slug.length - b.slug.length;
      return a.slug.localeCompare(b.slug);
    });

    out.push({
      ...candidates[0],
      baseModel: base,
      configurations: candidates.map((c) => c.slug),
    });
  }

  return out;
}
