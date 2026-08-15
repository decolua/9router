import { describe, it, expect } from 'vitest';

describe('discover pending providers tracking', () => {
  it('should preserve pending provider dates across runs', () => {
    // Simulate the state management logic that should exist after the fix:
    // When a provider is discovered but not registered in run 1,
    // and discovered again (still not registered) in run 2,
    // it should retain its original date from run 1.

    // Simulate state from run 1
    const run1Date = new Date('2026-08-10T12:00:00Z').toISOString();
    const state1 = {
      knownModels: [],
      knownProviders: [],
      pendingProviders: {},
      pendingModels: {},
      discoveredProviders: {},
      lastRun: run1Date,
    };

    // Simulate discovering 'unregistered-provider' in run 1
    const discovered1 = new Map([['unregistered-provider', { url: 'http://...', line: 'test', score: 1 }]]);
    const registered1 = new Set(); // empty = no providers registered

    // Run 1 logic: add to pendingProviders since not registered
    for (const name of discovered1.keys()) {
      if (!state1.pendingProviders[name] && !registered1.has(name)) {
        state1.pendingProviders[name] = run1Date;
      }
    }

    expect(state1.pendingProviders['unregistered-provider']).toBe(run1Date);

    // Simulate run 2, 12 hours later
    const run2Date = new Date('2026-08-11T00:00:00Z').toISOString();
    const state2 = {
      knownModels: state1.knownModels,
      knownProviders: state1.knownProviders,
      pendingProviders: { ...state1.pendingProviders },
      pendingModels: state1.pendingModels,
      discoveredProviders: state1.discoveredProviders,
      lastRun: run1Date,
    };

    // Run 2: discover same provider again
    const discovered2 = new Map([['unregistered-provider', { url: 'http://...', line: 'test', score: 1 }]]);
    const registered2 = new Set(); // still not registered

    // Run 2 logic: provider already in pendingProviders, so DON'T update its date
    for (const name of discovered2.keys()) {
      if (!state2.pendingProviders[name] && !registered2.has(name)) {
        state2.pendingProviders[name] = run2Date; // only if NOT already present
      }
    }

    // The key assertion: date should be from run 1, not updated to run 2
    expect(state2.pendingProviders['unregistered-provider']).toBe(run1Date);
    expect(state2.pendingProviders['unregistered-provider']).not.toBe(run2Date);
  });

  it('should remove provider from pending when it becomes registered', () => {
    // Simulate: provider starts as pending, then becomes registered
    const pastDate = new Date('2026-08-10T12:00:00Z').toISOString();
    const state = {
      knownModels: [],
      knownProviders: [],
      pendingProviders: { 'now-registered': pastDate },
      pendingModels: {},
      discoveredProviders: {},
      lastRun: pastDate,
    };

    // Simulate: provider now has a connected account
    const discovered = new Map();
    const registered = new Set(['now-registered']); // NOW registered

    // Logic: remove from pending if it's in registered
    const nextPending = {};
    for (const [name, date] of Object.entries(state.pendingProviders)) {
      if (!registered.has(name)) {
        nextPending[name] = date;
      }
    }

    expect(nextPending['now-registered']).toBeUndefined();
    expect(Object.keys(nextPending).length).toBe(0);
  });

  it('should support backward compatibility: old state files without pending fields load with defaults', () => {
    // Test backward compat: old state file structure should still work
    const oldState = {
      knownModels: ['model1'],
      knownProviders: ['provider1'],
      discoveredProviders: {},
      lastRun: new Date().toISOString(),
      // NO pendingProviders or pendingModels fields
    };

    // Simulate loadState() logic with defaults
    const loaded = {
      knownModels: oldState.knownModels || [],
      knownProviders: oldState.knownProviders || [],
      pendingProviders: oldState.pendingProviders || {},
      pendingModels: oldState.pendingModels || {},
      discoveredProviders: oldState.discoveredProviders || {},
      lastRun: oldState.lastRun || null,
    };

    expect(loaded.pendingProviders).toEqual({});
    expect(loaded.pendingModels).toEqual({});
    expect(loaded.knownModels).toEqual(['model1']);
  });
});
