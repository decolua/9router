import { NextResponse } from 'next/server';
import { freeModelDiscovery } from 'open-sse/services/freeModelDiscovery.js';

export async function POST() {
  try {
    const changes = await freeModelDiscovery.scan();
    return NextResponse.json({ success: true, changes, stats: freeModelDiscovery.getStats() });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}