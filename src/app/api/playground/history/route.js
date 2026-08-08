import { NextResponse } from 'next/server';
import { playground } from 'open-sse/services/playground.js';

export async function GET() {
  return NextResponse.json({ history: playground.getHistory() });
}

export async function DELETE() {
  playground.clearHistory();
  return NextResponse.json({ success: true });
}