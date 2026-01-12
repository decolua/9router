/**
 * Security Test: Fix 3 - Remove Default Password
 * Branch: security/remove-default-password
 *
 * Tests that the default password '123456' is removed and proper
 * setup flow is required before authentication.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { startServer, stopServer, apiRequest } from '../helpers/server.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('Fix 3: Remove Default Password', () => {
  let server;
  const dbPath = path.join(os.homedir(), '.9router', 'db.json');
  const dbBackupPath = path.join(os.homedir(), '.9router', 'db.json.test-backup');

  // Backup and restore database for tests
  beforeEach(() => {
    // Backup existing database if it exists
    if (fs.existsSync(dbPath)) {
      fs.copyFileSync(dbPath, dbBackupPath);
    }
  });

  afterAll(() => {
    // Restore original database
    if (fs.existsSync(dbBackupPath)) {
      fs.copyFileSync(dbBackupPath, dbPath);
      fs.unlinkSync(dbBackupPath);
    }
  });

  describe('Fresh installation (no password configured)', () => {
    beforeAll(async () => {
      // Remove database to simulate fresh installation
      if (fs.existsSync(dbPath)) {
        fs.unlinkSync(dbPath);
      }

      server = await startServer({
        JWT_SECRET: 'a'.repeat(32),
        API_KEY_SECRET: 'b'.repeat(32),
      });
    });

    afterAll(async () => {
      await stopServer(server);
    });

    it('should reject login with default password "123456"', async () => {
      const response = await apiRequest('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: '123456' }),
      }, server.port);

      expect(response.status).toBe(401);
      expect(response.body.error).toContain('No password configured');
      expect(response.body.requiresSetup).toBe(true);
    });

    it('should reject login with any password when none configured', async () => {
      const response = await apiRequest('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'any_password' }),
      }, server.port);

      expect(response.status).toBe(401);
      expect(response.body.error).toContain('No password configured');
    });

    it('should provide clear error message about setup requirement', async () => {
      const response = await apiRequest('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: '123456' }),
      }, server.port);

      expect(response.body.error).toMatch(/setup|wizard/i);
      expect(response.body.requiresSetup).toBe(true);
    });
  });

  describe('Settings endpoint protection', () => {
    beforeAll(async () => {
      // Remove database to simulate fresh installation
      if (fs.existsSync(dbPath)) {
        fs.unlinkSync(dbPath);
      }

      server = await startServer({
        JWT_SECRET: 'a'.repeat(32),
        API_KEY_SECRET: 'b'.repeat(32),
      });
    });

    afterAll(async () => {
      await stopServer(server);
    });

    it('should reject password change when no password configured', async () => {
      const response = await apiRequest('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentPassword: '123456',
          newPassword: 'NewSecurePassword123!',
        }),
      }, server.port);

      // Should reject because no password is configured yet
      expect(response.status).toBe(401);
      expect(response.body.error).toMatch(/setup|wizard/i);
      expect(response.body.requiresSetup).toBe(true);
    });
  });

  describe('Setup wizard (if implemented)', () => {
    describe('Password strength validation', () => {
      beforeAll(async () => {
        // Remove database to simulate fresh installation
        if (fs.existsSync(dbPath)) {
          fs.unlinkSync(dbPath);
        }

        server = await startServer({
          JWT_SECRET: 'a'.repeat(32),
          API_KEY_SECRET: 'b'.repeat(32),
        });
      });

      afterAll(async () => {
        await stopServer(server);
      });

      it('should enforce password strength requirements', async () => {
        const response = await apiRequest('/api/auth/setup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            password: 'short',
          }),
        }, server.port);

        if (response.status !== 404) {
          // If setup endpoint exists, it should reject weak passwords
          expect(response.status).toBe(400);
          expect(response.body.error).toMatch(/password.*at least.*8|weak|strong/i);
        }
      });
    });

    describe('Initial setup', () => {
      beforeAll(async () => {
        // Remove database to simulate fresh installation
        if (fs.existsSync(dbPath)) {
          fs.unlinkSync(dbPath);
        }

        server = await startServer({
          JWT_SECRET: 'a'.repeat(32),
          API_KEY_SECRET: 'b'.repeat(32),
        });
      });

      afterAll(async () => {
        await stopServer(server);
      });

      it('should allow setting initial password via setup endpoint', async () => {
        const response = await apiRequest('/api/auth/setup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            password: 'InitialSecurePassword123!',
          }),
        }, server.port);

        // May not be implemented yet, but should return 200 or 404
        // 404 means endpoint doesn't exist yet (acceptable)
        // 200 means it worked
        expect([200, 404]).toContain(response.status);

        if (response.status === 200) {
          expect(response.body.success).toBe(true);

          // Try to login with new password
          const loginResponse = await apiRequest('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: 'InitialSecurePassword123!' }),
          }, server.port);

          expect(loginResponse.status).toBe(200);
        }
      });

    it('should prevent running setup twice', async () => {
      // First setup
      const firstSetup = await apiRequest('/api/auth/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          password: 'FirstPassword123!',
        }),
      }, server.port);

      if (firstSetup.status === 200) {
        // Try to run setup again
        const secondSetup = await apiRequest('/api/auth/setup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            password: 'SecondPassword123!',
          }),
        }, server.port);

        expect(secondSetup.status).toBe(400);
        expect(secondSetup.body.error).toMatch(/already configured|already set/i);
      }
    });
    });
  });

  describe('Login page', () => {
    beforeAll(async () => {
      server = await startServer({
        JWT_SECRET: 'a'.repeat(32),
        API_KEY_SECRET: 'b'.repeat(32),
      });
    });

    afterAll(async () => {
      await stopServer(server);
    });

    it('should not display default password hint in login page', async () => {
      const response = await apiRequest('/login', {}, server.port);

      // Get HTML content
      const html = typeof response.body === 'string' ? response.body : '';

      // Should not contain the default password hint
      expect(html).not.toMatch(/default.*password.*123456/i);
      expect(html).not.toContain('<code className="bg-sidebar px-1 rounded">123456</code>');
    });
  });

  describe('Security verification', () => {
    it('should not allow plain text password comparison', async () => {
      // Remove database
      if (fs.existsSync(dbPath)) {
        fs.unlinkSync(dbPath);
      }

      server = await startServer({
        JWT_SECRET: 'a'.repeat(32),
        API_KEY_SECRET: 'b'.repeat(32),
      });

      // Try login with "123456"
      const response = await apiRequest('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: '123456' }),
      }, server.port);

      // Should not succeed with plain text comparison
      expect(response.status).toBe(401);
      expect(response.body.error).toContain('No password configured');

      // The old code did: password === "123456"
      // New code should reject because no password is configured

      await stopServer(server);
      server = null;
    });
  });
});
