import { NextResponse } from 'next/server';
import { costTracker } from 'open-sse/services/costTracker.js';

export async function GET() {
  return NextResponse.json(costTracker.getStats());
}