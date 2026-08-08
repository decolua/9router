import { NextResponse } from 'next/server';
import { semanticCache } from 'open-sse/services/semanticCache.js';

export async function GET() {
  return NextResponse.json(semanticCache.getStats());
}

export async function DELETE() {
  semanticCache.flush();
  return NextResponse.json({ success: true, message: 'Cache flushed' });
}