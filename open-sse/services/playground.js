/**
 * Multi-Model Playground for 9Router
 * Compare multiple providers side-by-side with parallel requests.
 */

export class Playground {
  constructor() {
    this.history = [];
  }

  /**
   * Run a comparison across multiple models
   */
  async compare({ prompt, models, max_tokens = 256, stream = false }) {
    if (!prompt || !models || !Array.isArray(models) || models.length === 0) {
      throw new Error('prompt and models[] are required');
    }
    if (models.length > 6) {
      throw new Error('Maximum 6 models per comparison');
    }

    const startTime = Date.now();
    const results = await Promise.allSettled(
      models.map(model => this._runModel({ prompt, model, max_tokens }))
    );

    const resolved = results.map((r, i) => {
      if (r.status === 'fulfilled') return r.value;
      return {
        model: models[i],
        latency_ms: 0,
        content: null,
        usage: null,
        error: r.reason?.message || 'Unknown error',
        tokens_per_second: 0
      };
    });

    // Determine winners
    const successful = resolved.filter(r => !r.error);
    const fastest = successful.length > 0
      ? successful.reduce((a, b) => a.latency_ms < b.latency_ms ? a : b)
      : null;
    const cheapest = successful.length > 0
      ? successful.reduce((a, b) => {
          const aCost = (a.usage?.prompt_tokens || 0) + (a.usage?.completion_tokens || 0);
          const bCost = (b.usage?.prompt_tokens || 0) + (b.usage?.completion_tokens || 0);
          return aCost < bCost ? a : b;
        })
      : null;

    const comparison = {
      prompt,
      results: resolved,
      fastest: fastest?.model || null,
      cheapest: cheapest?.model || null,
      total_latency_ms: Date.now() - startTime,
      timestamp: new Date().toISOString()
    };

    this.history.push(comparison);
    if (this.history.length > 100) this.history.shift();

    return comparison;
  }

  async _runModel({ prompt, model, max_tokens }) {
    const startTime = Date.now();

    try {
      const res = await fetch(`http://localhost:${process.env.PORT || 20128}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          max_tokens,
          stream: false
        }),
        signal: AbortSignal.timeout(60000)
      });

      const latency_ms = Date.now() - startTime;

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: { message: res.statusText } }));
        return {
          model,
          latency_ms,
          content: null,
          usage: null,
          error: err.error?.message || `HTTP ${res.status}`,
          tokens_per_second: 0
        };
      }

      const data = await res.json();
      const choice = data.choices?.[0];
      const usage = data.usage || {};
      const completionTokens = usage.completion_tokens || 0;
      const tokens_per_second = completionTokens > 0 && latency_ms > 0
        ? Math.round((completionTokens / latency_ms) * 1000 * 10) / 10
        : 0;

      return {
        model,
        latency_ms,
        content: choice?.message?.content || null,
        usage: {
          prompt_tokens: usage.prompt_tokens || 0,
          completion_tokens: completionTokens,
          total_tokens: usage.total_tokens || 0
        },
        error: null,
        tokens_per_second
      };
    } catch (error) {
      return {
        model,
        latency_ms: Date.now() - startTime,
        content: null,
        usage: null,
        error: error.message,
        tokens_per_second: 0
      };
    }
  }

  getHistory() {
    return this.history.slice(-50);
  }

  clearHistory() {
    this.history = [];
  }
}

// Singleton
const g = globalThis;
if (!g.__9router_playground) {
  g.__9router_playground = new Playground();
}
export const playground = g.__9router_playground;