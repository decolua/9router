import { DefaultExecutor } from "./default.js";

const AIHORDE_ANONYMOUS_API_KEY = "0000000000";

const AIHORDE_UNSUPPORTED_PARAMS = [
  "tools",
  "tool_choice",
  "parallel_tool_calls",
];

function collapsePlainStringContent(message) {
  if (!message || !Array.isArray(message.content)) {
    return message;
  }

  const text = message.content
    .map((part) => {
      if (typeof part === "string") {
        return part;
      }

      if (
        part &&
        part.type === "text" &&
        typeof part.text === "string"
      ) {
        return part.text;
      }

      return "";
    })
    .filter(Boolean)
    .join("\n");

  return {
    ...message,
    content: text,
  };
}

/**
 * AI Horde OpenAI-compatible facade.
 *
 * Kept provider-specific because native 9Router currently does not
 * expose generic registry contracts for:
 * - anonymousApiKey fallback
 * - provider-wide unsupported params
 * - requiresPlainStringContent
 *
 * This prevents AI-Horde quirks from affecting unrelated providers.
 */
export class AIHordeExecutor extends DefaultExecutor {
  constructor() {
    super("aihorde");
  }

  buildHeaders(
    credentials = {},
    stream = true,
    url,
    model
  ) {
    const configuredKey =
      credentials?.apiKey ||
      credentials?.accessToken ||
      null;

    const key =
      configuredKey ||
      AIHORDE_ANONYMOUS_API_KEY;

    const headers = {
      "Content-Type": "application/json",
      ...(this.config?.headers || {}),

      // AI Horde native credential header.
      apikey: key,
    };

    if (stream) {
      headers.Accept = "text/event-stream";
    }

    return headers;
  }

  transformRequest(
    model,
    body,
    stream,
    credentials
  ) {
    const transformed =
      super.transformRequest(
        model,
        body,
        stream,
        credentials
      );

    if (
      !transformed ||
      typeof transformed !== "object"
    ) {
      return transformed;
    }

    const output = {
      ...transformed,
    };

    for (
      const key of AIHORDE_UNSUPPORTED_PARAMS
    ) {
      delete output[key];
    }

    if (Array.isArray(output.messages)) {
      output.messages =
        output.messages.map(
          collapsePlainStringContent
        );
    }

    return output;
  }
}

export default AIHordeExecutor;
