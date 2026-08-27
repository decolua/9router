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
