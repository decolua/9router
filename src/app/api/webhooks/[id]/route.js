import { NextResponse } from 'next/server';
import { webhookService } from 'open-sse/services/webhooks.js';

export async function GET(request, { params }) {
  const { id } = await params;
  const webhook = await webhookService.get(id);
  
  if (!webhook) {
    return NextResponse.json({ error: 'Webhook not found' }, { status: 404 });
  }
  
  return NextResponse.json({ webhook });
}

export async function PUT(request, { params }) {
  const { id } = await params;
  try {
    const body = await request.json();
    const { url, events, secret, name, headers, disabled } = body;
    
    const updated = await webhookService.update(id, { url, events, secret, name, headers, disabled });
    
    if (!updated) {
      return NextResponse.json({ error: 'Webhook not found' }, { status: 404 });
    }
    
    const webhook = await webhookService.get(id);
    return NextResponse.json({ webhook });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(request, { params }) {
  const { id } = await params;
  await webhookService.unregister(id);
  return NextResponse.json({ success: true });
}