/**
 * Security Test: Fix 4 - CORS Restrictions
 * Branch: security/restrict-cors
 *
 * Uses Playwright for browser-based CORS testing
 */

import { test, expect } from '@playwright/test';

test.describe('Fix 4: CORS Restrictions', () => {
  test.beforeAll(async () => {
    // Ensure environment is set
    process.env.JWT_SECRET = 'a'.repeat(32);
    process.env.ALLOWED_ORIGIN = 'http://localhost:3000';
  });

  test('should allow same-origin requests', async ({ page }) => {
    await page.goto('http://localhost:3000');

    // Make same-origin fetch request
    const response = await page.evaluate(async () => {
      try {
        const res = await fetch('/api/v1/chat/completions', {
          method: 'OPTIONS',
          headers: {
            'Origin': 'http://localhost:3000',
            'Access-Control-Request-Method': 'POST'
          }
        });

        return {
          status: res.status,
          headers: Object.fromEntries(res.headers.entries())
        };
      } catch (error) {
        return { error: error.message };
      }
    });

    // Same-origin should work
    expect(response.status).toBeOneOf([200, 204]);
  });

  test('should have CORS headers for allowed origin', async ({ page }) => {
    await page.goto('http://localhost:3000');

    const headers = await page.evaluate(async () => {
      const res = await fetch('/api/v1/chat/completions', {
        method: 'OPTIONS',
        headers: {
          'Origin': 'http://localhost:3000',
          'Access-Control-Request-Method': 'POST'
        }
      });

      return {
        allowOrigin: res.headers.get('Access-Control-Allow-Origin'),
        allowMethods: res.headers.get('Access-Control-Allow-Methods'),
        allowHeaders: res.headers.get('Access-Control-Allow-Headers'),
        allowCredentials: res.headers.get('Access-Control-Allow-Credentials')
      };
    });

    expect(headers.allowOrigin).toBe('http://localhost:3000');
    expect(headers.allowMethods).toBeTruthy();
    expect(headers.allowHeaders).toBeTruthy();
  });

  test('should not have wildcard CORS', async ({ page }) => {
    await page.goto('http://localhost:3000');

    const headers = await page.evaluate(async () => {
      const res = await fetch('/api/v1/chat/completions', {
        method: 'OPTIONS'
      });

      return {
        allowOrigin: res.headers.get('Access-Control-Allow-Origin')
      };
    });

    expect(headers.allowOrigin).not.toBe('*');
  });

  test('should have CORS on multiple endpoints', async ({ page }) => {
    await page.goto('http://localhost:3000');

    const endpoints = [
      '/api/v1/messages',
      '/api/v1/responses',
      '/api/v1beta/models',
      '/api/tags'
    ];

    for (const endpoint of endpoints) {
      const hasHeaders = await page.evaluate(async (url) => {
        try {
          const res = await fetch(url, {
            method: 'OPTIONS',
            headers: {
              'Origin': 'http://localhost:3000',
              'Access-Control-Request-Method': 'POST'
            }
          });

          const allowOrigin = res.headers.get('Access-Control-Allow-Origin');
          return !!allowOrigin;
        } catch (error) {
          return false;
        }
      }, endpoint);

      expect(hasHeaders).toBe(true);
    }
  });

  test('should not show CORS errors in console', async ({ page }) => {
    const consoleErrors = [];

    page.on('console', msg => {
      if (msg.type() === 'error' && msg.text().toLowerCase().includes('cors')) {
        consoleErrors.push(msg.text());
      }
    });

    await page.goto('http://localhost:3000');
    await page.waitForTimeout(2000);

    expect(consoleErrors).toHaveLength(0);
  });
});

// Custom matcher
expect.extend({
  toBeOneOf(received, expected) {
    const pass = expected.includes(received);
    return {
      pass,
      message: () =>
        pass
          ? `expected ${received} not to be one of ${expected}`
          : `expected ${received} to be one of ${expected}`
    };
  }
});
