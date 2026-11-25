/**
 * Enterprise-domain input validation for QwenWork enterprise flagship.
 *
 * validateEnterpriseDomain reads what the user entered as their enterprise's
 * address (the domain the desktop client's enterprise mode would take as its
 * endpoint override): a bare host, or an https:// address with no path.
 * Loopback- and intranet-looking names and bare IPs are refused too.
 * Anything else names none.
 *
 * This is an input-contract check for the sign-in prompt, NOT a security
 * boundary: it keeps http/port/path/query, bare IPs and localhost-family
 * suffixes out of the enterprise domain field so the value can be shaped
 * into an https:// base URL. The rule that enterprise tokens never leave
 * the enterprise host is enforced at the routing layer (enterpriseHost
 * routing), not here.
 *
 * @param {unknown} input - user-entered domain or https:// address
 * @returns {string|null} normalized lowercase hostname, or null when the
 *   input names no enterprise domain
 */
export function validateEnterpriseDomain(input) {
  let e = String(input ?? "").trim().toLowerCase();
  if (!e) return null;
  if (/^[a-z][a-z\d+.-]*:\/\//.test(e)) {
    let u;
    try {
      u = new URL(e);
    } catch {
      return null;
    }
    if (
      u.protocol !== "https:" ||
      u.username ||
      u.password ||
      u.port ||
      u.search ||
      u.hash ||
      (u.pathname !== "" && u.pathname !== "/")
    ) {
      return null;
    }
    if (e.endsWith("/")) e = e.slice(0, -1);
    if (u.hostname + "" !== e.slice("https://".length)) return null;
    e = u.hostname;
  }
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(e)) return null; // a bare IP is not a domain
  if (/^(localhost|.*\.localhost|.*\.local|.*\.internal)$/.test(e)) return null; // loopback / intranet suffixes
  if (!/^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(e)) return null;
  return e;
}
