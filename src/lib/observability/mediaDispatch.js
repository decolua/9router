import { currentInference, noteAttempt, bindInference } from "./requestContext.js";
import { observeConnection } from "./providerHealth.js";
import { classifyInferenceError } from "open-sse/services/inferenceError.js";

// Media adapters keep ownership of exact token accounting (some deliver usage after SSE EOF).
export async function dispatchMedia(core, args) {
  const trace = currentInference();
  if (!trace) return core(args);
  const target = args.modelInfo ?? args;
  const provider = typeof target.provider === "string" ? target.provider : target.provider?.id;
  const model = target.model ?? args.body?.model ?? provider;
  const id = args.credentials?.connectionId ?? null;
  noteAttempt(provider, model, id);
  const result = await core(args.onUsage ? { ...args, onUsage: bindInference(args.onUsage) } : args);
  trace.failure = result.success ? null : classifyInferenceError({ status: result.status, body: result.error, headers: result.response?.headers });
  await observeConnection(id, trace.failure);
  return result;
}
