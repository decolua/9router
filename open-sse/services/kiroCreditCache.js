import { createHash } from "node:crypto";
import { resolveKiroCachePolicy, KIRO_CACHE_LIMITS as LIMIT } from "../config/kiroConstants.js";

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  }
  return value;
}
const hash = value => createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");

// Hash the translated, outbound semantics, not inbound metadata or byte prefixes.
// Current and historical users share a wrapper. Only transport identity is omitted;
// text (including time context), tools, images and tool results stay ordered and exact.
function profile(body, policy) {
  const state = body.conversationState;
  const current = state.currentMessage.userInputMessage;
  const { conversationState: _state, profileArn: _profile, inferenceConfig: _inference, ...prelude } = body;
  const { history, currentMessage: _current, conversationId: _id, ...shape } = state;
  let fingerprint = hash([prelude, shape]);
  let tokens = 0;
  const blocks = [];
  const add = value => {
    const json = JSON.stringify(canonical(value));
    tokens += Math.ceil(json.length / 4);
    fingerprint = hash([fingerprint, hash(value)]);
    if (tokens >= policy.minTokens) blocks.push({ fingerprint, tokens });
  };
  for (const tool of current.userInputMessageContext?.tools || []) add({ tool });
  for (const message of [...(history || []), { userInputMessage: current }]) {
    if (!message.userInputMessage) { add(message); continue; }
    const user = { ...message.userInputMessage };
    // Historical turns may omit the current turn's transport defaults.
    user.origin ??= current.origin;
    user.modelId ??= current.modelId;
    if (user.userInputMessageContext) {
      user.userInputMessageContext = { ...user.userInputMessageContext };
      delete user.userInputMessageContext.tools;
      if (!Object.keys(user.userInputMessageContext).length) delete user.userInputMessageContext;
    }
    add({ userInputMessage: user });
  }
  return blocks.length ? { blocks, tokens } : null;
}

function creditDensity(observation) {
  let total = observation.totalTokens;
  if (!Number.isSafeInteger(total) || total <= 0) {
    if (!Number.isSafeInteger(observation.inputTokens) || observation.inputTokens < 0) return null;
    total = observation.inputTokens + observation.outputTokens;
  }
  if (!Number.isSafeInteger(total) || total <= 0) return null;
  const density = observation.credits / total;
  return Number.isFinite(density) && density > 0 ? density : null;
}

// Cached input still incurs credits. Convert savings to reuse only when the
// family has a discount model; an uncalibrated policy keeps its legacy savings.
export function inferKiroCacheReuse(creditSavings, policy) {
  if (policy?.cachedCreditRatio === undefined) return creditSavings;
  return Math.max(0, Math.min(1, creditSavings / (1 - policy.cachedCreditRatio)));
}

/** Bounded, process-local conservative calibration from comparable native credits. */
export class KiroCreditCache {
  constructor({ now = Date.now, staticReadRatio = LIMIT.maxSavings } = {}) {
    this.now = now;
    this.staticReadRatio = Number.isFinite(staticReadRatio) ? Math.max(0, Math.min(1, staticReadRatio)) : 0;
    this.scopes = new Map();
  }

  prepare({ body, credentials, endpoint }) {
    const state = body?.conversationState;
    const model = state?.currentMessage?.userInputMessage?.modelId;
    const policy = resolveKiroCachePolicy(model);
    if (!policy || !endpoint || (policy.conversationScoped && !state.conversationId)) return null;
    const data = credentials?.providerSpecificData || {};
    const apiKey = data.authMethod === "api_key" ? (credentials.apiKey || credentials.accessToken) : null;
    const account = credentials?.connectionId || credentials?.apiKey || credentials?.accessToken;
    if (!account || (data.authMethod === "api_key" && !apiKey)) return null;
    const p = profile(body, policy);
    if (!p) return null;
    const owner = hash(account);
    const shape = hash(body.inferenceConfig || {});
    const key = hash([owner, apiKey || "", data.userId, data.principalId,
      data.authMethod, body.profileArn, endpoint, model, shape, policy.conversationScoped ? state.conversationId : ""]);
    const started = this.now();
    this.prune(started);
    let scope = this.scopes.get(key);
    if (!scope) {
      if (this.scopes.size >= LIMIT.scopes ||
          [...this.scopes.values()].filter(s => s.owner === owner).length >= LIMIT.accountScopes) return null;
      scope = { owner, expires: started + LIMIT.calibrationTtlMs, active: 0, epoch: 0,
        prefixes: new Map(), samples: new Map(), pairs: [] };
      this.scopes.set(key, scope);
    }
    let matched = 0;
    for (const b of p.blocks) {
      if (scope.prefixes.get(b.fingerprint) > started) matched = b.tokens;
    }
    const exclusive = scope.active === 0;
    const epoch = ++scope.epoch;
    scope.active++;
    // An available dynamic zero is authoritative; fallback is only for startup.
    const reuse = scope.pairs.length >= LIMIT.minPairs
      ? inferKiroCacheReuse(Math.min(LIMIT.maxSavings, ...scope.pairs.map(pair => pair.creditSavings)), policy)
      : this.staticReadRatio;
    const fraction = reuse * matched / p.tokens;
    let done = false;
    return {
      apply(usage) {
        // OpenAI prompt_tokens is inclusive. Native cache metrics take precedence,
        // including explicit zero; cache creation is never invented from credits.
        if (!usage || usage.prompt_tokens_details || usage.cache_read_input_tokens !== undefined ||
            usage.cache_creation_input_tokens !== undefined) return usage;
        const read = Math.floor(usage.prompt_tokens * fraction);
        return read > 0 ? { ...usage, prompt_tokens_details: { cached_tokens: read } } : usage;
      },
      complete: (observation, success) => {
        if (done) return;
        done = true;
        scope.active--;
        const now = this.now();
        const expires = started + policy.ttlMs;
        if (!success || !observation?.complete || !Number.isFinite(observation.credits) ||
            observation.credits <= 0 || !Number.isSafeInteger(observation.outputTokens) ||
            observation.outputTokens < 0 || expires <= now || this.scopes.get(key) !== scope) return;
        // Overlapping native generations can combine unrelated billing/cache effects.
        // They may renew exact prefixes, but cannot contribute calibration pairs.
        const density = creditDensity(observation);
        if (exclusive && epoch === scope.epoch && density !== null) {
          const sampleKey = fingerprint => hash([shape, fingerprint]);
          if (!matched) {
            const k = sampleKey(p.blocks.at(-1).fingerprint);
            const old = scope.samples.get(k);
            if (!old || old.expires <= now || density < old.coldDensity) {
              if (old || scope.samples.size < LIMIT.samples) scope.samples.set(k, {
                coldDensity: density, expires: now + LIMIT.calibrationTtlMs
              });
            }
          } else {
            for (const b of [...p.blocks].reverse()) {
              if (b.tokens > matched) continue;
              const cold = scope.samples.get(sampleKey(b.fingerprint));
              if (!cold || cold.expires <= now) continue;
              // Compare credits per total token so varying output lengths can pair.
              // Keep the lowest cold density and rolling savings lower envelope;
              // no input/output price split or exact cache rate is inferred.
              scope.pairs.push({ creditSavings: Math.max(0, Math.min(LIMIT.maxSavings,
                (cold.coldDensity - density) / cold.coldDensity)), expires: now + LIMIT.calibrationTtlMs });
              scope.pairs = scope.pairs.slice(-LIMIT.pairs);
              break;
            }
          }
        }
        scope.expires = now + LIMIT.calibrationTtlMs;
        for (const b of p.blocks) {
          const old = scope.prefixes.get(b.fingerprint);
          if (old || scope.prefixes.size < LIMIT.prefixes) {
            scope.prefixes.set(b.fingerprint, Math.max(old || 0, expires));
          }
        }
      }
    };
  }

  prune(now) {
    for (const [key, scope] of this.scopes) {
      if (scope.expires <= now && scope.active === 0) { this.scopes.delete(key); continue; }
      for (const [fp, expires] of scope.prefixes) if (expires <= now) scope.prefixes.delete(fp);
      for (const [key, sample] of scope.samples) if (sample.expires <= now) scope.samples.delete(key);
      scope.pairs = scope.pairs.filter(pair => pair.expires > now);
    }
  }
}

export const kiroCreditCache = new KiroCreditCache();
