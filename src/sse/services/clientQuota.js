import { getAdapter } from '@/lib/db/driver.js';

// Quota is separate from credential validity. Never turn a blocked key into
// an anonymous/local request when optional API-key authentication is enabled.
export async function clientQuotaError(request) {
  const auth = request.headers.get('authorization');
  // Different compatibility routes use different header precedence. Check every
  // supplied credential so an unrelated header cannot conceal a blocked key.
  const keys = [...new Set([
    auth?.startsWith('Bearer ') ? auth.slice(7) : null,
    request.headers.get('x-api-key'), request.headers.get('x-goog-api-key'),
    new URL(request.url).searchParams.get('key'),
  ].filter(Boolean))];
  if (!keys.length) return null;
  const db = await getAdapter();
  const blocked = keys.some(key => {
    const row = db.get('SELECT isActive, quotaExhausted FROM apiKeys WHERE key = ?', [key]);
    return row?.isActive && row?.quotaExhausted;
  });
  if (!blocked) return null;
  return Response.json({ error: { message: 'Local quota exceeded', type: 'insufficient_quota', param: null, code: 'insufficient_quota' } }, {
    status: 429, headers: { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' },
  });
}
