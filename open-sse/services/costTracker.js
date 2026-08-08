/**
 * Cost Tracker for 9Router
 * Tracks token costs per provider/model with budget alerts.
 * Integrates with webhook service for budget notifications.
 */

import { webhookService, WebhookEvents } from './webhooks.js';

// Default pricing per 1M tokens (USD)
const DEFAULT_PRICING = {
  'nvidia': { prompt: 0.00035, completion: 0.0014 },
  'groq': { prompt: 0.00059, completion: 0.00079 },
  'openai': { prompt: 0.0025, completion: 0.01 },
  'anthropic': { prompt: 0.003, completion: 0.015 },
  'deepseek': { prompt: 0.00014, completion: 0.00028 },
  'google': { prompt: 0.000075, completion: 0.0003 },
  'mistral': { prompt: 0.00025, completion: 0.001 },
  'cohere': { prompt: 0.00015, completion: 0.0006 },
};

export class CostTracker {
  constructor() {
    this.pricing = new Map(Object.entries(DEFAULT_PRICING));
    this.dailyUsage = new Map(); // date -> { provider: { prompt_tokens, completion_tokens, cost } }
    this.budgets = { daily: null, weekly: null, monthly: null };
    this.alertThreshold = 0.8;
  }

  setPricing(provider, pricing) {
    this.pricing.set(provider, pricing);
  }

  setBudget(period, amount) {
    this.budgets[period] = amount;
  }

  trackUsage({ provider, model, prompt_tokens, completion_tokens }) {
    const rates = this.pricing.get(provider) || { prompt: 0.000001, completion: 0.000002 };
    const cost = ((prompt_tokens * rates.prompt) + (completion_tokens * rates.completion)) / 1000000;

    const today = new Date().toISOString().split('T')[0];
    if (!this.dailyUsage.has(today)) this.dailyUsage.set(today, {});
    const dayData = this.dailyUsage.get(today);
    if (!dayData[provider]) dayData[provider] = { prompt_tokens: 0, completion_tokens: 0, cost: 0 };
    dayData[provider].prompt_tokens += prompt_tokens;
    dayData[provider].completion_tokens += completion_tokens;
    dayData[provider].cost += cost;

    this._checkBudgets();
    return cost;
  }

  _checkBudgets() {
    const todayCost = this.getTodayCost();
    if (this.budgets.daily && todayCost >= this.budgets.daily * this.alertThreshold) {
      webhookService.emit(WebhookEvents.BUDGET_ALERT, {
        period: 'daily', spent: todayCost, budget: this.budgets.daily,
        percentage: Math.round((todayCost / this.budgets.daily) * 100)
      }).catch(() => {});
    }
  }

  getTodayCost() {
    const today = new Date().toISOString().split('T')[0];
    const dayData = this.dailyUsage.get(today) || {};
    return Object.values(dayData).reduce((sum, d) => sum + d.cost, 0);
  }

  getCostByProvider() {
    const today = new Date().toISOString().split('T')[0];
    const dayData = this.dailyUsage.get(today) || {};
    return Object.entries(dayData).map(([provider, data]) => ({
      provider, cost: data.cost, prompt_tokens: data.prompt_tokens, completion_tokens: data.completion_tokens
    })).sort((a, b) => b.cost - a.cost);
  }

  getCostHistory(days = 30) {
    const history = [];
    for (let i = 0; i < days; i++) {
      const date = new Date(); date.setDate(date.getDate() - i);
      const key = date.toISOString().split('T')[0];
      const dayData = this.dailyUsage.get(key) || {};
      history.unshift({ date: key, cost: Object.values(dayData).reduce((s, d) => s + d.cost, 0) });
    }
    return history;
  }

  getSuggestions() {
    const providerCosts = this.getCostByProvider();
    return providerCosts.filter(p => p.cost > 1.0).map(p => ({
      type: 'expensive_provider', provider: p.provider, cost: p.cost,
      message: `${p.provider} costs $${p.cost.toFixed(4)}/day. Consider cheaper alternatives.`
    }));
  }

  getStats() {
    return {
      today: this.getTodayCost(),
      byProvider: this.getCostByProvider(),
      budgets: this.budgets,
      suggestions: this.getSuggestions()
    };
  }
}

const g = globalThis;
if (!g.__9router_cost_tracker) g.__9router_cost_tracker = new CostTracker();
export const costTracker = g.__9router_cost_tracker;