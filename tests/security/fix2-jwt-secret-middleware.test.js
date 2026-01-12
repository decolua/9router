/**
 * Security Test: Fix 2 - JWT Middleware Unit Test
 * Direct middleware function testing (not fetch-based)
 */

import { describe, it, expect } from 'vitest';
import { middleware } from '../../src/middleware.js';
import { SignJWT } from 'jose';

// Helper to create mock NextRequest
function createMockRequest(url, cookies = {}) {
  const mockCookies = new Map(Object.entries(cookies));

  return {
    nextUrl: new URL(url),
    cookies: {
      get: (name) => {
        const value = mockCookies.get(name);
        return value ? { value } : undefined;
      }
    },
    url
  };
}

describe('Fix 2: JWT Middleware Direct Testing', () => {
  // Use same default as middleware to ensure token verification works
  const SECRET = new TextEncoder().encode(process.env.JWT_SECRET || '9router-default-secret-change-me');

  it('should redirect to login when no token is present', async () => {
    const request = createMockRequest('http://localhost:3000/dashboard');
    const response = await middleware(request);

    expect(response).toBeDefined();
    expect(response.status).toBeOneOf([307, 308]); // Redirect status codes
    expect(response.headers.get('location')).toContain('/login');
  });

  it('should redirect to login when token is invalid', async () => {
    const request = createMockRequest('http://localhost:3000/dashboard', {
      auth_token: 'invalid.token.here'
    });
    const response = await middleware(request);

    expect(response).toBeDefined();
    expect(response.status).toBeOneOf([307, 308]);
    expect(response.headers.get('location')).toContain('/login');
  });

  it('should allow access with valid token', async () => {
    // Create a valid JWT token
    const token = await new SignJWT({ userId: 'test' })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('1h')
      .sign(SECRET);

    const request = createMockRequest('http://localhost:3000/dashboard', {
      auth_token: token
    });
    const response = await middleware(request);

    expect(response).toBeDefined();
    // NextResponse.next() returns a response with status 200
    expect(response.status).toBe(200);
  });

  it('should redirect root to dashboard', async () => {
    const request = createMockRequest('http://localhost:3000/');
    const response = await middleware(request);

    expect(response).toBeDefined();
    expect(response.status).toBeOneOf([307, 308]);
    expect(response.headers.get('location')).toContain('/dashboard');
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
          : `expected ${received} to be one of ${expected}, but got ${received}`
    };
  }
});
