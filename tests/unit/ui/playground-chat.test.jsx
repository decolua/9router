// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ChatWorkspace from '@/app/(dashboard)/dashboard/playground/components/tabs/ChatWorkspace.jsx';

vi.mock('@/app/(dashboard)/dashboard/playground/lib/requestBuilder', () => ({
  buildPlaygroundRequest: vi.fn((input) => ({ mockRequest: true, ...input }))
}));

const mockFetch = vi.fn();
global.fetch = mockFetch;

function createFakeStream(chunks) {
  const encoder = new TextEncoder();
  let chunkIndex = 0;
  return {
    getReader: () => ({
      read: vi.fn().mockImplementation(async () => {
        if (chunkIndex < chunks.length) {
          const value = encoder.encode(chunks[chunkIndex++]);
          return { done: false, value };
        }
        return { done: true, value: undefined };
      })
    })
  };
}

describe('ChatWorkspace', () => {
  const mockConfig = {
    model: { id: 'test-model' },
    systemPrompt: 'test system prompt',
    params: { temperature: 0.5 }
  };
  
  const mockOnMetricsUpdate = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders correctly initially', () => {
    render(<ChatWorkspace configState={mockConfig} onMetricsUpdate={mockOnMetricsUpdate} />);
    expect(screen.getByTestId('playground-chat-workspace')).toBeTruthy();
    expect(screen.getByTestId('playground-send')).toBeTruthy();
  });

  it('handles sending a message and streaming response with real parser (explicit done -> complete)', async () => {
    const sseChunks = [
      'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":", world!"}}]}\n\n',
      'data: [DONE]\n\n'
    ];
    
    mockFetch.mockResolvedValueOnce({
      ok: true,
      body: createFakeStream(sseChunks)
    });

    render(<ChatWorkspace configState={mockConfig} onMetricsUpdate={mockOnMetricsUpdate} />);
    
    const input = screen.getByPlaceholderText('Send a message...');
    fireEvent.change(input, { target: { value: 'Hi there' } });
    fireEvent.click(screen.getByTestId('playground-send'));
    
    expect(screen.getByText('Hi there')).toBeTruthy();
    expect(screen.getByTestId('playground-stop')).toBeTruthy();
    
    await waitFor(() => {
        expect(screen.getByTestId('playground-send')).toBeTruthy();
    });
    
    expect(screen.getByText('Hello, world!')).toBeTruthy();
    expect(screen.queryByTestId('partial-indicator')).toBeNull();
    
    expect(mockOnMetricsUpdate).toHaveBeenCalled();
    const metricsSnapshot = mockOnMetricsUpdate.mock.calls[mockOnMetricsUpdate.mock.calls.length - 1][0];
    expect(metricsSnapshot.terminalState).toBe('complete');
  });

  it('handles EOF without done -> incomplete (partial preserved)', async () => {
    const sseChunks = [
      'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"..."}}]}\n\n'
    ];
    
    mockFetch.mockResolvedValueOnce({
      ok: true,
      body: createFakeStream(sseChunks)
    });

    render(<ChatWorkspace configState={mockConfig} onMetricsUpdate={mockOnMetricsUpdate} />);
    
    const input = screen.getByPlaceholderText('Send a message...');
    fireEvent.change(input, { target: { value: 'Hi there' } });
    fireEvent.click(screen.getByTestId('playground-send'));
    
    await waitFor(() => {
        expect(screen.getByTestId('chat-error')).toBeTruthy();
    });
    
    expect(screen.getByText('Stream ended unexpectedly.')).toBeTruthy();
    expect(screen.getByText('Hello...')).toBeTruthy();
    expect(screen.getByTestId('partial-indicator')).toBeTruthy();
    
    const metricsSnapshot = mockOnMetricsUpdate.mock.calls[mockOnMetricsUpdate.mock.calls.length - 1][0];
    expect(metricsSnapshot.terminalState).toBe('incomplete');
  });

  it('handles malformed frame -> error', async () => {
    const sseChunks = [
      'data: {"choices":[{"delta":{"content":"Good"}}]}\n\n',
      'data: {BAD_JSON\n\n',
      'data: [DONE]\n\n'
    ];
    
    mockFetch.mockResolvedValueOnce({
      ok: true,
      body: createFakeStream(sseChunks)
    });

    render(<ChatWorkspace configState={mockConfig} onMetricsUpdate={mockOnMetricsUpdate} />);
    
    const input = screen.getByPlaceholderText('Send a message...');
    fireEvent.change(input, { target: { value: 'Hi' } });
    fireEvent.click(screen.getByTestId('playground-send'));
    
    await waitFor(() => {
        expect(screen.getByTestId('chat-error')).toBeTruthy();
    });
    
    expect(screen.getByText('Malformed stream frame received')).toBeTruthy();
    expect(screen.getByTestId('partial-indicator')).toBeTruthy();
    
    const metricsSnapshot = mockOnMetricsUpdate.mock.calls[mockOnMetricsUpdate.mock.calls.length - 1][0];
    expect(metricsSnapshot.terminalState).toBe('error');
  });

  it('handles parser explicit error event -> error', async () => {
    const sseChunks = [
      'data: {"error":{"message":"API Rate Limit Exceeded"}}\n\n'
    ];
    
    mockFetch.mockResolvedValueOnce({
      ok: true,
      body: createFakeStream(sseChunks)
    });

    render(<ChatWorkspace configState={mockConfig} onMetricsUpdate={mockOnMetricsUpdate} />);
    
    const input = screen.getByPlaceholderText('Send a message...');
    fireEvent.change(input, { target: { value: 'Hi' } });
    fireEvent.click(screen.getByTestId('playground-send'));
    
    await waitFor(() => {
        expect(screen.getByTestId('chat-error')).toBeTruthy();
    });
    
    expect(screen.getByText('API Rate Limit Exceeded')).toBeTruthy();
    const metricsSnapshot = mockOnMetricsUpdate.mock.calls[mockOnMetricsUpdate.mock.calls.length - 1][0];
    expect(metricsSnapshot.terminalState).toBe('error');
  });

  it('handles http error', async () => {
     mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400
    });
    
    render(<ChatWorkspace configState={mockConfig} onMetricsUpdate={mockOnMetricsUpdate} />);
    
    const input = screen.getByPlaceholderText('Send a message...');
    fireEvent.change(input, { target: { value: 'Break it' } });
    fireEvent.click(screen.getByTestId('playground-send'));
    
    await waitFor(() => {
        expect(screen.getByTestId('chat-error')).toBeTruthy();
    });
    expect(screen.getByText('HTTP error 400')).toBeTruthy();
    
    const metricsSnapshot = mockOnMetricsUpdate.mock.calls[mockOnMetricsUpdate.mock.calls.length - 1][0];
    expect(metricsSnapshot.terminalState).toBe('error');
  });

  it('handles user abort -> aborted (partial preserved)', async () => {
    let resolveRead;
    const pendingRead = new Promise(resolve => { resolveRead = resolve; });
    
    let chunkCount = 0;
    const encoder = new TextEncoder();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      body: {
        getReader: () => ({
          read: vi.fn().mockImplementation(async () => {
            if (chunkCount === 0) {
              chunkCount++;
              return { done: false, value: encoder.encode('data: {"choices":[{"delta":{"content":"Slow "}}]}\n\n') };
            }
            return pendingRead;
          })
        })
      }
    });

    render(<ChatWorkspace configState={mockConfig} onMetricsUpdate={mockOnMetricsUpdate} />);
    
    const input = screen.getByPlaceholderText('Send a message...');
    fireEvent.change(input, { target: { value: 'Hi' } });
    fireEvent.click(screen.getByTestId('playground-send'));
    
    await waitFor(() => {
        expect(screen.getByText('Slow')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('playground-stop'));
    
    const abortErr = new Error("aborted");
    abortErr.name = "AbortError";
    resolveRead(Promise.reject(abortErr));
    
    await waitFor(() => {
        expect(screen.getByTestId('playground-send')).toBeTruthy();
    });

    expect(screen.getByText('Slow')).toBeTruthy();
    expect(screen.getByTestId('partial-indicator')).toBeTruthy();
    
    expect(mockOnMetricsUpdate).toHaveBeenCalled();
    const metricsSnapshot = mockOnMetricsUpdate.mock.calls[mockOnMetricsUpdate.mock.calls.length - 1][0];
    expect(metricsSnapshot.terminalState).toBe('aborted');
  });
  
  it('handles regenerate (exact second request body retaining prior context)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      body: createFakeStream(['data: {"choices":[{"delta":{"content":"First"}}]}\n\n', 'data: [DONE]\n\n'])
    });
    
    render(<ChatWorkspace configState={mockConfig} />);
    
    fireEvent.change(screen.getByPlaceholderText('Send a message...'), { target: { value: 'Hi' } });
    fireEvent.click(screen.getByTestId('playground-send'));
    
    await waitFor(() => { expect(screen.getByText('First')).toBeTruthy(); });
    
    mockFetch.mockResolvedValueOnce({
      ok: true,
      body: createFakeStream(['data: {"choices":[{"delta":{"content":"Second"}}]}\n\n', 'data: [DONE]\n\n'])
    });
    
    fireEvent.click(screen.getByText('Regenerate'));
    
    await waitFor(() => { 
        expect(screen.getByText('Second')).toBeTruthy(); 
        expect(screen.queryByText('First')).toBeNull();
    });
    
    const { buildPlaygroundRequest } = await import('@/app/(dashboard)/dashboard/playground/lib/requestBuilder');
    const lastCallArgs = buildPlaygroundRequest.mock.calls[buildPlaygroundRequest.mock.calls.length - 1][0];
    expect(lastCallArgs.messages).toEqual([{ role: 'user', content: 'Hi', partial: false }]);
  });

  it('handles unmount aborts in-flight request', async () => {
    let resolveRead;
    const pendingRead = new Promise(resolve => { resolveRead = resolve; });
    
    mockFetch.mockResolvedValueOnce({
      ok: true,
      body: {
        getReader: () => ({
          read: vi.fn().mockImplementation(() => pendingRead)
        })
      }
    });

    const { unmount } = render(<ChatWorkspace configState={mockConfig} />);
    
    fireEvent.change(screen.getByPlaceholderText('Send a message...'), { target: { value: 'Hi' } });
    fireEvent.click(screen.getByTestId('playground-send'));
    
    unmount();
    
    const callArgs = mockFetch.mock.calls[0];
    const signal = callArgs[1].signal;
    expect(signal.aborted).toBe(true);
  });
});