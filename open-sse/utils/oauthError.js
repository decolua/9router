const MAX_OAUTH_ERROR_LENGTH = 240;
const GENERIC_OAUTH_ERROR = "OAuth token exchange failed. Restart sign-in and try again.";

export function sanitizeOAuthError(error) {
  const raw = String(error?.message || error || "").trim();
  let message = GENERIC_OAUTH_ERROR;

  if (/access[_ -]?denied|authorization (?:was )?denied/i.test(raw)) {
    message = "Authorization was denied. Restart sign-in and try again.";
  } else if (/no authorization code|missing authorization code/i.test(raw)) {
    message = "No authorization code was received. Restart sign-in and try again.";
  } else if (/proxy pool .* unavailable|selected proxy .* unavailable/i.test(raw)) {
    message = "Selected proxy is unavailable. Choose another route and try again.";
  } else if (/invalid_grant|expired_token|authorization .* expired|already (?:used|consumed)/i.test(raw)) {
    message = "Authorization expired or was already used. Restart sign-in and try again.";
  } else if (/authentication timeout|authorization timeout/i.test(raw)) {
    message = "Authorization timed out. Restart sign-in and try again.";
  }

  return message.slice(0, MAX_OAUTH_ERROR_LENGTH);
}
