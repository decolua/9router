import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function GET() {
  try {
    const statusFile = path.join(process.cwd(), 'data', 'update-status.json');
    if (fs.existsSync(statusFile)) {
      const content = fs.readFileSync(statusFile, 'utf8');
      const data = JSON.parse(content);
      // Treat terminal states older than 2 minutes as idle
      if ((data.status === 'success' || data.status === 'error' || data.status === 'conflict') && data.timestamp && (Date.now() - data.timestamp > 120000)) {
        return NextResponse.json({ status: 'idle' });
      }
      return NextResponse.json(data);
    }
    return NextResponse.json({ status: 'idle' });
  } catch (error) {
    return NextResponse.json({ status: 'error', error: error.message }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const webhookUrl = process.env.WEBHOOK_UPDATE_URL || 'http://100.70.118.53:9099/webhook-update_9router';
    const webhookToken = process.env.WEBHOOK_UPDATE_TOKEN || 'router9-secure-update-key-2026';

    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${webhookToken}`
      }
    });

    if (res.ok) {
      return NextResponse.json({ success: true, message: 'Update triggered in background' });
    } else {
      return NextResponse.json({ success: false, message: 'Webhook failed' }, { status: 500 });
    }
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
