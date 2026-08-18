import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mocks for database & proxy config resolution
const dbMocks = vi.hoisted(() => ({
  getProxyPools: vi.fn(),
  getProxyPoolById: vi.fn(),
  getProviderConnections: vi.fn(),
  getSettings: vi.fn(() => ({})),
}));

vi.mock('@/lib/localDb', () => ({
  getProxyPools: dbMocks.getProxyPools,
  getProxyPoolById: dbMocks.getProxyPoolById,
  getProviderConnections: dbMocks.getProviderConnections,
  getSettings: dbMocks.getSettings,
}));

import { getProviderCredentials } from '@/sse/services/auth.js';

describe('PR A: strictProxy Propagation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Credential Propagation (auth.js)', () => {
    it('propagates strictProxy=true for normal provider connection path', async () => {
      const mockPool = {
        id: 'pool-strict',
        name: 'Strict Proxy Pool',
        isActive: true,
        proxyUrl: 'http://127.0.0.1:9999',
        strictProxy: true,
      };
      dbMocks.getProviderConnections.mockResolvedValue([
        {
          id: 'conn-1',
          provider: 'openai',
          name: 'OpenAI Conn',
          testStatus: 'active',
          apiKey: 'sk-test-key',
          providerSpecificData: { proxyPoolId: 'pool-strict' },
        },
      ]);
      dbMocks.getProxyPools.mockResolvedValue([mockPool]);
      dbMocks.getProxyPoolById.mockResolvedValue(mockPool);

      const creds = await getProviderCredentials('openai', {}, null);
      expect(creds).toBeDefined();
      expect(creds.providerSpecificData.connectionProxyEnabled).toBe(true);
      expect(creds.providerSpecificData.connectionProxyUrl).toBe('http://127.0.0.1:9999');
      expect(creds.providerSpecificData.strictProxy).toBe(true);
    });

    it('propagates strictProxy=false for normal provider connection path', async () => {
      const mockPool = {
        id: 'pool-lenient',
        name: 'Lenient Proxy Pool',
        isActive: true,
        proxyUrl: 'http://127.0.0.1:9999',
        strictProxy: false,
      };
      dbMocks.getProviderConnections.mockResolvedValue([
        {
          id: 'conn-2',
          provider: 'openai',
          name: 'OpenAI Conn 2',
          testStatus: 'active',
          apiKey: 'sk-test-key-2',
          providerSpecificData: { proxyPoolId: 'pool-lenient' },
        },
      ]);
      dbMocks.getProxyPools.mockResolvedValue([mockPool]);
      dbMocks.getProxyPoolById.mockResolvedValue(mockPool);

      const creds = await getProviderCredentials('openai', {}, null);
      expect(creds).toBeDefined();
      expect(creds.providerSpecificData.strictProxy).toBe(false);
    });

    it('propagates strictProxy=true for no-auth virtual connection path', async () => {
      const mockPool = {
        id: 'pool-noauth-strict',
        name: 'NoAuth Strict Proxy Pool',
        isActive: true,
        proxyUrl: 'http://127.0.0.1:9999',
        strictProxy: true,
      };
      dbMocks.getProviderConnections.mockResolvedValue([]);
      dbMocks.getProxyPools.mockResolvedValue([mockPool]);
      dbMocks.getProxyPoolById.mockResolvedValue(mockPool);
      dbMocks.getSettings.mockResolvedValue({
        providerStrategies: {
          'mimo-free': { rotateStrategy: 'round-robin', proxyPoolId: 'pool-noauth-strict' },
        },
      });

      const creds = await getProviderCredentials('mimo-free', {}, null);
      expect(creds).toBeDefined();
      expect(creds.id).toBe('noauth');
      expect(creds.providerSpecificData.connectionProxyEnabled).toBe(true);
      expect(creds.providerSpecificData.strictProxy).toBe(true);
    });
  });

  describe('Full Propagation & Fetch Behavior (chatCore -> proxyAwareFetch)', () => {
    it('Case A: strictProxy=true + proxy failure -> direct fetch invocation count = 0', async () => {
      let callCount = 0;
      // Proxy fetch fails with connection error
      const mockProxyFetch = vi.fn(async () => {
        callCount++;
        throw new Error('connect ECONNREFUSED 127.0.0.1:19999');
      });

      const origFetch = globalThis.fetch;
      globalThis.fetch = mockProxyFetch;

      vi.resetModules();
      const { proxyAwareFetch } = await import('open-sse/utils/proxyFetch.js');

      const proxyOptions = {
        connectionProxyEnabled: true,
        connectionProxyUrl: 'http://127.0.0.1:19999',
        connectionNoProxy: '',
        vercelRelayUrl: '',
        strictProxy: true,
      };

      try {
        await expect(
          proxyAwareFetch('https://example.com/v1/chat/completions', { method: 'POST' }, proxyOptions)
        ).rejects.toThrow(/strictProxy=true/);

        // When strictProxy=true and proxy fails, it MUST NOT fall back to direct fetch.
        // The single call that failed was the proxy fetch attempt.
        expect(callCount).toBe(1);
      } finally {
        globalThis.fetch = origFetch;
      }
    });

    it('Case B: strictProxy=false + proxy failure -> falls back to direct fetch (count = 1)', async () => {
      let proxyAttempts = 0;
      let directFallbackAttempts = 0;

      const fakeFetch = vi.fn(async (url, init) => {
        if (init?.dispatcher) {
          proxyAttempts++;
          throw new Error('connect ECONNREFUSED 127.0.0.1:19999');
        }
        directFallbackAttempts++;
        return new Response('{"ok":true}', { status: 200 });
      });

      const origFetch = globalThis.fetch;
      globalThis.fetch = fakeFetch;

      vi.resetModules();
      const { proxyAwareFetch } = await import('open-sse/utils/proxyFetch.js');

      const proxyOptions = {
        connectionProxyEnabled: true,
        connectionProxyUrl: 'http://127.0.0.1:19999',
        connectionNoProxy: '',
        vercelRelayUrl: '',
        strictProxy: false,
      };

      try {
        const res = await proxyAwareFetch('https://example.com/v1/chat/completions', { method: 'POST' }, proxyOptions);
        expect(res.status).toBe(200);
        // Direct fetch fallback MUST be invoked exactly once when strictProxy=false
        expect(directFallbackAttempts).toBe(1);
      } finally {
        globalThis.fetch = origFetch;
      }
    });
  });
});
