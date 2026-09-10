import { it, expect } from 'vitest';
import { createApiKey, updateApiKey, getApiKeyById, validateApiKey, deleteApiKey } from '../../src/lib/db/repos/apiKeysRepo.js';
it('persists quota toggle independently of credential and active status', async () => {
 const key = await createApiKey('quota fixture', 'quota-fixture-machine');
 try {
  expect(key.quotaExhausted).toBe(false);
  await updateApiKey(key.id, {quotaExhausted:true});
  expect(await getApiKeyById(key.id)).toMatchObject({key:key.key,isActive:true,quotaExhausted:true});
  expect(await validateApiKey(key.key)).toBe(true);
  await updateApiKey(key.id, {quotaExhausted:false});
  expect(await getApiKeyById(key.id)).toMatchObject({key:key.key,isActive:true,quotaExhausted:false});
 } finally { await deleteApiKey(key.id); }
});
