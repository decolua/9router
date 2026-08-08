import { NextResponse } from 'next/server';
import { freeModelDiscovery } from 'open-sse/services/freeModelDiscovery.js';

export async function GET() {
  return NextResponse.json(freeModelDiscovery.getStats());
}