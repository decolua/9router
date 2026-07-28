// Verify alias resolution is byte-for-byte stable (both directions, all sources).
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { resolveProviderAlias } from "../../open-sse/services/model.js";
import { PROVIDER_ID_TO_ALIAS, PROVIDER_MODELS } from "../../open-sse/config/providerModels.js";

const here = dirname(fileURLToPath(import.meta.url));
const snapPath = join(here, "alias-baseline.json");

// All known alias tokens to probe (collected from both maps' historical keys)
const ALIAS_TOKENS = [
  "cc","cx","gc","qw","if","ag","gh","kr","cu","kc","kmc","cl","oc","ocg","qd","qoder",
  "el","openai","vercel","vercel-ai-gateway","anthropic","gemini","openrouter","glm","kimi",
  "minimax","minimax-cn","hf","huggingface","ds","deepseek","cmc","commandcode","groq","xai",
  "mistral","pplx","perplexity","together","fireworks","cerebras","cohere","nvidia","nebius",
  "siliconflow","hyp","hyperbolic","dg","deepgram","aai","assemblyai","nb","nanobanana","ch",
  "chutes","ark","volcengine-ark","byteplus","bpm","cursor","vx","vertex","vxp","vertex-partner",
  "gw","grok-web","gcli","gb","grok-build","grok-cli","pw","perplexity-web","mimo","xiaomi-mimo",
  "xmtp","xiaomi-tokenplan","cf",
  "cloudflare-ai","fal","fal-ai","stability","stability-ai","bfl","black-forest-labs","recraft",
  "topaz","runway","runwayml","jina","jina-ai","polly","aws-polly","bb","blackbox",
];

// Sort idToAlias by key — runtime accesses by key, order is irrelevant (content-based)
const sortedIdToAlias = Object.fromEntries(
  Object.keys(PROVIDER_ID_TO_ALIAS).sort().map(k => [k, PROVIDER_ID_TO_ALIAS[k]])
);
const resolved = {
  aliasToId: Object.fromEntries(ALIAS_TOKENS.map(a => [a, resolveProviderAlias(a)])),
  idToAlias: sortedIdToAlias,
  modelKeys: Object.keys(PROVIDER_MODELS).sort(),
};
const current = JSON.parse(JSON.stringify(resolved));

if (process.argv[2] === "--snapshot") {
  writeFileSync(snapPath, JSON.stringify(current, null, 2));
  console.log(`Snapshot alias resolution → ${snapPath}`);
  process.exit(0);
}
if (!existsSync(snapPath)) { console.error("No baseline. Run --snapshot first."); process.exit(1); }
const baseline = JSON.parse(readFileSync(snapPath, "utf8"));
if (JSON.stringify(baseline) === JSON.stringify(current)) {
  console.log(`✅ Alias resolution byte-for-byte equal (${ALIAS_TOKENS.length} tokens).`);
  process.exit(0);
}
// Diff
for (const a of ALIAS_TOKENS) {
  if (baseline.aliasToId[a] !== current.aliasToId[a]) {
    console.error(`~ alias ${a}: ${baseline.aliasToId[a]} -> ${current.aliasToId[a]}`);
  }
}
if (JSON.stringify(baseline.idToAlias) !== JSON.stringify(current.idToAlias)) console.error("~ idToAlias changed");
if (JSON.stringify(baseline.modelKeys) !== JSON.stringify(current.modelKeys)) console.error("~ modelKeys changed");
process.exit(1);
