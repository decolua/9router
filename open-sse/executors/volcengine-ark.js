import { DefaultExecutor } from "./default.js";

/**
 * Volcengine Ark only returns the final streaming usage block when the
 * OpenAI-compatible stream_options flag is enabled. Without it, cache hit
 * counters are unavailable and 9router has to fall back to estimated usage.
 */
export class VolcengineArkExecutor extends DefaultExecutor {
  constructor() {
    super("volcengine-ark");
  }

  transformRequest(model, body, stream, credentials) {
    const transformed = super.transformRequest(model, body, stream, credentials);
    if (!stream || !transformed?.messages) return transformed;

    return {
      ...transformed,
      stream_options: {
        ...(transformed.stream_options && typeof transformed.stream_options === "object" && !Array.isArray(transformed.stream_options)
          ? transformed.stream_options
          : {}),
        include_usage: true,
      },
    };
  }
}

export default VolcengineArkExecutor;
