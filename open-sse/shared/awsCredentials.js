import {
  AWS_CREDENTIAL_MODE,
  AWS_CREDENTIAL_PROVIDERS_MODULE,
  AWS_CREDENTIAL_NO_EXPIRY_TTL_MS,
  AWS_CREDENTIAL_RESOLVE_TIMEOUT_MS,
  AWS_CREDENTIAL_REFRESH_LEAD_MS,
  AWS_PROFILE_PATTERN,
  AWS_REGION_PATTERN,
  BEDROCK,
} from "../config/awsConstants.js";

/**
 * AWS credential resolution for Bedrock, in two modes.
 *
 * static  — the connection carries the keys: `apiKey` is the AWS secret access key,
 *           `providerSpecificData.accessKeyId` the key id, and `providerSpecificData.sessionToken`
 *           is set when they came from STS. Nothing is refreshable; when temporary keys expire the
 *           user must paste new ones.
 *
 * profile — the connection names a local AWS profile and nothing else. Credentials are resolved
 *           through the AWS SDK, which is what makes `aws sso login --profile X` work: the SDK
 *           reads ~/.aws/config, follows `sso_session`, reads the token from ~/.aws/sso/cache,
 *           calls GetRoleCredentials, and handles source_profile/role chaining. Re-resolving
 *           after expiry gives us refresh for free.
 *
 * The SDK is imported lazily so static-key users never pay for it, and so a missing optional
 * dependency produces an actionable error instead of breaking module load for every provider.
 */

// profile → { promise } while resolving, then { credentials, expiresAt }.
// Only profile mode is cached: static resolution is pure object reads, and caching it meant a
// rotated secret was served from cache long after the user fixed it.
const credentialCache = new Map();

/** Test seam: drop cached credentials between cases. */
export function clearAwsCredentialCache() {
  credentialCache.clear();
}

/**
 * Which mode a connection is configured for. A named profile wins over stray static keys,
 * because a user who filled in a profile meant to use it.
 */
export function detectCredentialMode(credentials) {
  const psd = credentials?.providerSpecificData || {};
  if (psd.profile) return AWS_CREDENTIAL_MODE.PROFILE;
  return AWS_CREDENTIAL_MODE.STATIC;
}

/**
 * Region precedence: explicit connection setting, then the usual AWS env vars, then Bedrock's
 * default. Deliberately does not read the profile's own region — the SDK credential providers
 * do not surface it, and silently sending traffic to a region the user did not choose is worse
 * than making them state it.
 *
 * The value is validated because it is interpolated into the request hostname. Without this,
 * a region of "evil.com/x" resolves the host to "bedrock-runtime.evil.com" and the signed
 * request, its body, and the session token are sent to an attacker-chosen origin.
 */
export function resolveRegion(credentials, env = process.env) {
  // Tracking the source matters for the error message: a bad AWS_REGION in the operator's shell
  // otherwise reads as a dashboard problem and sends them looking in the wrong place.
  const candidates = [
    [credentials?.providerSpecificData?.region, "providerSpecificData.region"],
    [env.AWS_REGION, "the AWS_REGION environment variable"],
    [env.AWS_DEFAULT_REGION, "the AWS_DEFAULT_REGION environment variable"],
    [BEDROCK.defaultRegion, "the built-in default"],
  ];
  const [rawRegion, source] = candidates.find(([value]) => value) || [];

  // Trim first: a region pasted into the dashboard with a trailing space is a typo to absorb,
  // not a reason to fail every request.
  const region = typeof rawRegion === "string" ? rawRegion.trim() : rawRegion;

  if (typeof region !== "string" || !AWS_REGION_PATTERN.test(region)) {
    throw new Error(
      `Invalid AWS region ${JSON.stringify(rawRegion)} from ${source}. A region looks like ` +
        '"us-east-1": lowercase letters, digits and hyphens only. It is used to build the ' +
        "Bedrock hostname, so anything else is rejected rather than sent to an unintended host.",
    );
  }
  return region;
}

function readStaticCredentials(credentials) {
  const psd = credentials?.providerSpecificData || {};
  const accessKeyId = psd.accessKeyId;
  const secretAccessKey = credentials?.apiKey;

  if (!accessKeyId || !secretAccessKey) {
    throw new Error(
      "Bedrock static credentials are incomplete. Set the AWS secret access key as the " +
        "provider API key and providerSpecificData.accessKeyId to the AWS access key id, " +
        "or set providerSpecificData.profile to use a local AWS profile instead.",
    );
  }

  // Temporary keys (ASIA…) are useless without their session token; catching it here turns a
  // confusing upstream SignatureDoesNotMatch into a fixable message.
  if (accessKeyId.startsWith("ASIA") && !psd.sessionToken) {
    throw new Error(
      "This looks like a temporary AWS access key (ASIA…) but no sessionToken was provided. " +
        "Add providerSpecificData.sessionToken, or use providerSpecificData.profile so " +
        "credentials are resolved and refreshed automatically.",
    );
  }

  return {
    accessKeyId,
    secretAccessKey,
    sessionToken: psd.sessionToken || undefined,
    expiration: null,
  };
}

/** Reject a promise that takes too long, so one stuck resolver cannot wedge every waiter. */
function withTimeout(promise, timeoutMs, message) {
  let timer;
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function readProfileCredentials(
  credentials,
  loadCredentialProviders,
  log,
  resolveTimeoutMs,
) {
  const profile = credentials.providerSpecificData.profile;

  // providerSpecificData carries no schema, so this arrives as an arbitrary string. The SDK will
  // follow source_profile chains and run a credential_process subprocess for whatever it names,
  // so it gets the same treatment as the region.
  if (typeof profile !== "string" || !AWS_PROFILE_PATTERN.test(profile)) {
    throw new Error(
      `Invalid AWS profile name ${JSON.stringify(profile)}. Use the profile's name as it ` +
        "appears in ~/.aws/config: letters, digits, underscore, dot, colon or hyphen, " +
        "up to 64 characters.",
    );
  }

  let fromIni;
  try {
    ({ fromIni } = await loadCredentialProviders());
  } catch (error) {
    throw new Error(
      `Bedrock profile mode needs the ${AWS_CREDENTIAL_PROVIDERS_MODULE} package, which failed ` +
        `to load (${error.message}). Install it, or switch this connection to static ` +
        "accessKeyId/secretAccessKey credentials.",
    );
  }

  let resolved;
  try {
    // Bounded: a hung GetRoleCredentials or ~/.aws read would otherwise block every request on
    // this profile forever, since they all await the same in-flight promise.
    resolved = await withTimeout(
      fromIni({ profile })(),
      resolveTimeoutMs,
      `Resolving AWS profile "${profile}" timed out after ${resolveTimeoutMs / 1000}s`,
    );
  } catch (error) {
    // The overwhelmingly common cause is an expired or absent SSO session, and the SDK's own
    // message rarely says so plainly. Point at the fix.
    throw new Error(
      `Could not resolve AWS credentials for profile "${profile}": ${error.message}. ` +
        `If this profile uses IAM Identity Center, run: aws sso login --profile ${profile}`,
    );
  }

  if (!resolved?.accessKeyId || !resolved?.secretAccessKey) {
    throw new Error(
      `AWS profile "${profile}" resolved without usable credentials. Check that the profile ` +
        "exists in ~/.aws/config and grants Bedrock access.",
    );
  }

  log?.debug?.(
    "BEDROCK",
    `Resolved credentials from AWS profile "${profile}"` +
      (resolved.expiration
        ? ` (expire ${new Date(resolved.expiration).toISOString()})`
        : ""),
  );

  return {
    accessKeyId: resolved.accessKeyId,
    secretAccessKey: resolved.secretAccessKey,
    sessionToken: resolved.sessionToken || undefined,
    expiration: resolved.expiration
      ? new Date(resolved.expiration).getTime()
      : null,
  };
}

/**
 * When to stop trusting a resolved credential. Temporary credentials are dropped early by the
 * refresh lead so a long stream cannot outlive the key that signed it.
 *
 * A credential with no declared expiry gets a short floor rather than `now`: returning `now`
 * made the entry fail its own `expiresAt > currentTime` check immediately, so every request
 * re-read and re-parsed ~/.aws from disk on the hot path. The floor still refuses to pin it for
 * the process lifetime, so a revoked profile stops working within the minute.
 */
function computeExpiresAt(resolvedCredentials, now) {
  if (!resolvedCredentials.expiration)
    return now + AWS_CREDENTIAL_NO_EXPIRY_TTL_MS;
  return resolvedCredentials.expiration - AWS_CREDENTIAL_REFRESH_LEAD_MS;
}

/** Strip the internal `expiration` field and attach this caller's own region. */
function present(resolved, region, mode, expiresAt) {
  return {
    accessKeyId: resolved.accessKeyId,
    secretAccessKey: resolved.secretAccessKey,
    sessionToken: resolved.sessionToken,
    region,
    mode,
    expiresAt,
  };
}

/**
 * Resolve usable AWS credentials plus the region to sign for.
 *
 * @param {object} credentials - 9router connection credentials.
 * @param {object} [opts]
 * @param {object} [opts.log]
 * @param {function} [opts.loadCredentialProviders] - Test seam for the lazy SDK import.
 * @param {function} [opts.now] - Test seam for the clock.
 * @returns {Promise<{accessKeyId,secretAccessKey,sessionToken,region,mode,expiresAt}>}
 */
export async function resolveAwsCredentials(
  credentials,
  {
    log = null,
    // The specifier MUST stay a literal. With a variable here, Next's output tracing cannot
    // see the dependency, so @aws-sdk/credential-providers is left out of the standalone
    // build and profile/SSO mode dies with MODULE_NOT_FOUND only in the packaged CLI.
    loadCredentialProviders = () => import("@aws-sdk/credential-providers"),
    now = () => Date.now(),
    resolveTimeoutMs = AWS_CREDENTIAL_RESOLVE_TIMEOUT_MS,
  } = {},
) {
  const mode = detectCredentialMode(credentials);
  // Resolved per call, never cached, so two connections on one profile cannot inherit each
  // other's region and sign with the wrong credential scope.
  const region = resolveRegion(credentials);

  if (mode === AWS_CREDENTIAL_MODE.STATIC) {
    // Deliberately uncached: this does no I/O, so a cache bought nothing while making a
    // rotated secret invisible and letting two connections that share an access key id
    // serve each other's secret.
    return present(readStaticCredentials(credentials), region, mode, null);
  }

  const key = `profile:${credentials.providerSpecificData.profile}`;
  const currentTime = now();
  const cached = credentialCache.get(key);

  if (cached?.promise) {
    // Share the in-flight SSO resolution, but never the caller-specific region.
    const resolved = await cached.promise;
    return present(
      resolved,
      region,
      mode,
      computeExpiresAt(resolved, currentTime),
    );
  }
  if (cached && cached.expiresAt > currentTime) {
    return present(cached.credentials, region, mode, cached.expiresAt);
  }

  // Start the work, then publish the in-flight promise before the first await in THIS function,
  // so a burst collapses into one SSO round trip. The settled entry is written by the awaiting
  // caller below, never from inside the promise: a synchronous resolver would otherwise have
  // its finished entry overwritten by the in-flight marker and never expire again.
  const promise = readProfileCredentials(
    credentials,
    loadCredentialProviders,
    log,
    resolveTimeoutMs,
  );
  credentialCache.set(key, { promise });

  let resolved;
  try {
    resolved = await promise;
  } catch (error) {
    // Never cache a failure: the user's next attempt should retry, not replay the error.
    credentialCache.delete(key);
    throw error;
  }

  const expiresAt = computeExpiresAt(resolved, currentTime);
  credentialCache.set(key, {
    credentials: {
      accessKeyId: resolved.accessKeyId,
      secretAccessKey: resolved.secretAccessKey,
      sessionToken: resolved.sessionToken,
    },
    expiresAt,
  });

  return present(resolved, region, mode, expiresAt);
}
