import { NextResponse } from 'next/server';
import { webhookService } from 'open-sse/services/webhooks.js';

export async function POST(request, { params }) {
  const { id } = await params;
  
  try {
    const result = await webhookService.test(id);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 404 });
  }
}