import { NextResponse } from 'next/server';
import { webhookService } from 'open-sse/services/webhooks.js';

export async function GET() {
  const webhooks = await webhookService.getAll();
  return NextResponse.json({ webhooks });
}

export async function POST(request) {
  try {
    const body = await request.json();
    const { url, events, secret, name, headers } = body;

    if (!url || !events || !Array.isArray(events)) {
      return NextResponse.json({ error: 'url and events[] are required' }, { status: 400 });
    }

    const webhook = await webhookService.register({ url, events, secret, name, headers });
    return NextResponse.json({ webhook }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}