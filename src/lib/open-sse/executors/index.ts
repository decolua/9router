import { AntigravityExecutor } from "./antigravity";
import { GeminiCLIExecutor } from "./gemini-cli";
import { GithubExecutor } from "./github";
import { IFlowExecutor } from "./iflow";
import { QoderExecutor } from "./qoder";
import { KiroExecutor } from "./kiro";
import { CodexExecutor } from "./codex";
import { CursorExecutor } from "./cursor";
import { VertexExecutor } from "./vertex";
import { QwenExecutor } from "./qwen";
import { OpenCodeExecutor } from "./opencode";
import { DefaultExecutor } from "./default";

const executors: Record<string, any> = {
  antigravity: new AntigravityExecutor(),
  "gemini-cli": new GeminiCLIExecutor(),
  github: new GithubExecutor(),
  iflow: new IFlowExecutor(),
  qoder: new QoderExecutor(),
  kiro: new KiroExecutor(),
  codex: new CodexExecutor(),
  cursor: new CursorExecutor(),
  cu: new CursorExecutor(), // Alias for cursor
  vertex: new VertexExecutor("vertex"),
  "vertex-partner": new VertexExecutor("vertex-partner"),
  qwen: new QwenExecutor(),
  opencode: new OpenCodeExecutor(),
};

const defaultCache = new Map<string, DefaultExecutor>();

export function getExecutor(provider: string) {
  if (executors[provider]) return executors[provider];
  if (!defaultCache.has(provider)) defaultCache.set(provider, new DefaultExecutor(provider));
  return defaultCache.get(provider);
}

export function hasSpecializedExecutor(provider: string) {
  return !!executors[provider];
}

export { BaseExecutor } from "./base";
export { AntigravityExecutor } from "./antigravity";
export { GeminiCLIExecutor } from "./gemini-cli";
export { GithubExecutor } from "./github";
export { IFlowExecutor } from "./iflow";
export { QoderExecutor } from "./qoder";
export { KiroExecutor } from "./kiro";
export { CodexExecutor } from "./codex";
export { CursorExecutor } from "./cursor";
export { VertexExecutor } from "./vertex";
export { DefaultExecutor } from "./default";
export { QwenExecutor } from "./qwen";
export { OpenCodeExecutor } from "./opencode";
