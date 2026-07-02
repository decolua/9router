/**
 * Kiro regional topology — SINGLE SOURCE OF TRUTH.
 *
 * Kiro / AWS CodeWhisperer is region-scoped: the access token, its profileArn,
 * the GenerateAssistantResponse runtime endpoint, the OIDC refresh endpoint and
 * the ListAvailableProfiles control-plane call must ALL agree on one AWS region.
 * A token minted in eu-central-1 is rejected by a us-east-1 endpoint (403), and
 * a us-east-1 profileArn sent to an eu-central-1 endpoint yields 400
 * "Improperly formed request".
 *
 * `us-east-1` is only the DEFAULT when no region is known — it is not a special
 * case that every other region has to bend around. The single genuine asymmetry
 * is an AWS infrastructure fact: the legacy `codewhisperer.<region>.amazonaws.com`
 * host is deployed ONLY in us-east-1, while every region (including us-east-1) is
 * served by `q.<region>.amazonaws.com` and `runtime.<region>.kiro.dev`. That fact
 * is encoded exactly once, as data, in KIRO_RUNTIME_HOSTS below.
 *
 * This module is intentionally dependency-free so both the SSE hot path
 * (executors/translators) and the OAuth helpers (src/lib/oauth) can import it.
 */

export const KIRO_DEFAULT_REGION = "us-east-1";

const GENERATE_PATH = "/generateAssistantResponse";

/**
 * Runtime host templates for GenerateAssistantResponse, in preference order.
 *   availableIn: "all"          → host exists in every region
 *   availableIn: ["us-east-1"]  → host only exists in the listed regions
 *
 * To add/adjust Kiro's regional topology, edit ONLY this table.
 */
const KIRO_RUNTIME_HOSTS = [
  { host: (r) => `runtime.${r}.kiro.dev`, availableIn: "all" },
  { host: (r) => `codewhisperer.${r}.amazonaws.com`, availableIn: [KIRO_DEFAULT_REGION] },
  { host: (r) => `q.${r}.amazonaws.com`, availableIn: "all" },
];

function hostAvailable(entry, region) {
  return entry.availableIn === "all" || entry.availableIn.includes(region);
}

/** Extract the AWS region from a CodeWhisperer profileArn, or null if absent. */
export function regionFromProfileArn(profileArn) {
  if (typeof profileArn !== "string") return null;
  // arn:aws:codewhisperer:<region>:<account>:profile/<id>
  const parts = profileArn.split(":");
  return parts.length >= 4 && parts[3] ? parts[3] : null;
}

/**
 * Resolve the AWS region for a Kiro credential.
 * Priority: explicit providerSpecificData.region → profileArn region → default.
 */
export function resolveKiroRegion(credentials) {
  const psd = credentials?.providerSpecificData;
  return psd?.region || regionFromProfileArn(psd?.profileArn) || KIRO_DEFAULT_REGION;
}

/**
 * Build the ordered GenerateAssistantResponse base URLs for a region,
 * automatically excluding hosts that do not exist in that region.
 */
export function buildKiroBaseUrls(region = KIRO_DEFAULT_REGION) {
  const r = region || KIRO_DEFAULT_REGION;
  return KIRO_RUNTIME_HOSTS
    .filter((e) => hostAvailable(e, r))
    .map((e) => `https://${e.host(r)}${GENERATE_PATH}`);
}

/**
 * Return the amazonaws.com control-plane BASE URL (bare host, no path) for a
 * region's CodeWhisperer service. Callers invoke ListAvailableProfiles via the
 * AWS JSON-RPC style (`x-amz-target` header). Prefers codewhisperer.* where it
 * exists (us-east-1) and falls back to q.* everywhere else.
 */
export function buildKiroProfileEndpoint(region = KIRO_DEFAULT_REGION) {
  const r = region || KIRO_DEFAULT_REGION;
  const amazonHost = KIRO_RUNTIME_HOSTS
    .filter((e) => hostAvailable(e, r) && e.host(r).includes("amazonaws.com"))
    .map((e) => e.host(r))
    .find(Boolean);
  return `https://${amazonHost}`;
}

/** Region-scoped AWS SSO-OIDC token endpoint (IDC refresh). */
export function buildKiroOidcEndpoint(region = KIRO_DEFAULT_REGION) {
  return `https://oidc.${region || KIRO_DEFAULT_REGION}.amazonaws.com/token`;
}

/**
 * Force a profileArn's region segment to match `region`. This guarantees we
 * never send a us-east-1 ARN to an eu-central-1 endpoint (or vice versa), and
 * self-heals credentials that were stored with a mismatched/rewritten region.
 * The account id and profile id are region-invariant, so only the region
 * segment changes.
 */
export function alignProfileArnRegion(profileArn, region) {
  if (!profileArn || !region) return profileArn || "";
  return profileArn.replace(/^(arn:aws:codewhisperer:)[^:]+(:)/, `$1${region}$2`);
}
