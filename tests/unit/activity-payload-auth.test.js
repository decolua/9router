import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
const mocks = vi.hoisted(() => ({ getSettings: vi.fn(), getRequestDetails: vi.fn() }));
vi.mock('@/lib/localDb', () => ({ getSettings: mocks.getSettings, validateApiKey: vi.fn() }));
vi.mock('@/lib/usageDb', () => ({ getRequestDetails: mocks.getRequestDetails }));
vi.mock('@/lib/dataDir', () => ({ DATA_DIR: '/root/9router-client-analytics/.staging-data' }));
const { createDashboardAuthToken } = await import('@/lib/auth/dashboardSession');
const { getConsistentMachineId } = await import('@/shared/utils/machineId');
const { GET } = await import('@/app/api/usage/request-details/route');
const { proxy } = await import('../../src/dashboardGuard.js');
const fixture = {
  id: 'fixture', model: 'fixture-model',
  request: { body: { messages: [{ role: 'user', content: 'fixture task prompt' }] } },
  providerRequest: { messages: [{ role: 'user', content: 'fixture translated prompt' }] },
  providerResponse: { choices: [{ message: { content: 'fixture response', tool_calls: [{ function: { name: 'fixture_tool', arguments: '{"path":"fixture.txt"}' } }] } }] },
  response: { content: 'fixture client response' },
};
function request(headers = {}) { return new NextRequest('http://localhost/api/usage/request-details', { headers }); }
beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSettings.mockResolvedValue({ requireLogin: true });
  mocks.getRequestDetails.mockResolvedValue({ details: [structuredClone(fixture)], pagination: { totalItems: 1 } });
});
describe('Activity payload authentication', () => {
  it('sanitizes historical headers and structured credentials without removing conversation', async () => {
    const detail = structuredClone(fixture);
    detail.request.headers = { Authorization: 'fixture-secret', 'X-Api-Key': 'fixture-secret', Cookie: 'fixture-secret', 'content-type': 'application/json' };
    detail.providerRequest.headers = { 'x-goog-api-key': 'fixture-secret' };
    detail.response.credentials = { access_token: 'fixture-secret', refreshToken: 'fixture-secret', password: 'fixture-secret', client_secret: 'fixture-secret', apiKey: 'fixture-secret' };
    detail.response.legacy = { _truncated: true, _originalSize: 9000, _preview: '{"apiKey":"fixture-secret' };
    detail.response.tool_calls = [{ function: { name: 'login', arguments: '{"api_key":"fixture-secret","task":"fixture task"}' } }];
    mocks.getRequestDetails.mockResolvedValue({ details: [detail] });
    const token = await createDashboardAuthToken();
    const response = await GET(request({ cookie: `auth_token=${token}` }));
    const body = await response.json();
    expect(JSON.stringify(body)).not.toContain('fixture-secret');
    expect(body.details[0].request.body).toEqual(fixture.request.body);
    expect(body.details[0].providerResponse).toEqual(fixture.providerResponse);
    expect(body.details[0].request.headers['content-type']).toBe('application/json');
    expect(detail.request.headers.Authorization).toBe('fixture-secret');
    expect(response.headers.get('cache-control')).toContain('no-store');
  });
  it.each([true, false])('denies unauthenticated payload access with requireLogin=%s', async (requireLogin) => {
    mocks.getSettings.mockResolvedValue({ requireLogin });
    for (const headers of [{}, { cookie: 'auth_token=invalid', 'x-9r-cli-token': 'invalid' }, { authorization: 'Bearer fixture-api-key', host: 'localhost' }]) {
      const response = await GET(request(headers));
      expect(response.status).toBe(401);
      expect(JSON.stringify(await response.json())).not.toContain('fixture');
    }
    expect(mocks.getRequestDetails).not.toHaveBeenCalled();
  });
  it('allows the existing local CLI credential', async () => {
    const token = await getConsistentMachineId('9r-cli-auth');
    const response = await GET(request({ 'x-9r-cli-token': token }));
    expect(response.status).toBe(200);
    expect((await response.json()).details[0]).toEqual(fixture);
  });
  it('shows saved prompts, responses and tool calls to a valid dashboard session', async () => {
    const token = await createDashboardAuthToken();
    const response = await GET(request({ cookie: `auth_token=${token}` }));
    expect(response.status).toBe(200);
    expect((await response.json()).details[0]).toEqual(fixture);
  });
});
