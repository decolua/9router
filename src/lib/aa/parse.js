/**
 * Artificial Analysis leaderboard parser.
 *
 * The leaderboard page ships its data inside Next.js RSC flight chunks
 * (`self.__next_f.push([1,"..."])`) rather than a single __NEXT_DATA__ blob, and
 * one logical chunk is split across several pushes — so we decode every push,
 * concatenate, then bracket-match the models array out of the joined text.
 *
 * The official /api/v2 endpoint needs an API key (401 without one); the public
 * page does not, which is why we parse HTML here.
 *
 * Every function is total: malformed input yields an empty result rather than a
 * throw, so a page redesign degrades to "stale data" instead of breaking sync.
 */

const PUSH_PREFIX = 'self.__next_f.push([1,"';
const MODELS_KEY = '"models":[';

/**
 * Read the JS string literal starting at `start` (the index of its opening
 * quote) and return the decoded value plus the index just past its closing
 * quote. Respects backslash escapes.
 */
function readStringLiteral(html, start) {
  let i = start + 1;
  while (i < html.length) {
    const ch = html[i];
    if (ch === "\\") { i += 2; continue; }
    if (ch === '"') break;
    i += 1;
  }
  const raw = html.slice(start, i + 1);
  try {
    return { value: JSON.parse(raw), end: i + 1 };
  } catch {
    return { value: "", end: i + 1 };
  }
}

/** Decode and concatenate every RSC flight push in the document. */
export function extractFlightPayload(html) {
  if (typeof html !== "string" || !html) return "";
  const parts = [];
  let cursor = 0;
  while (true) {
    const found = html.indexOf(PUSH_PREFIX, cursor);
    if (found === -1) break;
    const quoteAt = found + PUSH_PREFIX.length - 1;
    const { value, end } = readStringLiteral(html, quoteAt);
    if (value) parts.push(value);
    cursor = end;
  }
  return parts.join("");
}

/**
 * Slice a balanced JSON array starting at `start` (index of the opening `[`),
 * skipping brackets that appear inside string literals.
 */
function sliceBalancedArray(text, start) {
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === "\\") { i += 1; continue; }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === "[") depth += 1;
    else if (ch === "]") {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * Pull the model records out of decoded flight text. Picks the largest valid
 * `"models":[...]` array — the page carries several smaller ones (nav widgets,
 * comparison pickers) and we want the leaderboard's full set.
 */
export function extractModelsArray(flightText) {
  if (typeof flightText !== "string" || !flightText) return [];
  let best = [];
  let cursor = 0;
  while (true) {
    const found = flightText.indexOf(MODELS_KEY, cursor);
    if (found === -1) break;
    const arrayStart = found + MODELS_KEY.length - 1;
    cursor = arrayStart + 1;
    const slice = sliceBalancedArray(flightText, arrayStart);
    if (!slice) continue;
    try {
      const parsed = JSON.parse(slice);
      if (Array.isArray(parsed) && parsed.length > best.length &&
          parsed.some((m) => m && typeof m === "object" && "intelligenceIndex" in m)) {
        best = parsed;
      }
    } catch {
      // Not a data array (or split across a boundary we cannot recover) — skip.
    }
  }
  return best;
}

function finiteOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Blended $/1M price. AA exposes several shapes across page versions, so we take
 * the first numeric one and fall back to deriving it from input/output at the
 * conventional 3:1 blend.
 */
function blendedPrice(raw) {
  const direct = finiteOrNull(raw.price1mBlended3To1) ?? finiteOrNull(raw.priceBlended) ??
    finiteOrNull(raw.price1mBlended);
  if (direct !== null) return direct;
  const input = finiteOrNull(raw.price1mInputTokens) ?? finiteOrNull(raw.priceInput);
  const output = finiteOrNull(raw.price1mOutputTokens) ?? finiteOrNull(raw.priceOutput);
  if (input === null || output === null) return null;
  return input * 0.75 + output * 0.25;
}

/** Map one AA record to the fields we rank on. Unknown metrics stay null. */
export function normalizeAaModel(raw) {
  if (!raw || typeof raw !== "object" || !raw.slug) return null;
  return {
    slug: String(raw.slug),
    name: String(raw.name || raw.shortName || raw.slug),
    creator: raw.modelCreatorName ? String(raw.modelCreatorName) : null,
    creatorSlug: raw.modelCreatorSlug ? String(raw.modelCreatorSlug) : null,
    openrouterApiId: raw.openrouterApiId ? String(raw.openrouterApiId) : null,
    releaseDate: raw.releaseDate ? String(raw.releaseDate) : null,
    deprecated: raw.deprecated === true,
    isReasoning: raw.isReasoning === true,
    intelligenceIndex: finiteOrNull(raw.intelligenceIndex),
    intelligenceIsEstimated: raw.intelligenceIndexIsEstimated === true,
    codingIndex: finiteOrNull(raw.codingIndex),
    agenticIndex: finiteOrNull(raw.agenticIndex),
    tau2: finiteOrNull(raw.tau2),
    priceBlended: blendedPrice(raw),

    // Individual benchmarks AA publishes next to the indices. The dimension
    // presets (coding / research / office / knowledge) are built from these
    // rather than from the indices, because a single index cannot say which KIND
    // of work a model is good at.
    terminalBench40: finiteOrNull(raw.terminalBench40),
    terminalbenchHard: finiteOrNull(raw.terminalbenchHard),
    scicode: finiteOrNull(raw.scicode),
    critpt: finiteOrNull(raw.critpt),
    hle: finiteOrNull(raw.hle),
    gpqa: finiteOrNull(raw.gpqa),
    lcr: finiteOrNull(raw.lcr),
    ifbench: finiteOrNull(raw.ifbench),
    omniscience: finiteOrNull(raw.omniscience),
    omniscienceNonHallucination: finiteOrNull(raw.omniscienceNonHallucination),
    tauBanking: finiteOrNull(raw.tauBanking),
    apexAgents: finiteOrNull(raw.apexAgents),
    gdpvalNormalized: finiteOrNull(raw.gdpvalNormalized),
    itbenchSre: finiteOrNull(raw.itbenchSre),
    analystAgent: finiteOrNull(raw.analystAgent),
    mmmuPro: finiteOrNull(raw.mmmuPro),
  };
}

/**
 * Parse a leaderboard HTML document.
 * @returns {{models: Array, count: number}} empty models on any parse failure
 */
export function parseAaLeaderboard(html) {
  const flight = extractFlightPayload(html);
  const raw = extractModelsArray(flight);
  const models = raw.map(normalizeAaModel).filter(Boolean);
  // Same slug can appear per-variant (reasoning / non-reasoning); keep the
  // strongest so a combo entry maps to that model's best measured showing.
  const bySlug = new Map();
  for (const model of models) {
    const prev = bySlug.get(model.slug);
    if (!prev || (model.intelligenceIndex ?? -1) > (prev.intelligenceIndex ?? -1)) {
      bySlug.set(model.slug, model);
    }
  }
  return { models: [...bySlug.values()], count: bySlug.size };
}
