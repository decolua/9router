export default {
  "id": "deepinfra",
  "priority": 70,
  "alias": "deepinfra",
  "display": {
    "name": "DeepInfra",
    "icon": "diamond",
    "color": "#DC2626",
    "textIcon": "DE",
    "website": "https://deepinfra.com",
    "notice": {
      "apiKeyUrl": "https://deepinfra.com"
    }
  },
  "category": "apikey",
  "transport": {
    "baseUrl": "https://api.deepinfra.com/v1/openai/chat/completions",
    "validateUrl": "https://api.deepinfra.com/v1/models",
    "quirks": {}
  },
  "models": [
    {
      "id": "anthropic/claude-4-opus",
      "name": "anthropic/claude-4-opus"
    },
    {
      "id": "anthropic/claude-4-sonnet",
      "name": "anthropic/claude-4-sonnet"
    },
    {
      "id": "openai/gpt-oss-120b",
      "name": "openai/gpt-oss-120b"
    },
    {
      "id": "openai/gpt-oss-20b",
      "name": "openai/gpt-oss-20b"
    },
    {
      "id": "google/gemma-4-31B-it",
      "name": "google/gemma-4-31B-it"
    },
    {
      "id": "google/gemma-4-26B-A4B-it",
      "name": "google/gemma-4-26B-A4B-it"
    },
    {
      "id": "nvidia/NVIDIA-Nemotron-3-Super-120B-A12B",
      "name": "nvidia/NVIDIA-Nemotron-3-Super-120B-A12B"
    },
    {
      "id": "nvidia/Nemotron-3-Nano-Omni-30B-A3B-Reasoning",
      "name": "nvidia/Nemotron-3-Nano-Omni-30B-A3B-Reasoning"
    },
    {
      "id": "meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8",
      "name": "meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8"
    },
    {
      "id": "meta-llama/Llama-4-Scout-17B-16E-Instruct",
      "name": "meta-llama/Llama-4-Scout-17B-16E-Instruct"
    },
    {
      "id": "meta-llama/Llama-3.3-70B-Instruct-Turbo",
      "name": "meta-llama/Llama-3.3-70B-Instruct-Turbo"
    },
    {
      "id": "NousResearch/Hermes-3-Llama-3.1-405B",
      "name": "NousResearch/Hermes-3-Llama-3.1-405B"
    },
    {
      "id": "deepseek-ai/DeepSeek-V4-Pro",
      "name": "deepseek-ai/DeepSeek-V4-Pro"
    },
    {
      "id": "deepseek-ai/DeepSeek-V4-Flash",
      "name": "deepseek-ai/DeepSeek-V4-Flash"
    },
    {
      "id": "zai-org/GLM-5.1",
      "name": "zai-org/GLM-5.1"
    },
    {
      "id": "moonshotai/Kimi-K2.6",
      "name": "moonshotai/Kimi-K2.6"
    },
    {
      "id": "MiniMaxAI/MiniMax-M2.5",
      "name": "MiniMaxAI/MiniMax-M2.5"
    },
    {
      "id": "Qwen/Qwen3.6-35B-A3B",
      "name": "Qwen/Qwen3.6-35B-A3B"
    },
    {
      "id": "Qwen/Qwen3.5-397B-A17B",
      "name": "Qwen/Qwen3.5-397B-A17B"
    },
    {
      "id": "Qwen/Qwen3.5-122B-A10B",
      "name": "Qwen/Qwen3.5-122B-A10B"
    },
    {
      "id": "XiaomiMiMo/MiMo-V2.5-Pro",
      "name": "XiaomiMiMo/MiMo-V2.5-Pro"
    },
    {
      "id": "XiaomiMiMo/MiMo-V2.5",
      "name": "XiaomiMiMo/MiMo-V2.5"
    }
  ]
};
