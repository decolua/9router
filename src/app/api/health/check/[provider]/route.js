import { NextResponse } from 'next/server';
import { healthMonitor } from 'open-sse/services/healthMonitor.js';

export async function POST(request, { params }) {
  const { provider } = await params;
  await healthMonitor.check(provider);
  const state = healthMonitor.getState(provider);

  return NextResponse.json({
    provider,
    status: state.status,
    lastCheck: state.lastCheck,
    lastError: state.lastError,
    latency: healthMonitor.getLatencyPercentiles(provider)
  });
}