/**
 * Converter: 9router capability resolver → OpenCode model config.
 *
 * Bead: 9r-ocmr.e1.02, e1.03, e1.04
 * PRD:  ADR-002, ADR-003, IFACE-001, IFACE-002, REQ-001–005
 *
 * Maps resolved model capabilities into the OpenCode-supported model-config
 * shape: `{ name, modalities, reasoning, tool_call, attachment, limit,
 *          variants? }`.
 *
 * Deterministic and side-effect free.  Does not write credentials,
 * headers, or unsafe options.
 */

import { resolveModelMetadata } from "@/sse/services/modelMetadataResolver.js";

/**
 * Build reasoning variants for an OpenCode model entry.
 *
 * Bead: 9r-ocmr.e1.04
 * PRD:  ADR-003, REQ-005, VAL-005
 *
 * Returns `undefined` for non-reasoning models.  Each variant uses the
 * OpenCode/AI SDK-compatible `reasoningEffort` key so that variant
 * selection in OpenCode maps cleanly through 9router's runtime translator
 * to any upstream format.
 *
 * @param {object} caps — Capabilities object from getCapabilitiesForModel.
 * @returns {Record<string, { reasoningEffort: string }> | undefined}
 */
export function buildOpenCodeReasoningVariants(caps) {
  if (!caps.reasoning) return undefined;
  return {
    low:    { reasoningEffort: "low" },
    medium: { reasoningEffort: "medium" },
    high:   { reasoningEffort: "high" },
    max:    { reasoningEffort: "max" },
  };
}

/**
 * Build an OpenCode model config entry from resolved capabilities.
 *
 * @param {string|null} provider — Provider ID (optional; used for
 *   provider-specific overrides.  Pass null when the provider is unknown.)
 * @param {string} modelId — Model identifier (may include vendor prefix).
 * @returns {{
 *   name: string,
 *   modalities: { input: string[], output: string[] },
 *   reasoning: boolean,
 *   tool_call: boolean,
 *   attachment: boolean,
 *   limit: { context: number, input: number, output: number },
 *   variants?: Record<string, { reasoningEffort: string }>,
 * }}
 */
export async function buildOpenCodeModelConfig(provider, modelId) {
  const caps = await resolveModelMetadata(provider, modelId);

  // ── Input modalities ──────────────────────────────────────────
  const input = ["text"];
  if (caps.vision) input.push("image");
  if (caps.pdf) input.push("pdf");
  if (caps.audioInput) input.push("audio");
  if (caps.videoInput) input.push("video");

  // ── Output modalities ─────────────────────────────────────────
  const output = ["text"];
  if (caps.imageOutput) output.push("image");
  if (caps.audioOutput) output.push("audio");

  const config = {
    name: modelId,
    modalities: { input, output },
    reasoning: Boolean(caps.reasoning),
    tool_call: Boolean(caps.tools),
    attachment: Boolean(
      caps.vision || caps.pdf || caps.audioInput || caps.videoInput,
    ),
    limit: {
      context: caps.contextWindow,
      input: caps.inputLimit ?? caps.contextWindow,
      output: caps.maxOutput,
    },
  };

  // Attach reasoning variants only for reasoning-capable models (ADR-003).
  const variants = buildOpenCodeReasoningVariants(caps);
  if (variants) config.variants = variants;

  return config;
}

/**
 * Controlled merge of generated and existing OpenCode model config.
 *
 * Bead: 9r-ocmr.e1.03
 * PRD:  ADR-001, REQ-003, VAL-003
 *
 * Merge rules (ADR-001):
 *   - Existing top-level scalar wins over generated.
 *   - `limit`:          generated defaults + existing overrides.
 *   - `options/headers/variants`: generated defaults + existing overrides.
 *   - `modalities`:     existing wins if present; otherwise generated.
 *   - Unknown existing fields are preserved.
 *
 * @param {object} generated - Output of buildOpenCodeModelConfig.
 * @param {object} [existing] - Existing user-edited model entry (may be empty).
 * @returns {object} Merged model config safe to persist.
 */
export function mergeOpenCodeModelConfig(generated, existing = {}) {
  return {
    ...generated,
    ...existing,
    modalities: existing.modalities ?? generated.modalities,
    limit: { ...generated.limit, ...(existing.limit ?? {}) },
    options: { ...(generated.options ?? {}), ...(existing.options ?? {}) },
    headers: { ...(generated.headers ?? {}), ...(existing.headers ?? {}) },
    variants: { ...(generated.variants ?? {}), ...(existing.variants ?? {}) },
  };
}
