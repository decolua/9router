/**
 * Semantic Response Cache for 9Router
 * Caches responses for semantically similar prompts to save tokens.
 */

import { createHash } from 'crypto';

export class SemanticCache {
  constructor(options = {}) {
    this.cache = new Map();
    this.ttl = options.ttl ?? 3600000; // 1 hour
    this.maxSize = options.maxSize ?? 10000;
    this.similarityThreshold = options.similarityThreshold ?? 0.85;
    this.enabled = options.enabled ?? true;
    this.hits = 0;
    this.misses = 0;
  }

  get(prompt, model) {
    if (!this.enabled) return null;

    const key = this._makeKey(prompt, model);
    const exact = this.cache.get(key);
    if (exact && !this._isExpired(exact)) {
      this.hits++;
      return exact.response;
    }

    const similar = this._findSimilar(prompt, model);
    if (similar) {
      this.hits++;
      return similar.response;
    }

    this.misses++;
    return null;
  }

  set(prompt, model, response, metadata = {}) {
    if (!this.enabled) return;
    const key = this._makeKey(prompt, model);

    if (this.cache.size >= this.maxSize) {
      const oldest = this.cache.keys().next().value;
      this.cache.delete(oldest);
    }

    this.cache.set(key, {
      response,
      prompt,
      metadata: { provider: model.split('/')[0], model, tokens: metadata.tokens || 0, cost: metadata.cost || 0 },
      timestamp: Date.now()
    });
  }

  _makeKey(prompt, model) {
    return createHash('sha256').update(`${model}:${prompt}`).digest('hex');
  }

  _isExpired(entry) {
    return Date.now() - entry.timestamp > this.ttl;
  }

  _findSimilar(prompt, model) {
    const words = this._tokenize(prompt);
    for (const [, entry] of this.cache) {
      if (this._isExpired(entry) || entry.metadata.model !== model) continue;
      const cachedWords = this._tokenize(entry.prompt || '');
      const sim = this._jaccard(words, cachedWords);
      if (sim >= this.similarityThreshold) return entry;
    }
    return null;
  }

  _tokenize(text) {
    return new Set(text.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(Boolean));
  }

  _jaccard(a, b) {
    const intersection = new Set([...a].filter(x => b.has(x)));
    const union = new Set([...a, ...b]);
    return union.size === 0 ? 0 : intersection.size / union.size;
  }

  flush() { this.cache.clear(); this.hits = 0; this.misses = 0; }

  getStats() {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      enabled: this.enabled,
      hits: this.hits,
      misses: this.misses,
      hitRate: this.hits + this.misses > 0 ? this.hits / (this.hits + this.misses) : 0,
      similarityThreshold: this.similarityThreshold
    };
  }
}

const g = globalThis;
if (!g.__9router_semantic_cache) g.__9router_semantic_cache = new SemanticCache();
export const semanticCache = g.__9router_semantic_cache;