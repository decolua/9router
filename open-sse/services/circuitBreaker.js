/**
 * Circuit Breaker for Unstable Providers
 * Automatically isolates failing providers to prevent cascade failures
 */

import { webhookService, WebhookEvents } from '../services/webhooks.js';

export const CircuitState = {
  CLOSED: 'closed',
  OPEN: 'open',
  HALF_OPEN: 'half-open'
};

export class CircuitBreaker {
  constructor(options = {}) {
    this.failureThreshold = options.failureThreshold ?? 5;
    this.successThreshold = options.successThreshold ?? 2;
    this.timeout = options.timeout ?? 60000;
    this.halfOpenMaxRequests = options.halfOpenMaxRequests ?? 3;
    
    this.circuits = new Map();
    this.listeners = new Set();
  }

  _getCircuit(provider) {
    if (!this.circuits.has(provider)) {
      this.circuits.set(provider, {
        state: CircuitState.CLOSED,
        failures: 0,
        successes: 0,
        lastFailure: 0,
        lastStateChange: Date.now(),
        halfOpenRequests: 0
      });
    }
    return this.circuits.get(provider);
  }

  async canExecute(provider) {
    const circuit = this._getCircuit(provider);
    const now = Date.now();

    switch (circuit.state) {
      case CircuitState.CLOSED:
        return { allowed: true };

      case CircuitState.OPEN:
        if (now - circuit.lastFailure >= this.timeout) {
          circuit.state = CircuitState.HALF_OPEN;
          circuit.halfOpenRequests = 0;
          circuit.lastStateChange = now;
          this._notify(provider, circuit);
          return { allowed: true, reason: 'half-open-test' };
        }
        return { 
          allowed: false, 
          reason: 'circuit-open',
          retryAfter: Math.ceil((this.timeout - (now - circuit.lastFailure)) / 1000)
        };

      case CircuitState.HALF_OPEN:
        if (circuit.halfOpenRequests >= this.halfOpenMaxRequests) {
          return { 
            allowed: false, 
            reason: 'half-open-limit',
            retryAfter: 1
          };
        }
        circuit.halfOpenRequests++;
        return { allowed: true, reason: 'half-open-test' };

      default:
        return { allowed: true };
    }
  }

  onSuccess(provider) {
    const circuit = this._getCircuit(provider);
    const prevState = circuit.state;

    if (circuit.state === CircuitState.HALF_OPEN) {
      circuit.successes++;
      circuit.halfOpenRequests = Math.max(0, circuit.halfOpenRequests - 1);
      
      if (circuit.successes >= this.successThreshold) {
        circuit.state = CircuitState.CLOSED;
        circuit.failures = 0;
        circuit.successes = 0;
        circuit.lastStateChange = Date.now();
        this._notify(provider, circuit);
      }
    } else if (circuit.state === CircuitState.CLOSED) {
      circuit.failures = 0;
    }
  }

  onFailure(provider, error) {
    const circuit = this._getCircuit(provider);
    const now = Date.now();

    circuit.failures++;
    circuit.lastFailure = now;
    circuit.successes = 0;

    if (circuit.state === CircuitState.HALF_OPEN) {
      circuit.state = CircuitState.OPEN;
      circuit.halfOpenRequests = 0;
      circuit.lastStateChange = now;
      this._notify(provider, circuit);
    } else if (circuit.state === CircuitState.CLOSED) {
      if (circuit.failures >= this.failureThreshold) {
        circuit.state = CircuitState.OPEN;
        circuit.lastStateChange = now;
        this._notify(provider, circuit);
      }
    }
  }

  async execute(provider, fn) {
    const check = await this.canExecute(provider);
    if (!check.allowed) {
      const err = new Error(`Circuit ${check.reason} for ${provider}`);
      err.code = 'CIRCUIT_OPEN';
      err.retryAfter = check.retryAfter;
      err.provider = provider;
      throw err;
    }

    try {
      const result = await fn();
      this.onSuccess(provider);
      return result;
    } catch (err) {
      if (this._isFailure(err)) {
        this.onFailure(provider, err);
      }
      throw err;
    }
  }

  _isFailure(error) {
    if (!error) return false;
    
    if (error.code === 'ECONNREFUSED' || 
        error.code === 'ETIMEDOUT' ||
        error.code === 'ENOTFOUND' ||
        error.name === 'TimeoutError') {
      return true;
    }

    const status = error.status || error.response?.status || error.statusCode;
    if (status) {
      if (status >= 500 && status < 600) return true;
      if (status === 429 || status === 402) return true;
      if (status === 502 || status === 503 || status === 504) return true;
    }

    const msg = error.message?.toLowerCase() || '';
    const failurePatterns = [
      'overloaded', 'capacity', 'unavailable', 'timeout',
      'connection refused', 'econnrefused', 'etimedout',
      'rate limit', 'quota exceeded', 'billing'
    ];
    if (failurePatterns.some(p => msg.includes(p))) return true;

    return false;
  }

  getState(provider) {
    const circuit = this.circuits.get(provider);
    if (!circuit) return { state: CircuitState.CLOSED, failures: 0 };
    return { ...circuit };
  }

  getAllStates() {
    return Object.fromEntries(this.circuits);
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  _notify(provider, circuit) {
    for (const fn of this.listeners) {
      try { fn(provider, circuit); } catch (e) { console.error('Circuit breaker listener error:', e); }
    }
    
    // Emit webhook event on state change
    if (circuit.state === CircuitState.OPEN) {
      webhookService.emit(WebhookEvents.CIRCUIT_OPENED, {
        provider,
        failures: circuit.failures,
        timestamp: new Date().toISOString()
      }).catch(e => console.error('Webhook emit failed:', e));
    }
  }

  reset(provider) {
    const circuit = this._getCircuit(provider);
    circuit.state = CircuitState.CLOSED;
    circuit.failures = 0;
    circuit.successes = 0;
    circuit.halfOpenRequests = 0;
    circuit.lastStateChange = Date.now();
    this._notify(provider, circuit);
  }

  forceOpen(provider) {
    const circuit = this._getCircuit(provider);
    circuit.state = CircuitState.OPEN;
    circuit.lastStateChange = Date.now();
    this._notify(provider, circuit);
  }
}

export const circuitBreaker = new CircuitBreaker({
  failureThreshold: 5,
  successThreshold: 2,
  timeout: 60000,
  halfOpenMaxRequests: 3
});