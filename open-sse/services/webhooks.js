/**
 * Webhook Notification Service for 9Router
 * Sends HTTP callbacks for critical events with retry and HMAC signing.
 * Persisted to SQLite via the shared DB adapter.
 */

import { createHmac } from 'crypto';
import { recordWebhook } from '../services/metrics.js';
import { getAdapter } from '../../src/lib/db/driver.js';

export const WebhookEvents = {
  PROVIDER_UNHEALTHY: 'provider.unhealthy',
  PROVIDER_RECOVERED: 'provider.recovered',
  QUOTA_EXHAUSTED: 'quota.exhausted',
  BUDGET_ALERT: 'budget.alert',
  CIRCUIT_OPENED: 'circuit.opened',
  FALLBACK_STORM: 'fallback.storm',
  HIGH_ERROR_RATE: 'high.error.rate',
  TEST: 'test',
};

let _tableReady = false;
async function ensureTable() {
  if (_tableReady) return;
  const db = await getAdapter();
  db.exec(`CREATE TABLE IF NOT EXISTS webhooks (
    id TEXT PRIMARY KEY,
    url TEXT NOT NULL,
    events TEXT NOT NULL,
    secret TEXT,
    name TEXT,
    headers TEXT DEFAULT '{}',
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    last_delivery TEXT,
    failure_count INTEGER DEFAULT 0
  )`);
  _tableReady = true;
}

function rowToWebhook(row) {
  if (!row) return null;
  return {
    id: row.id,
    url: row.url,
    events: JSON.parse(row.events),
    secret: row.secret || null,
    name: row.name || row.id,
    headers: JSON.parse(row.headers || '{}'),
    disabled: !row.is_active,
    createdAt: row.created_at,
    lastDelivery: row.last_delivery,
    failureCount: row.failure_count || 0,
  };
}

export class WebhookService {
  constructor() {
    this.retryQueue = [];
    this.processing = false;
    ensureTable().catch(e => console.error('[Webhooks] table init error:', e.message));
  }

  async register(config) {
    await ensureTable();
    const db = await getAdapter();
    const id = crypto.randomUUID();
    const events = JSON.stringify(config.events || []);
    const headers = JSON.stringify(config.headers || {});

    db.run(
      `INSERT INTO webhooks (id, url, events, secret, name, headers) VALUES (?, ?, ?, ?, ?, ?)`,
      [id, config.url, events, config.secret, config.name || id, headers]
    );

    return await this.get(id);
  }

  async unregister(id) {
    await ensureTable();
    const db = await getAdapter();
    db.run(`DELETE FROM webhooks WHERE id = ?`, [id]);
    return true;
  }

  async getAll() {
    await ensureTable();
    const db = await getAdapter();
    const rows = db.all(`SELECT * FROM webhooks ORDER BY created_at DESC`);
    return rows.map(r => {
      const w = rowToWebhook(r);
      w.secret = w.secret ? '***' : null;
      return w;
    });
  }

  async get(id) {
    await ensureTable();
    const db = await getAdapter();
    const row = db.get(`SELECT * FROM webhooks WHERE id = ?`, [id]);
    const w = rowToWebhook(row);
    if (w) w.secret = w.secret ? '***' : null;
    return w;
  }

  async _getFull(id) {
    await ensureTable();
    const db = await getAdapter();
    const row = db.get(`SELECT * FROM webhooks WHERE id = ?`, [id]);
    return rowToWebhook(row);
  }

  async update(id, config) {
    await ensureTable();
    const db = await getAdapter();
    const fields = [];
    const values = [];
    if (config.url !== undefined) { fields.push('url = ?'); values.push(config.url); }
    if (config.events !== undefined) { fields.push('events = ?'); values.push(JSON.stringify(config.events)); }
    if (config.secret !== undefined) { fields.push('secret = ?'); values.push(config.secret); }
    if (config.name !== undefined) { fields.push('name = ?'); values.push(config.name); }
    if (config.headers !== undefined) { fields.push('headers = ?'); values.push(JSON.stringify(config.headers)); }
    if (config.disabled !== undefined) { fields.push('is_active = ?'); values.push(config.disabled ? 0 : 1); }
    if (fields.length === 0) return false;
    values.push(id);
    db.run(`UPDATE webhooks SET ${fields.join(', ')} WHERE id = ?`, values);
    return true;
  }

  async emit(event, data) {
    await ensureTable();
    const db = await getAdapter();
    const rows = db.all(`SELECT * FROM webhooks WHERE is_active = 1`);

    for (const row of rows) {
      const webhook = rowToWebhook(row);
      if (webhook.events.includes(event)) {
        this._queueDelivery(webhook, event, data);
      }
    }
  }

  _queueDelivery(webhook, event, data) {
    const payload = { event, timestamp: new Date().toISOString(), data };
    const body = JSON.stringify(payload);
    const signature = webhook.secret
      ? `sha256=${createHmac('sha256', webhook.secret).update(body).digest('hex')}`
      : null;

    const headers = {
      'Content-Type': 'application/json',
      'X-9Router-Event': event,
      'X-9Router-Delivery': `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
      ...(webhook.headers || {}),
    };
    if (signature) headers['X-9Router-Signature'] = signature;

    const delivery = {
      webhookId: webhook.id,
      event,
      payload,
      headers,
      attempt: 0,
      maxAttempts: 3,
      nextRetry: Date.now(),
    };

    this.retryQueue.push(delivery);
    if (!this.processing) this._processQueue();
  }

  async _processQueue() {
    this.processing = true;
    while (this.retryQueue.length > 0) {
      const delivery = this.retryQueue.shift();
      if (Date.now() < delivery.nextRetry) {
        this.retryQueue.unshift(delivery);
        await new Promise(r => setTimeout(r, 1000));
        continue;
      }
      await this._deliver(delivery);
    }
    this.processing = false;
  }

  async _deliver(delivery) {
    const webhook = await this._getFull(delivery.webhookId);
    if (!webhook || webhook.disabled) return;

    delivery.attempt++;
    const { payload, attempt, maxAttempts } = delivery;

    try {
      const response = await fetch(webhook.url, {
        method: 'POST',
        headers: delivery.headers,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10000),
      });

      const success = response.ok;
      recordWebhook({ webhookId: webhook.id, event: delivery.event, status: success ? 'success' : 'failure' });

      if (!success) throw new Error(`HTTP ${response.status}`);

      const db = await getAdapter();
      db.run(`UPDATE webhooks SET last_delivery = datetime('now'), failure_count = 0 WHERE id = ?`, [webhook.id]);

    } catch (error) {
      recordWebhook({ webhookId: webhook.id, event: delivery.event, status: 'failure', error: error.message });

      const db = await getAdapter();
      if (attempt >= maxAttempts) {
        const newCount = webhook.failureCount + 1;
        if (newCount >= 10) {
          db.run(`UPDATE webhooks SET failure_count = ?, is_active = 0 WHERE id = ?`, [newCount, webhook.id]);
        } else {
          db.run(`UPDATE webhooks SET failure_count = ? WHERE id = ?`, [newCount, webhook.id]);
        }
      } else {
        const delay = Math.min(1000 * Math.pow(5, attempt - 1), 600000);
        delivery.nextRetry = Date.now() + delay;
        this.retryQueue.push(delivery);
      }
    }
  }

  async test(id) {
    const webhook = await this._getFull(id);
    if (!webhook) throw new Error('Webhook not found');

    const payload = {
      event: 'test',
      timestamp: new Date().toISOString(),
      data: { message: 'Test webhook from 9Router' },
    };

    const body = JSON.stringify(payload);
    const signature = webhook.secret
      ? `sha256=${createHmac('sha256', webhook.secret).update(body).digest('hex')}`
      : null;

    const headers = {
      'Content-Type': 'application/json',
      'X-9Router-Event': 'test',
      'X-9Router-Delivery': `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
      ...(webhook.headers || {}),
    };
    if (signature) headers['X-9Router-Signature'] = signature;

    try {
      const response = await fetch(webhook.url, {
        method: 'POST',
        headers,
        body,
        signal: AbortSignal.timeout(10000),
      });
      return { success: response.ok, status: response.status };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
}

export const webhookService = new WebhookService();