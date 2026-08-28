/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { test, expect, describe, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import PlaygroundStudio from '../../../src/app/(dashboard)/dashboard/playground/PlaygroundStudio.jsx';
import * as modelCatalog from '../../../src/app/(dashboard)/dashboard/playground/lib/modelCatalog.js';
import { PLAYGROUND_PERSISTENCE_KEYS } from '../../../src/app/(dashboard)/dashboard/playground/lib/persistence.js';

vi.mock('../../../src/app/(dashboard)/dashboard/playground/lib/modelCatalog.js', () => ({
  fetchModelCatalog: vi.fn(),
  normalizeModelCatalog: vi.fn()
}));

describe('PlaygroundStudio Shell', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('renders tabs and config pane, and tab switching works', async () => {
    modelCatalog.fetchModelCatalog.mockResolvedValue({ models: [] });

    render(React.createElement(PlaygroundStudio));

    const studio = screen.getByTestId('playground-studio');
    expect(studio).toBeDefined();

    const chatTabBtn = screen.getByTestId('playground-chat-tab');
    const compareTabBtn = screen.getByTestId('playground-compare-tab');

    expect(chatTabBtn).toBeDefined();
    expect(compareTabBtn).toBeDefined();

    // Verify accessibility attributes
    expect(screen.getByRole('tablist')).toBeDefined();
    expect(chatTabBtn.getAttribute('role')).toBe('tab');
    expect(compareTabBtn.getAttribute('role')).toBe('tab');
    expect(chatTabBtn.getAttribute('aria-selected')).toBe('true');
    expect(compareTabBtn.getAttribute('aria-selected')).toBe('false');

    expect(chatTabBtn.className).toContain('text-primary');
    expect(screen.getByTestId('playground-chat-workspace')).toBeDefined();
    expect(screen.getByTestId('playground-chat-workspace').parentElement.getAttribute('hidden')).toBeNull();
    expect(screen.getByTestId('playground-compare-workspace').parentElement.getAttribute('hidden')).toBe('');

    fireEvent.click(compareTabBtn);

    expect(compareTabBtn.className).toContain('text-primary');
    expect(chatTabBtn.getAttribute('aria-selected')).toBe('false');
    expect(compareTabBtn.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByTestId('playground-compare-workspace').parentElement.getAttribute('hidden')).toBeNull();
    expect(screen.getByTestId('playground-chat-workspace').parentElement.getAttribute('hidden')).toBe('');
  });

  test('handles keyboard navigation between tabs', async () => {
    modelCatalog.fetchModelCatalog.mockResolvedValue({ models: [] });

    render(React.createElement(PlaygroundStudio));
    
    const chatTabBtn = screen.getByTestId('playground-chat-tab');
    const compareTabBtn = screen.getByTestId('playground-compare-tab');
    
    // Initial state
    expect(chatTabBtn.getAttribute('aria-selected')).toBe('true');
    chatTabBtn.focus();
    expect(document.activeElement).toBe(chatTabBtn);
    
    // Right arrow
    fireEvent.keyDown(chatTabBtn, { key: 'ArrowRight' });
    expect(compareTabBtn.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(compareTabBtn);
    
    // Left arrow
    fireEvent.keyDown(compareTabBtn, { key: 'ArrowLeft' });
    expect(chatTabBtn.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(chatTabBtn);
    
    // End key
    fireEvent.keyDown(chatTabBtn, { key: 'End' });
    expect(compareTabBtn.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(compareTabBtn);
    
    // Home key
    fireEvent.keyDown(compareTabBtn, { key: 'Home' });
    expect(chatTabBtn.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(chatTabBtn);
  });

  test('handles loading, empty, and error states gracefully without exposing secrets', async () => {
    let resolvePromise;
    const promise = new Promise((resolve) => { resolvePromise = resolve; });
    modelCatalog.fetchModelCatalog.mockReturnValue(promise);

    const { unmount } = render(React.createElement(PlaygroundStudio));
    expect(screen.getByRole('status', { name: 'Loading models...' })).toBeDefined();

    resolvePromise({ models: [] });
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeDefined();
    });
    expect(screen.getByText(/No models available/)).toBeDefined();

    unmount();

    modelCatalog.fetchModelCatalog.mockRejectedValue(new Error('Network error'));
    render(React.createElement(PlaygroundStudio));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeDefined();
    });
    expect(screen.getByText('Network error')).toBeDefined();
  });

  test('hydrates persisted namespaces before saving and keeps restored values intact', async () => {
    const persisted = {
      sessions: [{ id: 'saved-session', updatedAt: '2026-08-27T00:00:00.000Z', messages: [{ role: 'user', content: 'saved history' }] }],
      presets: [{ id: 'saved-preset', config: { stop: ['END'] } }],
      config: { systemPrompt: 'restored prompt', temperature: 0.2, maxTokens: 400, model: { id: 'safe/model', label: 'Safe model' } },
      selection: { activeSessionId: 'saved-session' },
      draft: 'restored draft',
    };
    localStorage.setItem(PLAYGROUND_PERSISTENCE_KEYS.sessions, JSON.stringify({ version: 1, value: persisted.sessions }));
    localStorage.setItem(PLAYGROUND_PERSISTENCE_KEYS.presetsConfig, JSON.stringify({ version: 1, value: { presets: persisted.presets, config: persisted.config } }));
    localStorage.setItem(PLAYGROUND_PERSISTENCE_KEYS.selection, JSON.stringify({ version: 1, value: persisted.selection }));
    localStorage.setItem(PLAYGROUND_PERSISTENCE_KEYS.draft, JSON.stringify({ version: 1, value: persisted.draft }));
    modelCatalog.fetchModelCatalog.mockResolvedValue({ models: [] });

    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');
    render(React.createElement(PlaygroundStudio));

    await waitFor(() => {
      expect(screen.getByLabelText('System Prompt').value).toBe('restored prompt');
      expect(screen.getByPlaceholderText('Send a message...').value).toBe('restored draft');
    });

    // No write during mount/hydration may contain the pristine empty state.
    // A save gated on a ref (rather than `hydrated`) fires on the first render
    // with the initial empty closure and would be caught here even though a
    // later write overwrites it with restored data.
    const emptyEnvelopes = {
      [PLAYGROUND_PERSISTENCE_KEYS.sessions]: { version: 1, value: [] },
      [PLAYGROUND_PERSISTENCE_KEYS.presetsConfig]: { version: 1, value: { presets: [], config: { systemPrompt: '', temperature: 0.7, maxTokens: 2000, model: null } } },
      [PLAYGROUND_PERSISTENCE_KEYS.selection]: { version: 1, value: {} },
      [PLAYGROUND_PERSISTENCE_KEYS.draft]: { version: 1, value: '' },
    };
    for (const [key, emptyEnvelope] of Object.entries(emptyEnvelopes)) {
      const writes = setItemSpy.mock.calls.filter(([callKey]) => callKey === key);
      expect(writes.length).toBeGreaterThan(0);
      for (const [, value] of writes) {
        expect(JSON.parse(value)).not.toEqual(emptyEnvelope);
      }
    }

    expect(JSON.parse(localStorage.getItem(PLAYGROUND_PERSISTENCE_KEYS.sessions)).value[0].id).toBe('saved-session');
    expect(JSON.parse(localStorage.getItem(PLAYGROUND_PERSISTENCE_KEYS.presetsConfig)).value.presets[0].id).toBe('saved-preset');
    expect(JSON.parse(localStorage.getItem(PLAYGROUND_PERSISTENCE_KEYS.selection)).value.activeSessionId).toBe('saved-session');
    expect(JSON.parse(localStorage.getItem(PLAYGROUND_PERSISTENCE_KEYS.draft)).value).toBe('restored draft');
  });

  test('streams Chat through Studio into the sanitized Inspector and persisted session', async () => {
    const unsafeModel = {
      id: 'safe/model',
      label: 'Safe model',
      provider: { id: 'safe', name: 'Safe' },
      capabilities: {},
      authorization: 'Bearer sk-secret-value',
    };
    modelCatalog.fetchModelCatalog.mockResolvedValue({ models: [unsafeModel] });
    const encoder = new TextEncoder();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: {
        getReader: () => ({
          read: vi.fn()
            .mockResolvedValueOnce({ done: false, value: encoder.encode('data: {"choices":[{"delta":{"content":"Studio output"}}],"usage":{"prompt_tokens":2,"completion_tokens":3,"total_tokens":5}}\n\ndata: [DONE]\n\n') }),
          cancel: vi.fn().mockResolvedValue(undefined),
        }),
      },
    });

    render(React.createElement(PlaygroundStudio));
    await waitFor(() => expect(screen.getByLabelText('Select Model')).toBeDefined());
    fireEvent.change(screen.getByLabelText('Select Model'), { target: { value: 'safe/model' } });
    fireEvent.change(screen.getByPlaceholderText('Send a message...'), { target: { value: 'Inspect this' } });
    fireEvent.click(screen.getByTestId('playground-send'));

    await waitFor(() => {
      const inspector = screen.getByTestId('playground-inspector').textContent;
      expect(inspector).toContain('safe/model');
      expect(inspector).toContain('HTTP 200');
      expect(inspector).toContain('Studio output');
      expect(inspector).toContain('complete');
      expect(inspector).toContain('5');
    });

    const storage = Object.values(PLAYGROUND_PERSISTENCE_KEYS).map((key) => localStorage.getItem(key)).join('');
    expect(screen.getByTestId('playground-inspector').textContent).not.toContain('sk-secret-value');
    expect(storage).not.toContain('sk-secret-value');
  });

  test('exposes the connected catalog to separate Compare selectors before a global model is selected', async () => {
    const connectedModels = [
      {
        id: 'alpha/first',
        label: 'First',
        provider: { id: 'alpha', name: 'Alpha', connectionId: 'connection-a' },
        available: true,
        capabilities: {},
      },
      {
        id: 'beta/second',
        label: 'Second',
        provider: { id: 'beta', name: 'Beta', connectionId: 'connection-b' },
        available: true,
        capabilities: {},
      },
    ];
    modelCatalog.fetchModelCatalog.mockResolvedValue({ models: connectedModels });

    render(React.createElement(PlaygroundStudio));
    fireEvent.click(screen.getByTestId('playground-compare-tab'));

    await waitFor(() => {
      const selectors = screen.getAllByRole('combobox');
      expect(selectors).toHaveLength(3);
      for (const selector of selectors.slice(1)) {
        expect(Array.from(selector.options, (option) => option.value)).toEqual([
          '',
          'alpha/first',
          'beta/second',
        ]);
      }
    });

    const [, firstColumn, secondColumn] = screen.getAllByRole('combobox');
    fireEvent.change(firstColumn, { target: { value: 'alpha/first' } });
    fireEvent.change(secondColumn, { target: { value: 'beta/second' } });

    expect(firstColumn.value).toBe('alpha/first');
    expect(secondColumn.value).toBe('beta/second');
  });

  test('desktop and mobile structural responsive classes', async () => {
    modelCatalog.fetchModelCatalog.mockResolvedValue({ models: [] });
    render(React.createElement(PlaygroundStudio));

    const rootContainer = screen.getByTestId('playground-studio');
    // Ensure 1440px desktop gets row layout via lg:flex-row
    expect(rootContainer.className).toContain('lg:flex-row');
    // Ensure mobile uses col layout natively
    expect(rootContainer.className).toContain('flex-col');
    
    const panesContainer = screen.getByTestId('playground-inspector').parentElement;
    // Mobile secondary container (Inspector + ConfigPane) stacked under workspace
    expect(panesContainer.className).toContain('w-full');
    expect(panesContainer.className).toContain('flex-col');
    // lg desktop uses row layout for Inspector + ConfigPane next to workspace
    expect(panesContainer.className).toContain('lg:flex-row');
    expect(panesContainer.className).toContain('lg:h-full');
    expect(panesContainer.className).toContain('lg:overflow-hidden');
  });

  test('preserves configuration across tab switches', async () => {
    modelCatalog.fetchModelCatalog.mockResolvedValue({
      models: [{
        id: "alpha/zeta",
        label: "Zeta",
        provider: { id: "alpha", name: "Alpha", connectionId: "connection-a" },
        available: true,
        capabilities: { vision: true, reasoning: true, maxOutput: 1024 },
      }]
    });

    render(React.createElement(PlaygroundStudio));

    await waitFor(() => {
      expect(screen.getByLabelText('Select Model')).toBeDefined();
    });

    const sysPromptInput = screen.getByLabelText('System Prompt');
    fireEvent.change(sysPromptInput, { target: { value: 'Test prompt 123' } });

    expect(sysPromptInput.value).toBe('Test prompt 123');

    fireEvent.click(screen.getByTestId('playground-compare-tab'));

    expect(screen.getByLabelText('System Prompt').value).toBe('Test prompt 123');
  });
});
