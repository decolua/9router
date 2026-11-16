import { DefaultExecutor } from "./default.js";

// https://docs.cohere.com/docs/compatibility-api
const UNSUPPORTED = [
  "store", "metadata", "logit_bias", "top_logprobs", "n", "modalities", "prediction",
  "audio", "service_tier", "parallel_tool_calls", "client_metadata", "stream_options",
];

export class CohereExecutor extends DefaultExecutor {
  constructor() {
    super("cohere");
  }

  transformRequest(model, body, stream, credentials) {
    const transformed = super.transformRequest(model, { ...body }, stream, credentials);
    transformed.model = model;
    transformed.stream = stream;
    for (const key of UNSUPPORTED) delete transformed[key];
    if (transformed.max_completion_tokens != null) {
      transformed.max_tokens ??= transformed.max_completion_tokens;
      delete transformed.max_completion_tokens;
    }
    if (transformed.reasoning_effort != null && !["none", "high"].includes(transformed.reasoning_effort)) {
      throw Object.assign(new Error("Cohere reasoning_effort must be 'none' or 'high'"), { status: 400 });
    }
    // Cohere documents JSON Schema under json_object.schema, not json_schema.json_schema.
    if (transformed.response_format?.type === "json_schema") {
      const schema = transformed.response_format.json_schema?.schema;
      if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
        throw Object.assign(new Error("Cohere structured output requires a JSON schema object"), { status: 400 });
      }
      transformed.response_format = { type: "json_object", schema };
    }
    return transformed;
  }
}
