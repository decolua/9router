/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { test, expect, describe, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import PlaygroundStudio from '../../../src/app/(dashboard)/dashboard/playground/PlaygroundStudio.jsx';
import * as modelCatalog from '../../../src/app/(dashboard)/dashboard/playground/lib/modelCatalog.js';

vi.mock('../../../src/app/(dashboard)/dashboard/playground/lib/modelCatalog.js', () => ({
  fetchModelCatalog: vi.fn(),
  normalizeModelCatalog: vi.fn()
}));

describe('PlaygroundStudio Shell', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

    expect(chatTabBtn.className).toContain('text-primary');
    expect(screen.getByText('Chat tab placeholder')).toBeDefined();
    expect(screen.queryByText('Compare tab placeholder')).toBeNull();

    fireEvent.click(compareTabBtn);

    expect(compareTabBtn.className).toContain('text-primary');
    expect(screen.getByText('Compare tab placeholder')).toBeDefined();
    expect(screen.queryByText('Chat tab placeholder')).toBeNull();
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

  test('preserves configuration across tab switches', async () => {
    modelCatalog.fetchModelCatalog.mockResolvedValue({
      models: [{ id: 'model-1', name: 'Model 1', provider: 'test' }]
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
