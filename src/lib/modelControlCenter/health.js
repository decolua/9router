const KNOWN_HEALTH_CATEGORIES = new Set([
  "ok",
  "timeout",
  "unavailable",
  "restricted",
  "rate_limited",
  "upstream_error",
  "probe_incompatible",
  "failed",
  "unsupported",
  "pending",
]);

export const RETRYABLE_HEALTH_CATEGORIES = new Set([
  "timeout",
  "rate_limited",
  "upstream_error",
  "failed",
]);

export function classifyHealth(health = null) {
  if (!health) return "pending";

  if (
    health.category
    && KNOWN_HEALTH_CATEGORIES.has(health.category)
  ) {
    return health.category;
  }

  if (health.status === "ok") {
    return "ok";
  }

  if (health.status === "unsupported") {
    return "unsupported";
  }

  if (health.status !== "error") {
    return "pending";
  }

  const rawStatusCode = health.statusCode;
  const parsedStatusCode = Number(rawStatusCode);

  const statusCode =
    rawStatusCode !== null
    && rawStatusCode !== undefined
    && Number.isFinite(parsedStatusCode)
      ? parsedStatusCode
      : null;

  const error = String(
    health.error || "",
  ).toLowerCase();

  if (
    error.includes("timed out")
    || error.includes("timeout")
  ) {
    return "timeout";
  }

  if (
    statusCode === 404
    || statusCode === 406
    || (
      statusCode === 400
      && (
        error.includes("invalid_model_id")
        || error.includes("invalid model id")
        || error.includes("model does not exist")
        || error.includes("model not found")
      )
    )
  ) {
    return "unavailable";
  }

  if (
    statusCode === 400
    && (
      error.includes("request_body_invalid")
      || error.includes("request body invalid")
      || error.includes("improperly formed request")
    )
  ) {
    return "probe_incompatible";
  }

  if (
    statusCode === 401
    || statusCode === 402
    || statusCode === 403
  ) {
    return "restricted";
  }

  if (statusCode === 429) {
    return "rate_limited";
  }

  if (
    statusCode !== null
    && statusCode >= 500
    && statusCode <= 599
  ) {
    return "upstream_error";
  }

  return "failed";
}

export function isRetryableHealth(health = null) {
  return RETRYABLE_HEALTH_CATEGORIES.has(
    classifyHealth(health),
  );
}
