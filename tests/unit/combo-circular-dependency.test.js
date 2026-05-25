import { describe, it, expect, vi, beforeEach } from 'vitest';
import { hasCircularDependency } from '../../src/lib/comboValidation.js';
import * as localDb from '../../src/lib/localDb';

// Mock localDb
vi.mock('../../src/lib/localDb', () => ({
  getCombos: vi.fn(),
}));

describe('hasCircularDependency', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should detect direct circular dependency (combo includes itself)', async () => {
    const result = await hasCircularDependency('combo-a', ['model-1', 'combo-a']);
    expect(result).toBe(true);
  });

  it('should detect indirect circular dependency (A -> B -> A)', async () => {
    // Existing combos in DB
    vi.mocked(localDb.getCombos).mockResolvedValue([
      { id: '1', name: 'combo-b', models: ['model-2', 'combo-a'] }
    ]);

    const result = await hasCircularDependency('combo-a', ['model-1', 'combo-b']);
    expect(result).toBe(true);
  });

  it('should detect deep circular dependency (A -> B -> C -> A)', async () => {
    vi.mocked(localDb.getCombos).mockResolvedValue([
      { id: '1', name: 'combo-b', models: ['combo-c'] },
      { id: '2', name: 'combo-c', models: ['combo-a'] }
    ]);

    const result = await hasCircularDependency('combo-a', ['combo-b']);
    expect(result).toBe(true);
  });

  it('should return false for valid nested combos (A -> B -> model)', async () => {
    vi.mocked(localDb.getCombos).mockResolvedValue([
      { id: '1', name: 'combo-b', models: ['gpt-4o'] }
    ]);

    const result = await hasCircularDependency('combo-a', ['combo-b', 'claude-3-sonnet']);
    expect(result).toBe(false);
  });

  it('should handle updates correctly (ignore own previous state)', async () => {
    // When updating combo-a, it might already be in the DB with old models.
    // We should ignore its OLD state and check the NEW models.
    vi.mocked(localDb.getCombos).mockResolvedValue([
      { id: 'uuid-a', name: 'combo-a', models: ['old-model'] },
      { id: 'uuid-b', name: 'combo-b', models: ['combo-a'] }
    ]);

    // Update combo-a to include combo-b
    const result = await hasCircularDependency('combo-a', ['combo-b'], 'uuid-a');
    expect(result).toBe(true);
  });
});
