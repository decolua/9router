import { it, expect } from 'vitest';
import { clientIdentity } from '../../src/lib/clientKeyAnalytics.js';
it('preserves explicit Unknown snapshots while resolving legacy exact keys only', () => {
  const keys = [{ id: 'a', name: 'Alpha', key: 'fixture-exact' }];
  expect(clientIdentity({ apiKey: 'fixture-exact', meta: { clientKeyId: null, clientKeyName: 'Unknown' } }, keys)).toMatchObject({ clientKeyId: null, clientKeyName: 'Unknown', clientKeyDeleted: false });
  expect(clientIdentity({ apiKey: 'fixture-exact', meta: {} }, keys).clientKeyId).toBe('a');
  expect(clientIdentity({ apiKey: 'fixture', meta: {} }, keys).clientKeyId).toBeNull();
  expect(clientIdentity({ apiKey: 'fixture-exact-more', meta: {} }, keys).clientKeyId).toBeNull();
});
