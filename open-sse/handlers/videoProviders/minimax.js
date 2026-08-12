import { createErrorResult } from "../../utils/error.js";
import { HTTP_STATUS } from "../../config/runtimeConfig.js";

const STATUS_MAP = {
  queued: "pending",
  running: "processing",
  succeeded: "done",
  failed: "failed",
  cancelled: "cancelled",
};

function badRequest(message) {
  return { error: createErrorResult(HTTP_STATUS.BAD_REQUEST, message) };
}

export function prepareMinimaxVideoRequest(
  config,
  { action, requestId, rawBody, contentType },
) {
  if (requestId) {
    return {
      method: "GET",
      url: `${config.queryUrl.replace(/\/$/, "")}/${encodeURIComponent(requestId)}`,
      body: undefined,
      contentType: null,
    };
  }

  if (action !== "generations") {
    return badRequest(
      "MiniMax video generation supports the generations action only",
    );
  }
  if (!contentType?.includes("application/json")) {
    return badRequest(
      "MiniMax video generation requires an application/json request body",
    );
  }

  let input;
  try {
    input = JSON.parse(String(rawBody || ""));
  } catch {
    return badRequest("Invalid JSON body");
  }

  const prompt = typeof input.prompt === "string" ? input.prompt.trim() : "";
  if (!prompt) return badRequest("MiniMax video generation requires a prompt");
  if (prompt.length > config.maxPromptCharacters) {
    return badRequest(
      `MiniMax video generation prompts must not exceed ${config.maxPromptCharacters} characters`,
    );
  }

  const model = input.model || config.defaultModel;
  if (!config.models.includes(model))
    return badRequest(`Unsupported MiniMax video model: ${model}`);

  const resolution = input.resolution;
  if (!config.resolutions.includes(resolution)) {
    return badRequest(
      `MiniMax video resolution must be one of: ${config.resolutions.join(", ")}`,
    );
  }

  const duration = input.duration;
  if (
    !Number.isInteger(duration) ||
    duration < config.duration.min ||
    duration > config.duration.max
  ) {
    return badRequest(
      `MiniMax video duration must be an integer from ${config.duration.min} to ${config.duration.max} seconds`,
    );
  }

  const ratio = input.ratio || input.aspect_ratio;
  if (!config.textToVideoRatios.includes(ratio)) {
    return badRequest(
      `MiniMax text-to-video ratio must be one of: ${config.textToVideoRatios.join(", ")}`,
    );
  }

  const body = {
    model,
    content: [{ type: "text", text: prompt }],
    resolution,
    duration,
    ratio,
  };
  if (typeof input.callback_url === "string" && input.callback_url)
    body.callback_url = input.callback_url;
  if (
    config.supportsAigcWatermark &&
    typeof input.aigc_watermark === "boolean"
  ) {
    body.aigc_watermark = input.aigc_watermark;
  }

  return {
    method: "POST",
    url: config.createUrl,
    body: JSON.stringify(body),
    contentType: "application/json",
  };
}

export function normalizeMinimaxVideoResponse(bodyText, requestId = null) {
  let payload;
  try {
    payload = JSON.parse(bodyText);
  } catch {
    return {
      error: createErrorResult(
        HTTP_STATUS.BAD_GATEWAY,
        "MiniMax returned an invalid video response",
      ),
    };
  }

  if (!requestId) {
    if (!payload?.task_id) {
      return {
        error: createErrorResult(
          HTTP_STATUS.BAD_GATEWAY,
          "MiniMax did not return a video task id",
        ),
      };
    }
    return { bodyText: JSON.stringify({ request_id: payload.task_id }) };
  }

  const task = payload?.task;
  if (!task?.status) {
    return {
      error: createErrorResult(
        HTTP_STATUS.BAD_GATEWAY,
        "MiniMax did not return a video task status",
      ),
    };
  }

  const normalized = {
    request_id: task.id || requestId,
    status: STATUS_MAP[task.status] || task.status,
  };
  if (task.content?.url) {
    normalized.video = {
      url: task.content.url,
      ...(Number.isInteger(task.duration) ? { duration: task.duration } : {}),
      ...(task.resolution ? { resolution: task.resolution } : {}),
      ...(task.ratio ? { aspect_ratio: task.ratio } : {}),
    };
  }
  if (task.error) normalized.error = task.error;
  if (task.usage) normalized.usage = task.usage;

  return { bodyText: JSON.stringify(normalized) };
}
