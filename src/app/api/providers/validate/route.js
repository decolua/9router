import { NextResponse } from "next/server";
import { getProviderNodeById } from "@/models";
import { isOpenAICompatibleProvider, isAnthropicCompatibleProvider } from "@/shared/constants/providers";
import { getDefaultModel } from "open-sse/config/providerModels.js";

// POST /api/providers/validate - Validate API key with provider
export async function POST(request) {
  try {
    const body = await request.json();
    const { provider, apiKey } = body;

    if (!provider || !apiKey) {
      return NextResponse.json({ error: "Provider and API key required" }, { status: 400 });
    }

    let isValid = false;
    let error = null;

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
          normalizedBase = normalizedBase.slice(0, -9); // remove /messages
        }

        const modelsUrl = `${normalizedBase}/models`;

        const res = await fetch(modelsUrl, {
          headers: {
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
            "Authorization": `Bearer ${apiKey}`
          },
        });

        isValid = res.ok;
        return NextResponse.json({
          valid: isValid,
          error: isValid ? null : "Invalid API key",
        });
      }

      switch (provider) {
        case "openai":
          const openaiRes = await fetch("https://api.openai.com/v1/models", {
            headers: { "Authorization": `Bearer ${apiKey}` },
          });
          isValid = openaiRes.ok;
          break;

        case "anthropic":
          const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
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
          isValid = anthropicRes.status !== 401;
          break;

        case "gemini":
          const geminiRes = await fetch(`https://generativelanguage.googleapis.com/v1/models?key=${apiKey}`);
          isValid = geminiRes.ok;
          break;

        case "openrouter":
          const openrouterRes = await fetch("https://openrouter.ai/api/v1/models", {
            headers: { "Authorization": `Bearer ${apiKey}` },
          });
          isValid = openrouterRes.ok;
          break;

        case "glm":
        case "glm-cn":
        case "kimi":
        case "minimax":
        case "minimax-cn":
        case "alicode": {
          const claudeBaseUrls = {
            glm: "https://api.z.ai/api/anthropic/v1/messages",
            "glm-cn": "https://open.bigmodel.cn/api/coding/paas/v4/chat/completions",
            kimi: "https://api.kimi.com/coding/v1/messages",
            minimax: "https://api.minimax.io/anthropic/v1/messages",
            "minimax-cn": "https://api.minimaxi.com/anthropic/v1/messages",
            alicode: "https://coding.dashscope.aliyuncs.com/v1/chat/completions",
          };

          // glm-cn and alicode use OpenAI format
          if (provider === "glm-cn" || provider === "alicode") {
            const testModel = getDefaultModel(provider);
            const glmCnRes = await fetch(claudeBaseUrls[provider], {
              method: "POST",
              headers: {
                "Authorization": `Bearer ${apiKey}`,
                "content-type": "application/json",
              },
              body: JSON.stringify({
                model: testModel,
                max_tokens: 1,
                messages: [{ role: "user", content: "test" }],
              }),
            });
            isValid = glmCnRes.status !== 401 && glmCnRes.status !== 403;
          } else {
            const claudeRes = await fetch(claudeBaseUrls[provider], {
              method: "POST",
              headers: {
                "x-api-key": apiKey,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
              },
              body: JSON.stringify({
                model: "claude-sonnet-4-20250514",
                max_tokens: 1,
                messages: [{ role: "user", content: "test" }],
              }),
            });
            isValid = claudeRes.status !== 401;
          }
          break;
        }

        case "deepseek":
        case "groq":
        case "xai":
        case "mistral":
        case "perplexity":
        case "together":
        case "fireworks":
        case "cerebras":
        case "cohere":
        case "nebius":
        case "siliconflow":
        case "hyperbolic":
        case "assemblyai":
        case "nanobanana":
        case "chutes":
        case "nvidia": {
          const endpoints = {
            deepseek: "https://api.deepseek.com/models",
            groq: "https://api.groq.com/openai/v1/models",
            xai: "https://api.x.ai/v1/models",
            mistral: "https://api.mistral.ai/v1/models",
            perplexity: "https://api.perplexity.ai/models",
            together: "https://api.together.xyz/v1/models",
            fireworks: "https://api.fireworks.ai/inference/v1/models",
            cerebras: "https://api.cerebras.ai/v1/models",
            cohere: "https://api.cohere.ai/v1/models",
            nebius: "https://api.studio.nebius.ai/v1/models",
            siliconflow: "https://api.siliconflow.cn/v1/models",
            hyperbolic: "https://api.hyperbolic.xyz/v1/models",
            assemblyai: "https://api.assemblyai.com/v1/account",
            nanobanana: "https://api.nanobananaapi.ai/v1/models",
            chutes: "https://llm.chutes.ai/v1/models",
            nvidia: "https://integrate.api.nvidia.com/v1/models"
          };
          const res = await fetch(endpoints[provider], {
            headers: { "Authorization": `Bearer ${apiKey}` },
          });
          isValid = res.ok;
          break;
        }

        case "deepgram": {
          const res = await fetch("https://api.deepgram.com/v1/projects", {
            headers: { "Authorization": `Token ${apiKey}` },
          });
          isValid = res.ok;
          break;
        }

        default:
          return NextResponse.json({ error: "Provider validation not supported" }, { status: 400 });
      }
    } catch (err) {
      error = err.message;
      isValid = false;
    }

    return NextResponse.json({
      valid: isValid,
      error: isValid ? null : (error || "Invalid API key"),
    });
  } catch (error) {
    console.log("Error validating API key:", error);
    return NextResponse.json({ error: "Validation failed" }, { status: 500 });
  }
}
