import { getExecutor } from "../executors/index.js";
import { translateRequest } from "../translator/index.js";
import {
  getModelTargetFormat,
  getModelStrip,
  PROVIDER_ID_TO_ALIAS,
} from "../config/providerModels.js";
import { getTargetFormat } from "../services/provider.js";
import { dbg } from "./debugLog.js";

/**
 * Reconstructs the request body to continue generating text from where it stopped
 */
export function reconstructBodyForResume(
  originalBody,
  textBuffer,
  provider,
  model,
  sourceFormat,
  targetFormat,
  credentials,
  connectionId,
  clientTool,
) {
  const accumulated = textBuffer.accumulatedContent || "";
  const thinking = textBuffer.accumulatedThinking || "";

  // Clone original body to avoid side effects
  const newBody = JSON.parse(JSON.stringify(originalBody));

  if (!accumulated && !thinking) {
    return newBody;
  }

  // We append the already-generated text to messages list.
  // Format check: Claude (messages format) vs OpenAI (messages format) vs Gemini (contents format)
  if (Array.isArray(newBody.messages)) {
    // Check if the last message is already assistant.
    const lastMsg = newBody.messages[newBody.messages.length - 1];
    if (lastMsg && lastMsg.role === "assistant") {
      // Append the text buffer to the assistant's previous content (if any)
      lastMsg.content = (lastMsg.content || "") + accumulated;
    } else {
      // Insert the accumulated content as assistant response
      newBody.messages.push({
        role: "assistant",
        content: accumulated,
      });
    }

    // Add custom system prompt instruction to continue seamlessly
    // To do this clean, we can inject a system prompt or instruction if needed,
    // but for Claude (prefill assistant) and OpenAI (Prefill/Continue assistant),
    // simply putting role: assistant is extremely effective because LLMs natively continue.
    // If not Claude (meaning OpenAI/others that don't support native prefill), we can inject a system hint.
    if (
      provider !== "anthropic" &&
      provider !== "kiro" &&
      provider !== "openrouter"
    ) {
      const systemMsg = newBody.messages.find((m) => m.role === "system");
      const continueHint =
        "\n\n[System Instruction: Please continue writing the previous assistant response exactly from where it left off. Do not repeat the existing text. Write only the next part of the response.]";
      if (systemMsg) {
        systemMsg.content = (systemMsg.content || "") + continueHint;
      } else {
        newBody.messages.unshift({
          role: "system",
          content: continueHint,
        });
      }
    }
  } else if (Array.isArray(newBody.contents)) {
    // Gemini contents format
    const lastContent = newBody.contents[newBody.contents.length - 1];
    if (lastContent && lastContent.role === "model") {
      if (lastContent.parts && lastContent.parts[0]) {
        lastContent.parts[0].text =
          (lastContent.parts[0].text || "") + accumulated;
      }
    } else {
      newBody.contents.push({
        role: "model",
        parts: [{ text: accumulated }],
      });
    }
  }

  return newBody;
}

/**
 * Executes a resume request and returns the new stream
 */
export async function executeResumeRequest({
  originalBody,
  textBuffer,
  provider,
  model,
  credentials,
  sourceFormat,
  targetFormat,
  userAgent,
  apiKey,
  connectionId,
  toolNameMap,
  reqLogger,
  clientRawRequest,
}) {
  dbg(
    "RESUME",
    `Initiating transparent stream resume | provider=${provider} | model=${model} | bytesGenerated=${textBuffer.totalContentLength}`,
  );

  const clientTool = userAgent?.toLowerCase().includes("droid")
    ? "droid"
    : "other";
  const newBody = reconstructBodyForResume(
    originalBody,
    textBuffer,
    provider,
    model,
    sourceFormat,
    targetFormat,
    credentials,
    connectionId,
    clientTool,
  );
  if (!newBody) {
    dbg("RESUME", "Cannot resume: accumulated text buffer is empty");
    return null;
  }

  // Translate request to provider target format
  const alias = PROVIDER_ID_TO_ALIAS[provider] || provider;
  const modelTargetFormat = getModelTargetFormat(alias, model);
  const finalTargetFormat = modelTargetFormat || getTargetFormat(provider);
  const stripList = getModelStrip(alias, model);

  const translatedBody = translateRequest(
    sourceFormat,
    finalTargetFormat,
    model,
    newBody,
    true, // always streaming
    credentials,
    provider,
    reqLogger,
    stripList,
    connectionId,
    clientTool,
  );

  if (!translatedBody) {
    dbg("RESUME", "Failed to translate reconstructed request for resume");
    return null;
  }

  delete translatedBody._toolNameMap;
  translatedBody.model = model;

  const executor = getExecutor(provider);
  const proxyOptions = {
    connectionProxyEnabled:
      credentials?.providerSpecificData?.connectionProxyEnabled === true,
    connectionProxyUrl:
      credentials?.providerSpecificData?.connectionProxyUrl || "",
    connectionNoProxy:
      credentials?.providerSpecificData?.connectionNoProxy || "",
    vercelRelayUrl: credentials?.providerSpecificData?.vercelRelayUrl || "",
  };

  try {
    const result = await executor.execute({
      model,
      body: translatedBody,
      stream: true,
      credentials,
      proxyOptions,
    });

    if (!result.response.ok) {
      dbg(
        "RESUME",
        `Resume request failed with status: ${result.response.status}`,
      );
      return null;
    }

    return result.response;
  } catch (err) {
    dbg("RESUME", `Resume request threw exception: ${err.message}`);
    return null;
  }
}
