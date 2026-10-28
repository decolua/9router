// Kiro/CodeWhisperer URLs interpolate this value into an AWS hostname and may carry
// bearer tokens or client secrets. Only canonical AWS region names are accepted.
export const AWS_REGION_PATTERN = /^[a-z]{2}-[a-z]+-\d{1,2}$/;
export const DEFAULT_AWS_REGION = "us-east-1";

export function isValidAwsRegion(region) {
  return typeof region === "string" && AWS_REGION_PATTERN.test(region);
}

export function safeAwsRegion(region, fallback = DEFAULT_AWS_REGION) {
  const trimmed = typeof region === "string" ? region.trim() : "";
  return isValidAwsRegion(trimmed) ? trimmed : fallback;
}
