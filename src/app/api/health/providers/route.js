import { NextResponse } from 'next/server';
import { healthMonitor, HealthStatus } from 'open-sse/services/healthMonitor.js';

export async function GET() {
  const states = healthMonitor.getAllStates();
  const result = {};
  for (const [provider, state] of Object.entries(states)) {
    result[provider] = {
      status: state.status,
      lastCheck: state.lastCheck,
      lastError: state.lastError,
      consecutiveFailures: state.consecutiveFailures,
      latency: healthMonitor.getLatencyPercentiles(provider)
    };
  }
  return NextResponse.json({ providers: result });
}