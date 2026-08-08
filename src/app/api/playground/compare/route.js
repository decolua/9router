import { NextResponse } from 'next/server';
import { playground } from 'open-sse/services/playground.js';

export async function POST(request) {
  try {
    const body = await request.json();
    const { prompt, models, max_tokens, stream } = body;

    if (!prompt || !models || !Array.isArray(models)) {
      return NextResponse.json({ error: 'prompt and models[] are required' }, { status: 400 });
    }

    const result = await playground.compare({ prompt, models, max_tokens, stream });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}