// AWS region allowlist. Kiro/CodeWhisperer URLs are built as `https://<svc>.${region}.amazonaws.com`
// and carry bearer tokens / client secrets, so a stored region like "evil.com#" would
// redirect credentials off AWS (GHSA-6mwv-4mrm-5p3m). Dependency-free: imported by both
// open-sse sinks and src/ write paths.
export const AWS_REGION_PATTERN = /^[a-z]{2}-[a-z]+-\d{1,2}$/;
export const DEFAULT_AWS_REGION = "us-east-1";

export function isValidAwsRegion(region) {
  return typeof region === "string" && AWS_REGION_PATTERN.test(region);
}

// For URL sinks fed from stored credentials: never interpolate an invalid region,
// fall back to the default AWS region instead of failing the request.
export function safeAwsRegion(region, fallback = DEFAULT_AWS_REGION) {
  const trimmed = typeof region === "string" ? region.trim() : "";
  return isValidAwsRegion(trimmed) ? trimmed : fallback;
}
