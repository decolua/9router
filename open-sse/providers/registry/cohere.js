// Official catalog: https://docs.cohere.com/docs/models
const chat = (id, name, contextWindow, maxOutput, capabilities = {}) => ({
  id, name, kind: "llm", trialEligible: true,
  capabilities: { tools: false, vision: false, reasoning: false, contextWindow, maxOutput, ...capabilities },
});
const embed = (id, name, dimensions, outputDimensions) => ({
  id, name, kind: "embedding", dimensions, trialEligible: true,
  capabilities: { tools: false, vision: true, ...(outputDimensions ? { outputDimensions } : {}) },
});

export default {
  id: "cohere",
  priority: 90,
  alias: "cohere",
  display: {
    name: "Cohere",
    icon: "hub",
    color: "#39594D",
    textIcon: "CO",
    website: "https://cohere.com",
    notice: {
      text: "Free evaluation API keys: 1,000 calls/month, rate limited; not for production. Paid production keys are also supported.",
      apiKeyUrl: "https://dashboard.cohere.com/api-keys",
    },
  },
  category: "freeTier",
  authType: "apikey",
  hasFree: true,
  transport: {
    baseUrl: "https://api.cohere.ai/compatibility/v1/chat/completions",
    validateUrl: "https://api.cohere.com/v1/models?page_size=1",
    format: "openai",
    thinkingFormat: "openai",
  },
  models: [
    chat("command-a-plus-05-2026", "Command A+", 128000, 64000, { tools: true, vision: true, reasoning: true, structuredOutput: true }),
    chat("command-a-03-2025", "Command A", 256000, 8000, { tools: true, structuredOutput: true }),
    chat("command-a-reasoning-08-2025", "Command A Reasoning", 256000, 32000, { tools: true, reasoning: true, structuredOutput: true }),
    chat("command-a-vision-07-2025", "Command A Vision", 128000, 8000, { vision: true }),
    chat("command-a-translate-08-2025", "Command A Translate", 8000, 8000),
    chat("command-r7b-12-2024", "Command R7B", 128000, 4000, { tools: true, structuredOutput: true }),
    chat("command-r-08-2024", "Command R (Aug 2024)", 128000, 4000, { tools: true, structuredOutput: true }),
    chat("command-r-plus-08-2024", "Command R+ (Aug 2024)", 128000, 4000, { tools: true, structuredOutput: true }),
    chat("north-small-translate-1.0", "North Small Translate", 16000, 16000),
    chat("north-mini-code-1.0", "North Mini Code", 256000, 64000, { tools: true }),
    chat("c4ai-aya-expanse-32b", "Aya Expanse 32B", 128000, 4000),
    chat("c4ai-aya-vision-32b", "Aya Vision 32B", 16000, 4000, { vision: true }),
    ...["global", "earth", "fire", "water"].map((region) => chat(`tiny-aya-${region}`, `Tiny Aya ${region}`, 8000, 8000)),
    embed("embed-v5.0-pro", "Embed v5 Pro", 2048, [256, 512, 768, 1024, 1536, 2048]),
    embed("embed-v5.0-fast", "Embed v5 Fast", 2048, [256, 512, 768, 1024, 1536, 2048]),
    embed("embed-v4.0", "Embed v4", 1536, [256, 512, 1024, 1536]),
    embed("embed-english-v3.0", "Embed English v3", 1024),
    embed("embed-english-light-v3.0", "Embed English Light v3", 384),
    embed("embed-multilingual-v3.0", "Embed Multilingual v3", 1024),
    embed("embed-multilingual-light-v3.0", "Embed Multilingual Light v3", 384),
    { id: "cohere-transcribe-03-2026", name: "Cohere Transcribe", kind: "stt", trialEligible: true },
    { id: "cohere-transcribe-arabic-07-2026", name: "Cohere Transcribe Arabic", kind: "stt", trialEligible: true },
  ],
  serviceKinds: ["llm", "embedding", "stt"],
  embeddingConfig: {
    baseUrl: "https://api.cohere.com/v2/embed",
    authType: "apikey",
    authHeader: "bearer",
  },
  sttConfig: {
    format: "cohere-stt",
    baseUrl: "https://api.cohere.com/compatibility/v1/audio/transcriptions",
    authType: "apikey",
    authHeader: "bearer",
  },
  passthroughModels: true,
};
