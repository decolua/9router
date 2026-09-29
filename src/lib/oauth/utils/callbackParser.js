/**
 * Parse pasted OAuth callback text: full URL, scheme-less host, raw query,
 * or direct tokens / auth codes (Google 4/..., 1//..., ya29..., JSON).
 */
export function parseOAuthCallbackInput(input) {
  const raw = String(input || "").trim();
  if (!raw) throw new Error("Paste the callback URL from the address bar");

  // Raw Google auth code (starts with 4/ or 4%2F)
  if (raw.startsWith("4/") || raw.startsWith("4%2F")) {
    return {
      code: decodeURIComponent(raw),
      token: null,
      state: null,
      errorParam: null,
      errorDescription: null,
    };
  }

  // Raw refresh token (starts with 1// or 1/)
  if (raw.startsWith("1//") || raw.startsWith("1/")) {
    return {
      code: raw,
      token: raw,
      state: null,
      errorParam: null,
      errorDescription: null,
    };
  }

  // Raw access token (starts with ya29.)
  if (raw.startsWith("ya29.")) {
    return {
      code: raw,
      token: raw,
      state: null,
      errorParam: null,
      errorDescription: null,
    };
  }

  // Raw JSON credentials
  if (raw.startsWith("{") && raw.endsWith("}")) {
    return {
      code: raw,
      token: raw,
      state: null,
      errorParam: null,
      errorDescription: null,
    };
  }

  let href = raw;
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(href)) {
    if (/^(localhost|127\.0\.0\.1)(:\d+)?(\/|\?|$)/i.test(href)) {
      href = `http://${href}`;
    } else if (href.startsWith("?") || /(?:^|[?&])(code|token|state)=/.test(href)) {
      const q = href.startsWith("?") ? href : `?${href}`;
      href = `http://localhost/${q}`;
    } else {
      href = `http://${href}`;
    }
  }

  const url = new URL(href);
  return {
    code: url.searchParams.get("code"),
    token: url.searchParams.get("token"),
    state: url.searchParams.get("state"),
    errorParam: url.searchParams.get("error"),
    errorDescription: url.searchParams.get("error_description"),
  };
}
