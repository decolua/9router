import { AntigravityExecutor } from "./antigravity.js";
import { AzureExecutor } from "./azure.js";
import { BedrockExecutor } from "./bedrock.js";
import { GeminiCLIExecutor } from "./gemini-cli.js";
import { GeminiWebExecutor } from "./gemini-web.js";
import { GithubExecutor } from "./github.js";
import { IFlowExecutor } from "./iflow.js";
import { QoderExecutor } from "./qoder.js";
import { KiroExecutor } from "./kiro.js";
import { KimchiExecutor } from "./kimchi.js";
import { CodexExecutor } from "./codex.js";
import { CursorExecutor } from "./cursor.js";
import { VertexExecutor } from "./vertex.js";
import { OpenCodeExecutor } from "./opencode.js";
import { OpenCodeGoExecutor } from "./opencode-go.js";
import { OpenCodeZenExecutor } from "./opencode-zen.js";
import { OpenCodeV2Executor } from "./opencodeV2.js";
import { OpenCodeLaneExecutor } from "./opencodeLane.js";
import { GrokCliExecutor } from "./grok-cli.js";
import { OllamaLocalExecutor } from "./ollama-local.js";
import { CommandCodeExecutor } from "./commandcode.js";
import { XiaomiTokenplanExecutor } from "./xiaomi-tokenplan.js";
import { XiaomiMimoExecutor } from "./xiaomi-mimo.js";
import { MimoFreeExecutor } from "./mimo-free.js";
import { CodeBuddyExecutor } from "./codebuddy-cn.js";
import { CodeBuddyIntlExecutor } from "./codebuddy-intl.js";
import TraeExecutor from "./trae.js";
import ZedExecutor from "./zed.js";
import WindsurfExecutor from "./windsurf.js";
import { DefaultExecutor } from "./default.js";
import { MinimaxCodeExecutor } from "./minimax-code.js";
import { DevinCliExecutor } from "./devin-cli.js";
import { DeepSeekWebExecutor } from "./deepseek-web.js";
import { ZCodeExecutor } from "./zcode.js";

const executors = {
  antigravity: new AntigravityExecutor(),
  azure: new AzureExecutor(),
  "gemini-cli": new GeminiCLIExecutor(),
  "gemini-web": new GeminiWebExecutor(),
  gweb: new GeminiWebExecutor(),
  "gemini-cookie": new GeminiWebExecutor(),
  github: new GithubExecutor(),
  iflow: new IFlowExecutor(),
  qoder: new QoderExecutor(),
  "qoder-cn": new QoderExecutor("qoder-cn"),
  kiro: new KiroExecutor(),
  kimchi: new KimchiExecutor(),
  codex: new CodexExecutor(),
  cursor: new CursorExecutor(),
  cu: new CursorExecutor(), // Alias for cursor
  vertex: new VertexExecutor("vertex"),
  "vertex-partner": new VertexExecutor("vertex-partner"),
  opencode: new OpenCodeLaneExecutor("opencode"),
  oc: new OpenCodeLaneExecutor("opencode"),
  "opencode-go": new OpenCodeGoExecutor(),
  "opencode-zen": new OpenCodeZenExecutor(),
  "opencode-v2": new OpenCodeLaneExecutor("opencode-v2"),
  oc2: new OpenCodeLaneExecutor("opencode-v2"),
  "grok-cli": new GrokCliExecutor(),
  gcli: new GrokCliExecutor(), // Alias
  gb: new GrokCliExecutor(), // Alias (Grok Build)
  "ollama-local": new OllamaLocalExecutor(),
  commandcode: new CommandCodeExecutor(),
  "xiaomi-tokenplan": new XiaomiTokenplanExecutor(),
  "xiaomi-mimo": new XiaomiMimoExecutor(),
  mimocode: new MimoFreeExecutor(), // MiMoCode free channel (anonymous JWT)
  "mimocode-free": new MimoFreeExecutor(), // Alias for mimocode
  mmf: new MimoFreeExecutor(), // Retired id for the same channel
  "mimo-free": new MimoFreeExecutor(),
  "codebuddy-cn": new CodeBuddyExecutor(),
  "codebuddy-intl": new CodeBuddyIntlExecutor(),
  trae: new TraeExecutor(),
  zed: new ZedExecutor(),
  windsurf: new WindsurfExecutor(),
  "minimax-code": new MinimaxCodeExecutor("minimax-code"),
  "minimax-code-global": new MinimaxCodeExecutor("minimax-code-global"),
  "devin-cli": new DevinCliExecutor(),
  bedrock: new BedrockExecutor(),
  br: new BedrockExecutor(), // Alias for bedrock
  // Second Bedrock entry for xAI's Grok, which speaks OpenAI Chat Completions rather than the
  // Anthropic Messages format. Same executor, different registry transport format — the pattern
  // vertex / vertex-partner already uses.
  "bedrock-xai": new BedrockExecutor("bedrock-xai"),
  brx: new BedrockExecutor("bedrock-xai"), // Alias for bedrock-xai
  "deepseek-web": new DeepSeekWebExecutor(),
  dsw: new DeepSeekWebExecutor(),
  "deepseek-cookie": new DeepSeekWebExecutor(),
  zcode: new ZCodeExecutor(),
  zc: new ZCodeExecutor(),
};

const defaultCache = new Map();

export function getExecutor(provider) {
  if (executors[provider]) return executors[provider];
  if (!defaultCache.has(provider)) defaultCache.set(provider, new DefaultExecutor(provider));
  return defaultCache.get(provider);
}

export function hasSpecializedExecutor(provider) {
  return !!executors[provider];
}

export { BaseExecutor } from "./base.js";
export { AntigravityExecutor } from "./antigravity.js";
export { AzureExecutor } from "./azure.js";
export { BedrockExecutor } from "./bedrock.js";
export { GeminiCLIExecutor } from "./gemini-cli.js";
export { GeminiWebExecutor } from "./gemini-web.js";
export { GithubExecutor } from "./github.js";
export { IFlowExecutor } from "./iflow.js";
export { QoderExecutor } from "./qoder.js";
export { KiroExecutor } from "./kiro.js";
export { KimchiExecutor } from "./kimchi.js";
export { CodexExecutor } from "./codex.js";
export { CursorExecutor } from "./cursor.js";
export { VertexExecutor } from "./vertex.js";
export { DefaultExecutor } from "./default.js";
export { OpenCodeExecutor } from "./opencode.js";
export { OpenCodeGoExecutor } from "./opencode-go.js";
export { OpenCodeZenExecutor } from "./opencode-zen.js";
export { OpenCodeV2Executor } from "./opencodeV2.js";
export { OpenCodeLaneExecutor } from "./opencodeLane.js";
export { GrokCliExecutor } from "./grok-cli.js";
export { OllamaLocalExecutor } from "./ollama-local.js";
export { CommandCodeExecutor } from "./commandcode.js";
export { XiaomiTokenplanExecutor } from "./xiaomi-tokenplan.js";
export { XiaomiMimoExecutor } from "./xiaomi-mimo.js";
export { MimoFreeExecutor } from "./mimo-free.js";
export { CodeBuddyExecutor } from "./codebuddy-cn.js";
export { CodeBuddyIntlExecutor } from "./codebuddy-intl.js";
export { default as TraeExecutor } from "./trae.js";
export { default as ZedExecutor } from "./zed.js";
export { default as WindsurfExecutor } from "./windsurf.js";
export { DevinCliExecutor } from "./devin-cli.js";
export { DeepSeekWebExecutor } from "./deepseek-web.js";
export { ZCodeExecutor } from "./zcode.js";
