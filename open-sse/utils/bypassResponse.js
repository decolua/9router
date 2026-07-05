import { translateResponse, initState } from "../translator/index.js";
import { FORMATS } from "../translator/formats.js";
import { formatSSE } from "./stream.js";

const DEFAULT_BYPASS_TEXT = "CLI Command Execution: Clear Terminal";

/**
 * Create OpenAI standard format response
 */
function createOpenAIResponse(model, text = DEFAULT_BYPASS_TEXT) {
  const id = `chatcmpl-${Date.now()}`;
  const created = Math.floor(Date.now() / 1000);

  return {
    id,
    object: "chat.completion",
    created,
    model,
    choices: [{
      index: 0,
      message: {
        role: "assistant",
        content: text
      },
      finish_reason: "stop"
    }],
    usage: {
      prompt_tokens: 1,
      completion_tokens: 1,
      total_tokens: 2
    }
  };
}

/**
 * Create non-streaming response with translation
 * Use translator to convert OpenAI → sourceFormat
 */
function createNonStreamingResponse(sourceFormat, model, text) {
  const openaiResponse = createOpenAIResponse(model, text);

  // If sourceFormat is OpenAI, return directly
  if (sourceFormat === FORMATS.OPENAI) {
    return {
      success: true,
      response: new Response(JSON.stringify(openaiResponse), {
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*"
        }
      })
    };
  }

  // Use translator to convert: simulate streaming then collect all chunks
  const state = initState(sourceFormat);
  state.model = model;

  const openaiChunks = createOpenAIStreamingChunks(openaiResponse);
  const allTranslated = [];

  for (const chunk of openaiChunks) {
    const translated = translateResponse(FORMATS.OPENAI, sourceFormat, chunk, state);
    if (translated?.length > 0) {
      allTranslated.push(...translated);
    }
  }

  // Flush remaining
  const flushed = translateResponse(FORMATS.OPENAI, sourceFormat, null, state);
  if (flushed?.length > 0) {
    allTranslated.push(...flushed);
  }

  // For non-streaming, merge all chunks into final response
  const finalResponse = mergeChunksToResponse(allTranslated, sourceFormat);

  return {
    success: true,
    response: new Response(JSON.stringify(finalResponse), {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      }
    })
  };
}

/**
 * Create streaming response with translation
 * Use translator to convert OpenAI chunks → sourceFormat
 */
function createStreamingResponse(sourceFormat, model, text) {
  const openaiResponse = createOpenAIResponse(model, text);
  const state = initState(sourceFormat);
  state.model = model;

  // Create OpenAI streaming chunks
  const openaiChunks = createOpenAIStreamingChunks(openaiResponse);

  // Translate each chunk to sourceFormat using translator
  const translatedChunks = [];

  for (const chunk of openaiChunks) {
    const translated = translateResponse(FORMATS.OPENAI, sourceFormat, chunk, state);
    if (translated?.length > 0) {
      for (const item of translated) {
        translatedChunks.push(formatSSE(item, sourceFormat));
      }
    }
  }

  // Flush remaining events
  const flushed = translateResponse(FORMATS.OPENAI, sourceFormat, null, state);
  if (flushed?.length > 0) {
    for (const item of flushed) {
      translatedChunks.push(formatSSE(item, sourceFormat));
    }
  }

  // Add [DONE]
  translatedChunks.push("data: [DONE]\n\n");

  return {
    success: true,
    response: new Response(translatedChunks.join(""), {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "Access-Control-Allow-Origin": "*"
      }
    })
  };
}

/**
 * Merge translated chunks into final response object (for non-streaming)
 * Takes the last complete chunk as the final response
 */
function mergeChunksToResponse(chunks, sourceFormat) {
  if (!chunks || chunks.length === 0) {
    return createOpenAIResponse("unknown");
  }

  // For most formats, the last chunk before done contains the complete response
  // Find the most complete chunk (usually the last one with content)
  let finalChunk = chunks[chunks.length - 1];

  // For Claude format, find the message_stop or final message
  if (sourceFormat === FORMATS.CLAUDE) {
    const messageStop = chunks.find(c => c.type === "message_stop");
    if (messageStop) {
      // Reconstruct complete message from chunks
      const contentDelta = chunks.find(c => c.type === "content_block_delta");
      const messageDelta = chunks.find(c => c.type === "message_delta");
      const messageStart = chunks.find(c => c.type === "message_start");

      if (messageStart?.message) {
        finalChunk = messageStart.message;
        // message_start.usage has input + cache; message_delta.usage has the
        // final output_tokens. Merge so cache survives (delta omits it).
        const startUsage = messageStart.message.usage;
        const deltaUsage = messageDelta?.usage;
        if (startUsage || deltaUsage) {
          finalChunk.usage = {
            ...(startUsage || {}),
            ...(deltaUsage || {}),
            ...(startUsage?.cache_read_input_tokens !== undefined
              ? { cache_read_input_tokens: startUsage.cache_read_input_tokens }
              : {}),
            ...(startUsage?.cache_creation_input_tokens !== undefined
              ? { cache_creation_input_tokens: startUsage.cache_creation_input_tokens }
              : {}),
            ...(startUsage?.input_tokens !== undefined
              ? { input_tokens: startUsage.input_tokens }
              : {})
          };
        }
      }
    }
  }

  return finalChunk;
}

/**
 * Create OpenAI streaming chunks from complete response
 */
function createOpenAIStreamingChunks(completeResponse) {
  const { id, created, model, choices } = completeResponse;
  const content = choices[0].message.content;

  return [
    // Chunk with content
    {
      id,
      object: "chat.completion.chunk",
      created,
      model,
      choices: [{
        index: 0,
        delta: {
          role: "assistant",
          content
        },
        finish_reason: null
      }]
    },
    // Final chunk with finish_reason
    {
      id,
      object: "chat.completion.chunk",
      created,
      model,
      choices: [{
        index: 0,
        delta: {},
        finish_reason: "stop"
      }],
      usage: completeResponse.usage
    }
  ];
}

export { DEFAULT_BYPASS_TEXT, createOpenAIResponse, createOpenAIStreamingChunks, mergeChunksToResponse, createNonStreamingResponse, createStreamingResponse };
