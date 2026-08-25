import { getTargetFormat, resolveTransport } from "../../services/provider.js";
import { getModelSupportedFormats, getModelTargetFormat } from "../../config/providerModels.js";

// Resolve the wire format of the outbound body and the transport that carries it.
//
// Invariant: the transport must speak the format the body is serialized in. A
// multi-endpoint provider picks its endpoint, headers and auth scheme from the
// transport, so a Claude body sent over the OpenAI transport lands on
// /v1/chat/completions with bearer auth — the upstream parses what it can and
// silently drops the rest (images vanish, tool schemas 400).
export function resolveUpstreamRoute({ provider, alias, model, sourceFormat, credentials }) {
  const modelTargetFormat = getModelTargetFormat(alias, model);
  // Per-model guard: when a model declares supportedFormats, only use the
  // sourceFormat-matched transport if that format is declared (opencode-go models
  // differ — kimi/glm only do /chat/completions). Undeclared models keep the
  // upstream default (use the transport), preserving behavior for glm/deepseek/...
  const modelSupportedFormats = getModelSupportedFormats(alias, model);
  const runtimeTransport = resolveTransport(provider, sourceFormat);
  const useTransport = (!modelSupportedFormats || modelSupportedFormats.includes(sourceFormat)) ? runtimeTransport : null;
  const targetFormat = modelTargetFormat || useTransport?.format || getTargetFormat(provider, credentials);
  // Follow targetFormat, not sourceFormat: a model-level targetFormat overrides the
  // matched transport, so the endpoint has to move with it. Providers without a
  // transport for that format resolve to null, i.e. the provider default endpoint.
  const transport = modelTargetFormat ? resolveTransport(provider, modelTargetFormat) : useTransport;
  return { targetFormat, transport };
}
