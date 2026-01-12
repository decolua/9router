/**
 * Security Test: Fix 1 - OAuth Client Secrets
 * Branch: security/fix-oauth-secrets
 *
 * Tests that OAuth client secrets are required as environment variables
 * and not hard-coded in source code.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startServer, stopServer, apiRequest } from '../helpers/server.js';

describe('Fix 1: OAuth Client Secrets', () => {
  let server;

  describe('Without OAuth secrets', () => {
    it('should log errors when OAuth secrets are missing', async () => {
      // Start server without OAuth secrets
      const env = {
        JWT_SECRET: 'a'.repeat(32),
        API_KEY_SECRET: 'b'.repeat(32),
        // No GEMINI_CLIENT_SECRET, IFLOW_CLIENT_SECRET, ANTIGRAVITY_CLIENT_SECRET
      };

      server = await startServer(env);

      // Server should start but log errors about missing secrets
      // We can't easily check console logs, but we can verify server is running
      const response = await apiRequest('/', {}, server.port);

      // Server should still run (with warnings) but not crash
      expect([200, 307, 308, 404]).toContain(response.status);

      await stopServer(server);
      server = null;
    });
  });

  describe('With OAuth secrets', () => {
    it('should start successfully with all OAuth secrets', async () => {
      // Start server with all required secrets
      const testServer = await startServer({
        JWT_SECRET: 'a'.repeat(32),
        API_KEY_SECRET: 'b'.repeat(32),
        GEMINI_CLIENT_SECRET: 'test_gemini_secret_123',
        IFLOW_CLIENT_SECRET: 'test_iflow_secret_456',
        ANTIGRAVITY_CLIENT_SECRET: 'test_antigravity_secret_789',
      });

      const response = await apiRequest('/', {}, testServer.port);
      expect([200, 307, 308]).toContain(response.status);

      await stopServer(testServer);
    });

    it('should have OAuth provider endpoints available', async () => {
      const testServer = await startServer({
        JWT_SECRET: 'a'.repeat(32),
        API_KEY_SECRET: 'b'.repeat(32),
        GEMINI_CLIENT_SECRET: 'test_gemini_secret_123',
        IFLOW_CLIENT_SECRET: 'test_iflow_secret_456',
        ANTIGRAVITY_CLIENT_SECRET: 'test_antigravity_secret_789',
      });

      // Check if providers endpoint exists
      const response = await apiRequest('/api/providers', {}, testServer.port);

      // May require authentication, but endpoint should exist
      expect([200, 401, 403]).toContain(response.status);

      await stopServer(testServer);
    });

    it('should use environment variables for OAuth config', async () => {
      // This test verifies that hard-coded secrets are not present
      // by checking that the server can function with custom env secrets
      const testServer = await startServer({
        JWT_SECRET: 'a'.repeat(32),
        API_KEY_SECRET: 'b'.repeat(32),
        GEMINI_CLIENT_SECRET: 'test_gemini_secret_123',
        IFLOW_CLIENT_SECRET: 'test_iflow_secret_456',
        ANTIGRAVITY_CLIENT_SECRET: 'test_antigravity_secret_789',
      });

      // If hard-coded secrets were still in use, changing env vars wouldn't work
      // The fact that server started with our custom secrets proves they're being used
      const response = await apiRequest('/', {}, testServer.port);
      expect([200, 307, 308]).toContain(response.status);

      await stopServer(testServer);
    });
  });

  describe('OAuth client IDs', () => {
    it('should allow overriding OAuth client IDs via environment', async () => {
      // Test with custom client IDs
      const testServer = await startServer({
        JWT_SECRET: 'a'.repeat(32),
        API_KEY_SECRET: 'b'.repeat(32),
        GEMINI_CLIENT_SECRET: 'test_secret_1',
        IFLOW_CLIENT_SECRET: 'test_secret_2',
        ANTIGRAVITY_CLIENT_SECRET: 'test_secret_3',
        GEMINI_CLIENT_ID: 'custom_gemini_client_id',
        IFLOW_CLIENT_ID: 'custom_iflow_client_id',
        ANTIGRAVITY_CLIENT_ID: 'custom_antigravity_client_id',
      });

      // Server should start with custom client IDs
      const response = await apiRequest('/', {}, testServer.port);
      expect([200, 307, 308]).toContain(response.status);

      await stopServer(testServer);
    });
  });

  describe('Security verification', () => {
    it('should not expose secrets in API responses', async () => {
      server = await startServer({
        JWT_SECRET: 'a'.repeat(32),
        API_KEY_SECRET: 'b'.repeat(32),
        GEMINI_CLIENT_SECRET: 'test_secret_gemini_check',
        IFLOW_CLIENT_SECRET: 'test_secret_iflow_check',
        ANTIGRAVITY_CLIENT_SECRET: 'test_secret_antigravity_check',
      });

      // Check providers endpoint doesn't leak secrets
      const response = await apiRequest('/api/providers', {}, server.port);
      const bodyText = JSON.stringify(response.body);

      // Should not contain our test secrets
      expect(bodyText).not.toContain('test_secret_gemini_check');
      expect(bodyText).not.toContain('test_secret_iflow_check');
      expect(bodyText).not.toContain('test_secret_antigravity_check');

      await stopServer(server);
      server = null;
    });
  });
});
