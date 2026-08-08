import { NextResponse } from 'next/server';
import { costTracker } from 'open-sse/services/costTracker.js';

export async function POST(request) {
  try {
    const body = await request.json();
    const { period, amount } = body;
    if (!period || amount === undefined) {
      return NextResponse.json({ error: 'period and amount are required' }, { status: 400 });
    }
    costTracker.setBudget(period, amount);
    return NextResponse.json({ success: true, budgets: costTracker.budgets });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}