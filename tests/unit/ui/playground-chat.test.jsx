// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ChatWorkspace from '@/app/(dashboard)/dashboard/playground/components/tabs/ChatWorkspace.jsx';

// Mock dependencies
vi.mock('@/app/(dashboard)/dashboard/playground/lib/requestBuilder', () => ({
  buildPlaygroundRequest: vi.fn((input) => ({ mockRequest: true, ...input }))
}));

vi.mock('@/app/(dashboard)/dashboard/playground/lib/sseParser', () => {
  return {
    createSseParser: vi.fn(() => ({
      push: vi.fn(),
      close: vi.fn()
    }))
  };
});

vi.mock('@/app/(dashboard)/dashboard/playground/lib/metrics', () => ({
  createMetricAccumulator: vi.fn((startedAt) => ({
    record: vi.fn(),
    abort: vi.fn(),
    snapshot: vi.fn().mockReturnValue({ terminalState: 'complete' })
  }))
}));

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

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

  it('renders correctly initially', () => {
    render(<ChatWorkspace configState={mockConfig} onMetricsUpdate={mockOnMetricsUpdate} />);
    expect(screen.getByTestId('playground-chat-workspace')).toBeTruthy();
    expect(screen.getByTestId('playground-send')).toBeTruthy();
  });

  it('handles sending a message and streaming response', async () => {
    const { createSseParser } = await import('@/app/(dashboard)/dashboard/playground/lib/sseParser');
    
    // Setup mock parser behavior
    const mockParser = {
      push: vi.fn()
        .mockReturnValueOnce([{ type: 'delta', text: 'Hello' }])
        .mockReturnValueOnce([{ type: 'delta', text: ', world!' }]),
      close: vi.fn().mockReturnValue({ type: 'usage', usage: { inputTokens: 10, outputTokens: 20 } })
    };
    createSseParser.mockReturnValue(mockParser);
    
    // Setup mock fetch stream
    const chunks = [new Uint8Array([1]), new Uint8Array([2])];
    let chunkIndex = 0;
    mockFetch.mockResolvedValueOnce({
      ok: true,
      body: {
        getReader: () => ({
          read: vi.fn().mockImplementation(async () => {
            if (chunkIndex < chunks.length) {
              return { done: false, value: chunks[chunkIndex++] };
            }
            return { done: true, value: undefined };
          })
        })
      }
    });

    render(<ChatWorkspace configState={mockConfig} onMetricsUpdate={mockOnMetricsUpdate} />);
    
    // Type and send
    const input = screen.getByPlaceholderText('Send a message...');
    fireEvent.change(input, { target: { value: 'Hi there' } });
    fireEvent.click(screen.getByTestId('playground-send'));
    
    // Verify user message appears immediately
    expect(screen.getByText('Hi there')).toBeTruthy();
    expect(screen.getByTestId('playground-stop')).toBeTruthy(); // Stop button should appear
    
    // Wait for stream to complete
    await waitFor(() => {
        expect(screen.getByTestId('playground-send')).toBeTruthy();
    });
    
    // Verify assistant message was assembled
    expect(screen.getByText('Hello, world!')).toBeTruthy();
    
    // Verify metrics were called
    expect(mockOnMetricsUpdate).toHaveBeenCalled();
  });
  
  it('handles http error', async () => {
     mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400
    });
    
    render(<ChatWorkspace configState={mockConfig} />);
    
    const input = screen.getByPlaceholderText('Send a message...');
    fireEvent.change(input, { target: { value: 'Break it' } });
    fireEvent.click(screen.getByTestId('playground-send'));
    
    await waitFor(() => {
        expect(screen.getByTestId('chat-error')).toBeTruthy();
    });
    expect(screen.getByText('HTTP error 400')).toBeTruthy();
  });
  
  it('handles regenerate', async () => {
     const { createSseParser } = await import('@/app/(dashboard)/dashboard/playground/lib/sseParser');
     const mockParser = {
      push: vi.fn().mockReturnValue([{ type: 'delta', text: 'First response' }]),
      close: vi.fn()
     };
     createSseParser.mockReturnValue(mockParser);
     
     let chunkIndex = 0;
     mockFetch.mockResolvedValue({
      ok: true,
      body: {
        getReader: () => ({
          read: vi.fn().mockImplementation(async () => {
            if (chunkIndex === 0) { chunkIndex++; return { done: false, value: new Uint8Array([1]) }; }
            return { done: true, value: undefined };
          })
        })
      }
    });
    
    render(<ChatWorkspace configState={mockConfig} />);
    
    // 1st msg
    fireEvent.change(screen.getByPlaceholderText('Send a message...'), { target: { value: 'Hi' } });
    fireEvent.click(screen.getByTestId('playground-send'));
    
    await waitFor(() => { expect(screen.getByText('First response')).toBeTruthy(); });
    
    // Reset mock for 2nd request
    chunkIndex = 0;
    mockParser.push.mockReturnValue([{ type: 'delta', text: 'Second response' }]);
    
    // Click regenerate
    fireEvent.click(screen.getByText('Regenerate'));
    
    await waitFor(() => { 
        expect(screen.getByText('Second response')).toBeTruthy(); 
        expect(screen.queryByText('First response')).toBeNull();
    });
  });
});