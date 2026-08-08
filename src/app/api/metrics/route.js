import { getMetrics, getContentType, startSystemMetricsCollection } from 'open-sse/services/metrics.js';

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

// Start system metrics collection on first request
let metricsStarted = false;

export async function GET() {
  if (!metricsStarted) {
    startSystemMetricsCollection(10000); // Collect every 10 seconds
    metricsStarted = true;
  }

  const metricsOutput = await getMetrics();
  
  return new Response(metricsOutput, {
    headers: {
      'Content-Type': getContentType(),
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      ...CORS_HEADERS
    }
  });
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}