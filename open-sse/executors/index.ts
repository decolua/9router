import { AntigravityExecutor } from "./antigravity.js";
import { AzureExecutor } from "./azure.js";
import { GeminiCLIExecutor } from "./gemini-cli.js";
import { GithubExecutor } from "./github.js";
import { IFlowExecutor } from "./iflow.js";
import { QoderExecutor } from "./qoder.js";
import { KiroExecutor } from "./kiro.js";
import { CodexExecutor } from "./codex.js";
import { CursorExecutor } from "./cursor.js";
import { VertexExecutor } from "./vertex.js";
import { QwenExecutor } from "./qwen.js";
import { OpenCodeExecutor } from "./opencode.js";
import { OpenCodeGoExecutor } from "./opencode-go.js";
import { GrokWebExecutor } from "./grok-web.js";
import { PerplexityWebExecutor } from "./perplexity-web.js";
import { OllamaLocalExecutor } from "./ollama-local.js";
import { CommandCodeExecutor } from "./commandcode.js";
import { XiaomiTokenplanExecutor } from "./xiaomi-tokenplan.js";
import { MimoFreeExecutor } from "./mimo-free.js";
import { CodeBuddyExecutor } from "./codebuddy.js";
import { TheOldLlmExecutor } from "./theoldllm.js";
import { PhindExecutor } from "./phind.js";
import { HuggingChatExecutor } from "./huggingchat.js";
import { InnerAiExecutor } from "./inner-ai.js";
import { TraeExecutor } from "./trae.js";
import { DefaultExecutor } from "./default.js";
import type { Executor, ExecutorResult, ExecutorSuccess, ExecutorError, JsonValue } from "../types/executor.js";
import { createErrorResult } from "../utils/error.js";

// Wave-contract imports: available to consumers; not called in this dispatch module.
void createErrorResult;
// Type aliases suppress unused-type warnings if strictness tightens; no runtime cost.
type _WaveTypes = ExecutorResult | ExecutorSuccess | ExecutorError | JsonValue;

// The concrete executor classes are .js files; TS infers their method signatures
// from JS shapes that don't carry exact return types (buildUrl: string|undefined,
// buildHeaders: object, execute signal required). The actual runtime behaviour
// matches the Executor contract — the mismatch is annotation-only. Widen via
// this helper rather than editing the JS files.
function asExecutor(instance: unknown): Executor {
  return instance as Executor;
}

const executors: Record<string, Executor> = {
  antigravity: asExecutor(new AntigravityExecutor()),
  azure: asExecutor(new AzureExecutor()),
  "gemini-cli": asExecutor(new GeminiCLIExecutor()),
  github: asExecutor(new GithubExecutor()),
  iflow: asExecutor(new IFlowExecutor()),
  qoder: asExecutor(new QoderExecutor()),
  kiro: asExecutor(new KiroExecutor()),
  codex: asExecutor(new CodexExecutor()),
  cursor: asExecutor(new CursorExecutor()),
  cu: asExecutor(new CursorExecutor()), // Alias for cursor
  vertex: asExecutor(new VertexExecutor("vertex")),
  "vertex-partner": asExecutor(new VertexExecutor("vertex-partner")),
  qwen: asExecutor(new QwenExecutor()),
  opencode: asExecutor(new OpenCodeExecutor()),
  "opencode-go": asExecutor(new OpenCodeGoExecutor()),
  "grok-web": asExecutor(new GrokWebExecutor()),
  "perplexity-web": asExecutor(new PerplexityWebExecutor()),
  "ollama-local": asExecutor(new OllamaLocalExecutor()),
  commandcode: asExecutor(new CommandCodeExecutor()),
  "xiaomi-tokenplan": asExecutor(new XiaomiTokenplanExecutor()),
  "mimo-free": asExecutor(new MimoFreeExecutor()),
  mmf: asExecutor(new MimoFreeExecutor()), // Alias for mimo-free
  codebuddy: asExecutor(new CodeBuddyExecutor()),
  phind: asExecutor(new PhindExecutor()),
  huggingchat: asExecutor(new HuggingChatExecutor()),
  "inner-ai": asExecutor(new InnerAiExecutor()),
  trae: asExecutor(new TraeExecutor()),
};

const defaultCache = new Map<string, Executor>();

export function getExecutor(provider: string): Executor {
  const found = executors[provider];
  if (found !== undefined) return found;
  if (!defaultCache.has(provider)) defaultCache.set(provider, asExecutor(new DefaultExecutor(provider)));
  // Map.get is always defined here: we just set it if absent.
  return defaultCache.get(provider)!;
}

export function hasSpecializedExecutor(provider: string): boolean {
  return executors[provider] !== undefined;
}

export { BaseExecutor } from "./base.js";
export { AntigravityExecutor } from "./antigravity.js";
export { AzureExecutor } from "./azure.js";
export { GeminiCLIExecutor } from "./gemini-cli.js";
export { GithubExecutor } from "./github.js";
export { IFlowExecutor } from "./iflow.js";
export { QoderExecutor } from "./qoder.js";
export { KiroExecutor } from "./kiro.js";
export { CodexExecutor } from "./codex.js";
export { CursorExecutor } from "./cursor.js";
export { VertexExecutor } from "./vertex.js";
export { DefaultExecutor } from "./default.js";
export { QwenExecutor } from "./qwen.js";
export { OpenCodeExecutor } from "./opencode.js";
export { OpenCodeGoExecutor } from "./opencode-go.js";
export { GrokWebExecutor } from "./grok-web.js";
export { PerplexityWebExecutor } from "./perplexity-web.js";
export { OllamaLocalExecutor } from "./ollama-local.js";
export { CommandCodeExecutor } from "./commandcode.js";
export { XiaomiTokenplanExecutor } from "./xiaomi-tokenplan.js";
export { MimoFreeExecutor } from "./mimo-free.js";
export { CodeBuddyExecutor } from "./codebuddy.js";
export { TheOldLlmExecutor } from "./theoldllm.js";
export { PhindExecutor } from "./phind.js";
export { HuggingChatExecutor } from "./huggingchat.js";
export { InnerAiExecutor } from "./inner-ai.js";
export { TraeExecutor } from "./trae.js";
