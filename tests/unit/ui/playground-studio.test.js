/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { test, expect, describe, vi, afterEach, beforeEach } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import PlaygroundStudio from '../../../src/app/(dashboard)/dashboard/playground/PlaygroundStudio.jsx';
import StudioConfigPane from '../../../src/app/(dashboard)/dashboard/playground/components/StudioConfigPane.jsx';
import CompareWorkspace from '../../../src/app/(dashboard)/dashboard/playground/components/tabs/CompareWorkspace.jsx';
import * as modelCatalog from '../../../src/app/(dashboard)/dashboard/playground/lib/modelCatalog.js';
import { PLAYGROUND_PERSISTENCE_KEYS } from '../../../src/app/(dashboard)/dashboard/playground/lib/persistence.js';

vi.mock('../../../src/app/(dashboard)/dashboard/playground/lib/modelCatalog.js', () => ({
  fetchModelCatalog: vi.fn(),
  normalizeModelCatalog: vi.fn()
}));

const providerFilterModels = [
  { id: 'wrongprefix/first', label: 'First', provider: { id: 'alpha', name: 'Zulu', connectionId: 'a-2' } },
  { id: 'alpha/second', label: 'Second', provider: { id: 'alpha', name: 'Alpha', connectionId: 'a-1' } },
  { id: 'beta/third', label: 'Third', provider: { id: 'beta', name: 'Shared', connectionId: 'b-1' } },
  { id: 'gamma/fourth', label: 'Fourth', provider: { id: 'gamma', name: 'Shared', connectionId: 'g-1' } },
  { id: 'delta/fifth', label: 'Fifth', provider: { id: ' delta ', name: '   ', connectionId: 'd-1' } },
  { id: 'missing/sixth', label: 'Missing', provider: { name: 'Missing ID', connectionId: 'm-1' } },
  { id: 'blank/seventh', label: 'Blank', provider: { id: '   ', name: 'Blank ID', connectionId: 'z-1' } },
  { id: 'numeric/eighth', label: 'Numeric', provider: { id: 8, name: 'Numeric ID', connectionId: 'n-1' } },
];

function renderCompareWorkspace({ models = providerFilterModels, onResult = vi.fn() } = {}) {
  return render(React.createElement(CompareWorkspace, {
    configState: { systemPrompt: '', params: { temperature: 0.7, max_tokens: 2000 } },
    availableModels: models,
    onResult,
    draft: '',
    onDraftChange: vi.fn(),
  }));
}

function successfulCompareResponse(text = 'Done') {
  const encoder = new TextEncoder();
  return {
    ok: true,
    status: 200,
    body: {
      getReader: () => ({
        read: vi.fn()
          .mockResolvedValueOnce({ done: false, value: encoder.encode(`data: {"choices":[{"delta":{"content":"${text}"}}]}\n\ndata: [DONE]\n\n`) })
          .mockResolvedValueOnce({ done: true, value: undefined }),
        cancel: vi.fn().mockResolvedValue(undefined),
      }),
    },
  };
}

function renderConfigPane({ models = providerFilterModels, config = {}, loading = false, error = null } = {}) {
  function Harness() {
    const [currentConfig, setCurrentConfig] = React.useState({
      systemPrompt: '',
      temperature: 0.7,
      maxTokens: 2000,
      model: null,
      ...config,
    });
    return React.createElement(React.Fragment, null,
      React.createElement(StudioConfigPane, {
        config: currentConfig,
        onChange: setCurrentConfig,
        models,
        loading,
        error,
      }),
      React.createElement('output', { 'data-testid': 'config-state' }, JSON.stringify(currentConfig))
    );
  }

  return render(React.createElement(Harness));
}

describe('PlaygroundStudio Shell', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
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
    expect(screen.queryByTestId('chat-provider-filter')).toBeNull();

    resolvePromise({ models: [] });
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeDefined();
    });
    expect(screen.getByText(/No models available/)).toBeDefined();
    expect(screen.queryByTestId('chat-provider-filter')).toBeNull();

    unmount();

    modelCatalog.fetchModelCatalog.mockRejectedValue(new Error('Network error'));
    render(React.createElement(PlaygroundStudio));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeDefined();
    });
    expect(screen.getByText('Network error')).toBeDefined();
    expect(screen.queryByTestId('chat-provider-filter')).toBeNull();
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

    const submittedBody = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(submittedBody.model).toBe('safe/model');

    const storage = Object.values(PLAYGROUND_PERSISTENCE_KEYS).map((key) => localStorage.getItem(key)).join('');
    expect(screen.getByTestId('playground-inspector').textContent).not.toContain('sk-secret-value');
    expect(storage).not.toContain('sk-secret-value');
  });

  test('exposes the loaded catalog with full model IDs in the Chat selector', async () => {
    const connectedModels = [
      {
        id: 'wrongprefix/first',
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

    await waitFor(() => {
      const selector = screen.getByLabelText('Select Model');
      expect(Array.from(selector.options, (option) => option.value)).toEqual([
        '',
        'wrongprefix/first',
        'beta/second',
      ]);
    });
  });

  test('derives stable canonical Chat provider options and filters only by provider ID identity', () => {
    const { unmount } = renderConfigPane();
    const providerFilter = screen.getByTestId('chat-provider-filter');

    expect(providerFilter.tagName).toBe('SELECT');
    expect(providerFilter.getAttribute('aria-label')).toBe('Filter models by provider');
    expect(providerFilterModels[0]).toMatchObject({
      id: 'wrongprefix/first',
      provider: { id: 'alpha', name: 'Zulu', connectionId: 'a-2' },
    });
    expect(providerFilterModels[1]).toMatchObject({
      id: 'alpha/second',
      provider: { id: 'alpha', name: 'Alpha', connectionId: 'a-1' },
    });
    expect(Array.from(providerFilter.options, (option) => [option.value, option.textContent])).toEqual([
      ['', 'All providers'],
      ['alpha', 'Alpha'],
      ['beta', 'Shared'],
      ['gamma', 'Shared'],
      ['delta', 'delta'],
    ]);

    fireEvent.change(providerFilter, { target: { value: 'alpha' } });
    const modelSelect = screen.getByRole('combobox', { name: 'Select Model' });
    expect(modelSelect.tagName).toBe('SELECT');
    expect(modelSelect).not.toBe(providerFilter);
    expect(Array.from(modelSelect.options, (option) => option.value)).toEqual([
      '',
      'wrongprefix/first',
      'alpha/second',
    ]);

    unmount();
    const reversed = renderConfigPane({ models: [...providerFilterModels].reverse() });
    expect(Array.from(screen.getByTestId('chat-provider-filter').options, (option) => [option.value, option.textContent])).toEqual([
      ['', 'All providers'],
      ['alpha', 'Alpha'],
      ['beta', 'Shared'],
      ['gamma', 'Shared'],
      ['delta', 'delta'],
    ]);
    reversed.unmount();
  });

  test('clears an incompatible Chat model with an explicit model-null configuration transition', () => {
    const { unmount } = renderConfigPane({ config: { model: providerFilterModels[0] } });
    const providerFilter = screen.getByTestId('chat-provider-filter');
    const modelSelect = screen.getByLabelText('Select Model');

    fireEvent.change(providerFilter, { target: { value: 'alpha' } });
    expect(modelSelect.value).toBe('wrongprefix/first');
    fireEvent.change(providerFilter, { target: { value: '' } });
    expect(modelSelect.value).toBe('wrongprefix/first');
    fireEvent.change(providerFilter, { target: { value: 'beta' } });
    expect(modelSelect.value).toBe('');
    expect(JSON.parse(screen.getByTestId('config-state').textContent).model).toBeNull();

    unmount();
    const catalogAbsent = renderConfigPane({ config: { model: { id: 'historic/model', label: 'Historic' } } });
    expect(JSON.parse(screen.getByTestId('config-state').textContent).model).toEqual({
      id: 'historic/model',
      label: 'Historic',
    });
    expect(screen.getByLabelText('Select Model').value).toBe('');
    fireEvent.change(screen.getByTestId('chat-provider-filter'), { target: { value: 'alpha' } });
    expect(screen.getByLabelText('Select Model').value).toBe('');
    expect(JSON.parse(screen.getByTestId('config-state').textContent).model).toBeNull();

    catalogAbsent.unmount();
    const catalogPresent = renderConfigPane({ config: { model: { id: 'wrongprefix/first', label: 'Historic without provider' } } });
    fireEvent.change(screen.getByTestId('chat-provider-filter'), { target: { value: 'alpha' } });
    expect(screen.getByLabelText('Select Model').value).toBe('wrongprefix/first');
    expect(JSON.parse(screen.getByTestId('config-state').textContent).model).toEqual({
      id: 'wrongprefix/first',
      label: 'Historic without provider',
    });
    catalogPresent.unmount();
  });

  test('prevents a cleared hidden Chat model from submission and keeps the provider filter ephemeral', async () => {
    modelCatalog.fetchModelCatalog.mockResolvedValue({ models: providerFilterModels });
    global.fetch = vi.fn();

    render(React.createElement(PlaygroundStudio));
    await waitFor(() => expect(screen.getByTestId('chat-provider-filter')).toBeDefined());

    fireEvent.change(screen.getByLabelText('Select Model'), { target: { value: 'wrongprefix/first' } });
    await waitFor(() => {
      const persisted = JSON.parse(localStorage.getItem(PLAYGROUND_PERSISTENCE_KEYS.presetsConfig));
      expect(persisted.value.config.model.id).toBe('wrongprefix/first');
      expect(persisted.value.config).not.toHaveProperty('providerId');
      expect(persisted.value.config).not.toHaveProperty('providerFilter');
    });

    fireEvent.change(screen.getByTestId('chat-provider-filter'), { target: { value: 'beta' } });
    await waitFor(() => {
      const persisted = JSON.parse(localStorage.getItem(PLAYGROUND_PERSISTENCE_KEYS.presetsConfig));
      expect(persisted.value.config.model).toBeNull();
      expect(persisted.value.config).not.toHaveProperty('providerId');
      expect(persisted.value.config).not.toHaveProperty('providerFilter');
    });

    fireEvent.change(screen.getByPlaceholderText('Send a message...'), { target: { value: 'Do not send stale Alpha' } });
    fireEvent.click(screen.getByTestId('playground-send'));

    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('does not clear the selected Chat model solely when catalog state becomes loading or errored', () => {
    const onChange = vi.fn();
    const config = {
      systemPrompt: '',
      temperature: 0.7,
      maxTokens: 2000,
      model: providerFilterModels[0],
    };
    const { rerender } = render(React.createElement(StudioConfigPane, {
      config,
      onChange,
      models: providerFilterModels,
      loading: false,
      error: null,
    }));

    rerender(React.createElement(StudioConfigPane, {
      config,
      onChange,
      models: [],
      loading: true,
      error: null,
    }));
    rerender(React.createElement(StudioConfigPane, {
      config,
      onChange,
      models: [],
      loading: false,
      error: 'Network error',
    }));

    expect(onChange).not.toHaveBeenCalled();
  });

  test('does not render the Chat provider filter while loading, errored, or globally empty', () => {
    const { unmount } = renderConfigPane({ loading: true });
    expect(screen.queryByTestId('chat-provider-filter')).toBeNull();

    unmount();
    renderConfigPane({ error: 'Network error' });
    expect(screen.queryByTestId('chat-provider-filter')).toBeNull();

    unmount();
    renderConfigPane({ models: [] });
    expect(screen.queryByTestId('chat-provider-filter')).toBeNull();
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
      for (const selector of [
        screen.getByTestId('model-select-col-default-a'),
        screen.getByTestId('model-select-col-default-b'),
      ]) {
        expect(Array.from(selector.options, (option) => option.value)).toEqual([
          '',
          'alpha/first',
          'beta/second',
        ]);
      }
    });

    const firstColumn = screen.getByTestId('model-select-col-default-a');
    const secondColumn = screen.getByTestId('model-select-col-default-b');
    fireEvent.change(firstColumn, { target: { value: 'alpha/first' } });
    fireEvent.change(secondColumn, { target: { value: 'beta/second' } });

    expect(firstColumn.value).toBe('alpha/first');
    expect(secondColumn.value).toBe('beta/second');
  });

  test('preserves independent Compare full model selections and request bodies', async () => {
    global.fetch = vi.fn().mockImplementation(() => Promise.resolve(successfulCompareResponse()));
    const onResult = vi.fn();
    renderCompareWorkspace({ onResult });

    const firstModel = screen.getByTestId('model-select-col-default-a');
    const secondModel = screen.getByTestId('model-select-col-default-b');
    fireEvent.change(firstModel, { target: { value: 'wrongprefix/first' } });
    fireEvent.change(secondModel, { target: { value: 'beta/third' } });
    fireEvent.change(screen.getByTestId('compare-input'), { target: { value: 'Compare both' } });
    fireEvent.click(screen.getByTestId('compare-send'));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
    const requestBodies = global.fetch.mock.calls.map(([, request]) => JSON.parse(request.body));
    expect(requestBodies.map((body) => body.model)).toEqual([
      'wrongprefix/first',
      'beta/third',
    ]);
    for (const body of requestBodies) {
      expect(body).not.toHaveProperty('providerId');
      expect(body).not.toHaveProperty('providerFilter');
    }
    await waitFor(() => expect(onResult).toHaveBeenCalledTimes(2));
  });

  test('filters Compare columns independently by provider ID and keeps reversed provider ordering stable', () => {
    const mounted = renderCompareWorkspace();
    const firstFilter = screen.getByTestId('provider-filter-col-default-a');
    const secondFilter = screen.getByTestId('provider-filter-col-default-b');
    const firstModel = screen.getByTestId('model-select-col-default-a');
    const secondModel = screen.getByTestId('model-select-col-default-b');

    expect(firstFilter.tagName).toBe('SELECT');
    expect(secondFilter.tagName).toBe('SELECT');
    expect(firstModel.tagName).toBe('SELECT');
    expect(secondModel.tagName).toBe('SELECT');
    expect(firstFilter.getAttribute('aria-label')).toBe('Filter models by provider for column 1');
    expect(secondFilter.getAttribute('aria-label')).toBe('Filter models by provider for column 2');
    expect(firstModel.getAttribute('aria-label')).toBe('Select model for column 1');
    expect(secondModel.getAttribute('aria-label')).toBe('Select model for column 2');
    expect(new Set([firstFilter, secondFilter, firstModel, secondModel]).size).toBe(4);
    expect(screen.getByRole('combobox', { name: 'Filter models by provider for column 1' })).toBe(firstFilter);
    expect(screen.getByRole('combobox', { name: 'Filter models by provider for column 2' })).toBe(secondFilter);
    expect(screen.getByRole('combobox', { name: 'Select model for column 1' })).toBe(firstModel);
    expect(screen.getByRole('combobox', { name: 'Select model for column 2' })).toBe(secondModel);
    expect(Array.from(firstFilter.options, (option) => [option.value, option.textContent])).toEqual([
      ['', 'All providers'],
      ['alpha', 'Alpha'],
      ['beta', 'Shared'],
      ['gamma', 'Shared'],
      ['delta', 'delta'],
    ]);

    fireEvent.change(firstFilter, { target: { value: 'alpha' } });
    fireEvent.change(secondFilter, { target: { value: 'beta' } });
    expect(Array.from(firstModel.options, (option) => option.value)).toEqual(['', 'wrongprefix/first', 'alpha/second']);
    expect(Array.from(secondModel.options, (option) => option.value)).toEqual(['', 'beta/third']);

    fireEvent.change(firstModel, { target: { value: 'wrongprefix/first' } });
    fireEvent.change(secondModel, { target: { value: 'beta/third' } });
    fireEvent.change(firstFilter, { target: { value: 'beta' } });

    expect(firstModel.value).toBe('');
    expect(secondModel.value).toBe('beta/third');
    expect(secondFilter.value).toBe('beta');

    mounted.unmount();
    renderCompareWorkspace({ models: [...providerFilterModels].reverse() });
    expect(Array.from(screen.getByTestId('provider-filter-col-default-a').options, (option) => [option.value, option.textContent])).toEqual([
      ['', 'All providers'],
      ['alpha', 'Alpha'],
      ['beta', 'Shared'],
      ['gamma', 'Shared'],
      ['delta', 'delta'],
    ]);
  });

  test('keeps Chat and Compare filters ephemeral across tab switches and resets them on remount without losing the persisted Chat model', async () => {
    modelCatalog.fetchModelCatalog.mockResolvedValue({ models: providerFilterModels });
    const mounted = render(React.createElement(PlaygroundStudio));
    await waitFor(() => expect(screen.getByTestId('chat-provider-filter')).toBeDefined());

    fireEvent.change(screen.getByLabelText('Select Model'), { target: { value: 'wrongprefix/first' } });
    fireEvent.change(screen.getByTestId('chat-provider-filter'), { target: { value: 'alpha' } });
    await waitFor(() => {
      const persisted = JSON.parse(localStorage.getItem(PLAYGROUND_PERSISTENCE_KEYS.presetsConfig));
      expect(persisted.value.config.model.id).toBe('wrongprefix/first');
      expect(persisted.value.config).not.toHaveProperty('providerId');
      expect(persisted.value.config).not.toHaveProperty('providerFilter');
    });

    fireEvent.click(screen.getByTestId('playground-compare-tab'));
    fireEvent.change(screen.getByTestId('provider-filter-col-default-a'), { target: { value: 'alpha' } });
    fireEvent.click(screen.getByTestId('playground-chat-tab'));
    expect(screen.getByTestId('chat-provider-filter').value).toBe('alpha');
    expect(screen.getByLabelText('Select Model').value).toBe('wrongprefix/first');
    fireEvent.click(screen.getByTestId('playground-compare-tab'));
    expect(screen.getByTestId('provider-filter-col-default-a').value).toBe('alpha');

    expect(screen.getAllByRole('button', { name: 'Remove column' })).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Add model column' }));
    const filtersAfterAdd = screen.getAllByLabelText(/Filter models by provider for column/);
    expect(filtersAfterAdd).toHaveLength(3);
    expect(filtersAfterAdd[2].value).toBe('');
    expect(screen.getAllByRole('button', { name: 'Remove column' })).toHaveLength(3);
    fireEvent.change(filtersAfterAdd[2], { target: { value: 'beta' } });
    const thirdColumn = filtersAfterAdd[2].closest('[data-testid^="compare-col-"]');
    expect(thirdColumn.querySelector('[title="Remove column"]')).toBe(screen.getAllByRole('button', { name: 'Remove column' })[2]);
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove column' })[2]);
    expect(screen.getAllByLabelText(/Filter models by provider for column/)).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Remove column' })).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Add model column' }));
    expect(screen.getAllByLabelText(/Filter models by provider for column/)[2].value).toBe('');
    expect(screen.getAllByRole('button', { name: 'Remove column' })).toHaveLength(3);

    mounted.unmount();
    render(React.createElement(PlaygroundStudio));
    await waitFor(() => {
      expect(screen.getByTestId('chat-provider-filter').value).toBe('');
      expect(screen.getByLabelText('Select Model').value).toBe('wrongprefix/first');
      expect(screen.getByTestId('provider-filter-col-default-a').value).toBe('');
    });
    const persistedAfterRemount = JSON.parse(localStorage.getItem(PLAYGROUND_PERSISTENCE_KEYS.presetsConfig));
    expect(persistedAfterRemount.value.config.model.id).toBe('wrongprefix/first');
    expect(persistedAfterRemount.value.config).not.toHaveProperty('providerId');
    expect(persistedAfterRemount.value.config).not.toHaveProperty('providerFilter');
  });

  test('keeps an in-flight Compare request bound to its captured full model after filtering', async () => {
    let resolveFetch;
    const responsePromise = new Promise((resolve) => { resolveFetch = resolve; });
    global.fetch = vi.fn().mockReturnValue(responsePromise);
    const onResult = vi.fn();
    renderCompareWorkspace({ onResult });

    fireEvent.change(screen.getByTestId('model-select-col-default-a'), { target: { value: 'wrongprefix/first' } });
    fireEvent.change(screen.getByTestId('compare-input'), { target: { value: 'Keep captured model' } });
    fireEvent.click(screen.getByTestId('compare-send'));
    expect(JSON.parse(global.fetch.mock.calls[0][1].body).model).toBe('wrongprefix/first');

    fireEvent.change(screen.getByTestId('provider-filter-col-default-a'), { target: { value: 'beta' } });
    expect(screen.getByTestId('model-select-col-default-a').value).toBe('');
    resolveFetch(successfulCompareResponse('Original Alpha output'));

    await waitFor(() => {
      expect(screen.getByTestId('compare-col-col-default-a').textContent).toContain('Original Alpha output');
      expect(screen.getByTestId('state-col-default-a').textContent).toBe('COMPLETE');
    });
    expect(screen.getByTestId('compare-col-col-default-b').textContent).not.toContain('Original Alpha output');
    expect(onResult.mock.calls[0][0].request.model).toBe('wrongprefix/first');
  });

  test('desktop and mobile structural responsive classes', async () => {
    modelCatalog.fetchModelCatalog.mockResolvedValue({ models: [] });
    render(React.createElement(PlaygroundStudio));

    const rootContainer = screen.getByTestId('playground-studio');
    // lg:overflow-hidden must exclusively contain desktop boundaries. Native mobile scrollability shouldn't block content.
    expect(rootContainer.className).toContain('lg:overflow-hidden');
    expect(rootContainer.className).toContain('overflow-y-auto');

    const panesContainer = screen.getByTestId('playground-inspector').parentElement;
    expect(panesContainer.className).toContain('w-full');
    expect(panesContainer.className).toContain('flex-col');
    expect(panesContainer.className).toContain('lg:flex-row');
    expect(panesContainer.className).toContain('lg:h-full');
    expect(panesContainer.className).toContain('lg:overflow-hidden');
    
    const workspaceContainer = screen.getByRole('tablist').parentElement;
    // Primary mobile bounds shrink-wrap scroll behavior to internal panel views safely
    expect(workspaceContainer.className).toContain('min-h-[500px]');
    expect(workspaceContainer.className).toContain('lg:min-h-0');
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
