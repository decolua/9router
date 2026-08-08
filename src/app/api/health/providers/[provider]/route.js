import { NextResponse } from 'next/server';
import { healthMonitor } from 'open-sse/services/healthMonitor.js';

export async function GET(request, { params }) {
  const { provider } = await params;
  const state = healthMonitor.getState(provider);
  const latency = healthMonitor.getLatencyPercentiles(provider);

  return NextResponse.json({
    provider,
    status: state.status,
    lastCheck: state.lastCheck,
    lastError: state.lastError,
    consecutiveFailures: state.consecutiveFailures,
    consecutiveSuccesses: state.consecutiveSuccesses,
    latency,
    errorCount: (state.errorHistory || []).length
  });
}