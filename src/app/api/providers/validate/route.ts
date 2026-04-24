import { NextResponse } from "next/server";
import { getProviderNodeById } from "@/lib/localDb";
import { isOpenAICompatibleProvider, isAnthropicCompatibleProvider } from "@/shared/constants/providers";

// POST /api/providers/validate - Validate API key with provider
export async function POST(request: Request): Promise<NextResponse> {
  try {
    const body = await request.json();
    const { provider, apiKey } = body;

    if (!provider || (!apiKey && provider !== "ollama-local")) {
      return NextResponse.json({ error: "Provider and API key required" }, { status: 400 });
    }

    let isValid = false;

    // Validate with each provider
    try {
      if (isOpenAICompatibleProvider(provider)) {
        const node = await getProviderNodeById(provider);
        if (!node) {
          return NextResponse.json({ error: "OpenAI Compatible node not found" }, { status: 404 });
        }
        const modelsUrl = `${node.baseUrl?.replace(/\/$/, "")}/models`;
        const res = await fetch(modelsUrl, {
          headers: { "Authorization": `Bearer ${apiKey}` },
        });
        isValid = res.ok;
        return NextResponse.json({
          valid: isValid,
          error: isValid ? null : "Invalid API key",
        });
      }

      if (isAnthropicCompatibleProvider(provider)) {
        const node = await getProviderNodeById(provider);
        if (!node) {
          return NextResponse.json({ error: "Anthropic Compatible node not found" }, { status: 404 });
        }

        let normalizedBase = node.baseUrl?.trim().replace(/\/$/, "") || "";
        if (normalizedBase.endsWith("/messages")) {
          normalizedBase = normalizedBase.slice(0, -9);
        }

        const modelsUrl = `${normalizedBase}/models`;

        const res = await fetch(modelsUrl, {
          headers: {
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
            "Authorization": `Bearer ${apiKey}` // Some proxies require Bearer
          },
        });
        isValid = res.ok;
        return NextResponse.json({
          valid: isValid,
          error: isValid ? null : "Invalid API key or Base URL",
        });
      }

      switch (provider) {
        case "openai": {
          const res = await fetch("https://api.openai.com/v1/models", {
            headers: { Authorization: `Bearer ${apiKey}` },
          });
          isValid = res.ok;
          break;
        }
        case "anthropic": {
          // Anthropic doesn't have a simple models endpoint for API keys, test with a minimal request
          const res = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
              "x-api-key": apiKey,
              "anthropic-version": "2023-06-01",
              "content-type": "application/json",
            },
            body: JSON.stringify({
              model: "claude-3-haiku-20240307",
              max_tokens: 1,
              messages: [{ role: "user", content: "test" }],
            }),
          });
          // Even if we hit a rate limit (429), it means the key is valid. 401 is invalid.
          isValid = res.status !== 401;
          break;
        }
        case "gemini": {
          const res = await fetch(
            `https://generativelanguage.googleapis.com/v1/models?key=${apiKey}`
          );
          isValid = res.ok;
          break;
        }
        case "openrouter": {
          const res = await fetch("https://openrouter.ai/api/v1/auth/key", {
            headers: { Authorization: `Bearer ${apiKey}` },
          });
          isValid = res.ok;
          break;
        }
        case "glm": {
          const res = await fetch("https://api.z.ai/api/anthropic/v1/messages", {
            method: "POST",
            headers: {
              "x-api-key": apiKey,
              "anthropic-version": "2023-06-01",
              "content-type": "application/json",
            },
            body: JSON.stringify({
              model: "glm-4.7",
              max_tokens: 1,
              messages: [{ role: "user", content: "test" }],
            }),
          });
          isValid = res.status !== 401 && res.status !== 403;
          break;
        }
        case "glm-cn": {
          const res = await fetch("https://open.bigmodel.cn/api/coding/paas/v4/chat/completions", {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${apiKey}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({
              model: "glm-4.7",
              max_tokens: 1,
              messages: [{ role: "user", content: "test" }],
            }),
          });
          isValid = res.status !== 401 && res.status !== 403;
          break;
        }
        case "minimax":
        case "minimax-cn": {
          const endpoints: Record<string, string> = {
            "minimax": "https://api.minimax.io/anthropic/v1/messages",
            "minimax-cn": "https://api.minimaxi.com/anthropic/v1/messages"
          };
          const res = await fetch(endpoints[provider], {
            method: "POST",
            headers: {
              "x-api-key": apiKey,
              "anthropic-version": "2023-06-01",
              "content-type": "application/json",
            },
            body: JSON.stringify({
              model: "minimax-m2",
              max_tokens: 1,
              messages: [{ role: "user", content: "test" }],
            }),
          });
          isValid = res.status !== 401 && res.status !== 403;
          break;
        }
        case "kimi": {
          const res = await fetch("https://api.kimi.com/coding/v1/messages", {
            method: "POST",
            headers: {
              "x-api-key": apiKey,
              "anthropic-version": "2023-06-01",
              "content-type": "application/json",
            },
            body: JSON.stringify({
              model: "kimi-latest",
              max_tokens: 1,
              messages: [{ role: "user", content: "test" }],
            }),
          });
          isValid = res.status !== 401 && res.status !== 403;
          break;
        }
        case "alicode":
        case "alicode-intl": {
          const aliBaseUrl = provider === "alicode-intl"
            ? "https://coding-intl.dashscope.aliyuncs.com/v1/chat/completions"
            : "https://coding.dashscope.aliyuncs.com/v1/chat/completions";
          const res = await fetch(aliBaseUrl, {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${apiKey}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({
              model: "qwen3-coder-plus",
              max_tokens: 1,
              messages: [{ role: "user", content: "test" }],
            }),
          });
          isValid = res.status !== 401 && res.status !== 403;
          break;
        }
        case "deepseek": {
          const res = await fetch("https://api.deepseek.com/models", {
            headers: { Authorization: `Bearer ${apiKey}` },
          });
          isValid = res.ok;
          break;
        }
        case "groq": {
          const res = await fetch("https://api.groq.com/openai/v1/models", {
            headers: { Authorization: `Bearer ${apiKey}` },
          });
          isValid = res.ok;
          break;
        }
        case "mistral": {
          const res = await fetch("https://api.mistral.ai/v1/models", {
            headers: { Authorization: `Bearer ${apiKey}` },
          });
          isValid = res.ok;
          break;
        }
        case "xai": {
          const res = await fetch("https://api.x.ai/v1/models", {
            headers: { Authorization: `Bearer ${apiKey}` },
          });
          isValid = res.ok;
          break;
        }
        case "nvidia": {
          const res = await fetch("https://integrate.api.nvidia.com/v1/models", {
            headers: { Authorization: `Bearer ${apiKey}` },
          });
          isValid = res.ok;
          break;
        }
        case "perplexity": {
          const res = await fetch("https://api.perplexity.ai/models", {
            headers: { Authorization: `Bearer ${apiKey}` },
          });
          isValid = res.ok;
          break;
        }
        case "together": {
          const res = await fetch("https://api.together.xyz/v1/models", {
            headers: { Authorization: `Bearer ${apiKey}` },
          });
          isValid = res.ok;
          break;
        }
        case "fireworks": {
          const res = await fetch("https://api.fireworks.ai/inference/v1/models", {
            headers: { Authorization: `Bearer ${apiKey}` },
          });
          isValid = res.ok;
          break;
        }
        case "cerebras": {
          const res = await fetch("https://api.cerebras.ai/v1/models", {
            headers: { Authorization: `Bearer ${apiKey}` },
          });
          isValid = res.ok;
          break;
        }
        case "cohere": {
          const res = await fetch("https://api.cohere.ai/v1/models", {
            headers: { Authorization: `Bearer ${apiKey}` },
          });
          isValid = res.ok;
          break;
        }
        case "nebius": {
          const res = await fetch("https://api.studio.nebius.ai/v1/models", {
            headers: { Authorization: `Bearer ${apiKey}` },
          });
          isValid = res.ok;
          break;
        }
        case "siliconflow": {
          const res = await fetch("https://api.siliconflow.cn/v1/models", {
            headers: { Authorization: `Bearer ${apiKey}` },
          });
          isValid = res.ok;
          break;
        }
        case "hyperbolic": {
          const res = await fetch("https://api.hyperbolic.xyz/v1/models", {
            headers: { Authorization: `Bearer ${apiKey}` },
          });
          isValid = res.ok;
          break;
        }
        case "ollama": {
          // Ollama requires hitting the tags endpoint
          const res = await fetch("https://ollama.com/api/tags", {
            headers: { Authorization: `Bearer ${apiKey}` },
          });
          isValid = res.ok;
          break;
        }
        case "ollama-local": {
          // Local Ollama usually doesn't require auth, just ping it
          const res = await fetch("http://localhost:11434/api/tags");
          isValid = res.ok;
          break;
        }
        case "deepgram": {
          const res = await fetch("https://api.deepgram.com/v1/projects", {
            headers: { Authorization: `Token ${apiKey}` },
          });
          isValid = res.ok;
          break;
        }
        case "assemblyai": {
          const res = await fetch("https://api.assemblyai.com/v1/account", {
            headers: { Authorization: `Bearer ${apiKey}` },
          });
          isValid = res.ok;
          break;
        }
        case "nanobanana": {
          const res = await fetch("https://api.nanobananaapi.ai/v1/models", {
            headers: { Authorization: `Bearer ${apiKey}` },
          });
          isValid = res.ok;
          break;
        }
        case "chutes": {
          const res = await fetch("https://llm.chutes.ai/v1/models", {
            headers: { Authorization: `Bearer ${apiKey}` },
          });
          isValid = res.ok;
          break;
        }
        default:
          return NextResponse.json({ valid: true, warning: "Provider test not supported" });
      }
    } catch (e: any) {
      return NextResponse.json({
        valid: false,
        error: e.message || "Connection failed",
      });
    }

    return NextResponse.json({
      valid: isValid,
      error: isValid ? null : "Invalid API key",
    });
  } catch (error) {
    console.log("Error validating API key:", error);
    return NextResponse.json({ error: "Validation failed" }, { status: 500 });
  }
}
