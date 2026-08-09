export const KIRO_AUTO_REGION = "auto";
export const KIRO_DEFAULT_RUNTIME_REGION = "us-east-1";
export const KIRO_RUNTIME_REGIONS = ["us-east-1", "eu-central-1"];

export const KIRO_RUNTIME_REGION_OPTIONS = [
  { value: KIRO_AUTO_REGION, label: "Auto-detect (recommended)" },
  { value: "us-east-1", label: "US East (N. Virginia)" },
  { value: "eu-central-1", label: "Europe (Frankfurt)" },
];

export function assertKiroRuntimeRegion(value) {
  const region = String(value || "").trim().toLowerCase();
  if (!KIRO_RUNTIME_REGIONS.includes(region)) {
    throw new Error("Unsupported Kiro runtime region");
  }
  return region;
}

export function resolveKiroRuntimeRegion(value) {
  try {
    return assertKiroRuntimeRegion(value);
  } catch {
    return KIRO_DEFAULT_RUNTIME_REGION;
  }
}
