// fetch that handles PATCH /api/settings' 401 { code: "REAUTH_REQUIRED" }: ask for the
// current password, retry once with `currentPassword` added to the JSON body, and
// otherwise return the response unchanged (a cancelled prompt returns the original 401).
export async function fetchWithReauth(url, init, askPassword, fetchFn = fetch) {
  const res = await fetchFn(url, init);
  if (res.status !== 401) return res;
  const data = await res.clone().json().catch(() => null);
  if (data?.code !== "REAUTH_REQUIRED") return res;

  const currentPassword = await askPassword();
  if (!currentPassword) return res;
  let body = {};
  try { body = JSON.parse(init?.body || "{}"); } catch { return res; }
  return fetchFn(url, { ...init, body: JSON.stringify({ ...body, currentPassword }) });
}
