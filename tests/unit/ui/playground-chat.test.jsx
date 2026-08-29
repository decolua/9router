// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ChatWorkspace from '@/app/(dashboard)/dashboard/playground/components/tabs/ChatWorkspace.jsx';
import ChatAttachments from '@/app/(dashboard)/dashboard/playground/components/tabs/ChatAttachments.jsx';

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
      }),
      cancel: vi.fn().mockResolvedValue(undefined)
    })
  };
}

// FileReader stub whose completion is triggered manually, so tests can resolve
// reads after capability loss, Clear, Send, unmount, or a newer selection.
class DelayedFileReader {
  static instances = [];
  constructor() {
    this.onload = null;
    this.onerror = null;
    DelayedFileReader.instances.push(this);
  }
  readAsDataURL(file) {
    this._file = file;
  }
  complete(result) {
    this.onload?.({ target: { result } });
  }
  fail(error) {
    this.onerror?.(error);
  }
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
    DelayedFileReader.instances = [];
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders correctly initially', () => {
    render(<ChatWorkspace configState={mockConfig} onMetricsUpdate={mockOnMetricsUpdate} />);
    expect(screen.getByTestId('playground-chat-workspace')).toBeTruthy();
    expect(screen.getByTestId('playground-send')).toBeTruthy();
  });

  it('clears the parent draft after accepting a user message', async () => {
    const onDraftChange = vi.fn();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      body: createFakeStream(['data: [DONE]\n\n'])
    });

    render(
      <ChatWorkspace
        configState={mockConfig}
        onDraftChange={onDraftChange}
      />
    );

    fireEvent.change(screen.getByPlaceholderText('Send a message...'), { target: { value: 'Persisted prompt' } });
    fireEvent.click(screen.getByTestId('playground-send'));

    expect(screen.getByText('Persisted prompt')).toBeTruthy();
    expect(onDraftChange).toHaveBeenLastCalledWith('');
  });

  it('keeps the parent draft for blank and model-less send attempts', () => {
    const blankDraftChange = vi.fn();
    const { unmount } = render(
      <ChatWorkspace
        configState={mockConfig}
        draft=" "
        onDraftChange={blankDraftChange}
      />
    );

    fireEvent.keyDown(screen.getByPlaceholderText('Send a message...'), { key: 'Enter' });
    expect(blankDraftChange).not.toHaveBeenCalled();
    unmount();

    const invalidDraftChange = vi.fn();
    render(
      <ChatWorkspace
        configState={{ ...mockConfig, model: null }}
        draft="Saved draft"
        onDraftChange={invalidDraftChange}
      />
    );

    fireEvent.click(screen.getByTestId('playground-send'));
    expect(invalidDraftChange).not.toHaveBeenCalled();
    expect(screen.getByPlaceholderText('Send a message...').value).toBe('Saved draft');
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

  it('cancels the reader immediately after [DONE] without waiting for transport EOF', async () => {
    const encoder = new TextEncoder();
    const pendingRead = new Promise(() => {});
    const reader = {
      read: vi.fn()
        .mockResolvedValueOnce({ done: false, value: encoder.encode('data: [DONE]\n\n') })
        .mockImplementation(() => pendingRead),
      cancel: vi.fn().mockResolvedValue(undefined)
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      body: { getReader: () => reader }
    });

    render(<ChatWorkspace configState={mockConfig} onMetricsUpdate={mockOnMetricsUpdate} />);

    fireEvent.change(screen.getByPlaceholderText('Send a message...'), { target: { value: 'Hi' } });
    fireEvent.click(screen.getByTestId('playground-send'));

    await waitFor(() => {
      expect(reader.cancel).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId('playground-send')).toBeTruthy();
    });

    expect(reader.read).toHaveBeenCalledTimes(1);
    expect(mockOnMetricsUpdate).toHaveBeenCalledWith(expect.objectContaining({ terminalState: 'complete' }));
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
        expect(screen.getByText('API Rate Limit Exceeded')).toBeTruthy();
    });
    
    await waitFor(() => {
        expect(mockOnMetricsUpdate).toHaveBeenCalled();
    });
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
        expect(screen.getByText('HTTP error 400')).toBeTruthy();
    });
    
    await waitFor(() => {
        expect(mockOnMetricsUpdate).toHaveBeenCalled();
    });
    const metricsSnapshot = mockOnMetricsUpdate.mock.calls[mockOnMetricsUpdate.mock.calls.length - 1][0];
    expect(metricsSnapshot.terminalState).toBe('error');
  });

  it('handles user abort -> aborted (partial preserved)', async () => {
    let resolveRead;
    const pendingRead = new Promise((resolve, reject) => { resolveRead = reject; });
    const mockCancel = vi.fn().mockResolvedValue(undefined);
    
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
          }),
          cancel: mockCancel
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
    resolveRead(abortErr);
    
    await waitFor(() => {
        expect(screen.getByTestId('playground-send')).toBeTruthy();
        expect(screen.getByText('Slow')).toBeTruthy();
        expect(screen.getByTestId('partial-indicator')).toBeTruthy();
    });
    
    await waitFor(() => {
        expect(mockOnMetricsUpdate).toHaveBeenCalled();
    });
    
    const metricsSnapshot = mockOnMetricsUpdate.mock.calls[mockOnMetricsUpdate.mock.calls.length - 1][0];
    expect(metricsSnapshot.terminalState).toBe('aborted');
  });
  
  it('ignores a late fetch resolution after stop without a replacement request', async () => {
    let resolveFetch;
    const pendingFetch = new Promise((resolve) => { resolveFetch = resolve; });
    mockFetch.mockReturnValueOnce(pendingFetch);

    render(<ChatWorkspace configState={mockConfig} onMetricsUpdate={mockOnMetricsUpdate} />);

    fireEvent.change(screen.getByPlaceholderText('Send a message...'), { target: { value: 'Stop this' } });
    fireEvent.click(screen.getByTestId('playground-send'));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId('playground-stop')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('playground-stop'));

    await waitFor(() => {
      expect(screen.getByTestId('playground-send')).toBeTruthy();
      expect(mockOnMetricsUpdate).toHaveBeenCalledTimes(1);
    });

    resolveFetch({
      ok: true,
      body: createFakeStream(['data: {"choices":[{"delta":{"content":"LATE_CONTENT"}}]}\n\n', 'data: [DONE]\n\n'])
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(screen.queryByText('LATE_CONTENT')).toBeNull();
    expect(screen.queryByTestId('partial-indicator')).toBeNull();
    expect(screen.queryByTestId('chat-error')).toBeNull();
    expect(mockOnMetricsUpdate).toHaveBeenCalledTimes(1);
    expect(mockOnMetricsUpdate).toHaveBeenCalledWith(expect.objectContaining({ terminalState: 'aborted' }));
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
    
    const request = JSON.parse(mockFetch.mock.calls.at(-1)[1].body);
    expect(request.messages.at(-1)).toEqual({ role: 'user', content: 'Hi' });
  });

  it('ignores late chunks from a stopped reader while a newer request is active', async () => {
    const encoder = new TextEncoder();
    let resolveReaderA;
    let resolveReaderB;
    const readerA = {
      read: vi.fn().mockImplementation(() => new Promise((resolve) => { resolveReaderA = resolve; })),
      cancel: vi.fn().mockResolvedValue(undefined)
    };
    const readerB = {
      read: vi.fn().mockImplementation(() => new Promise((resolve) => { resolveReaderB = resolve; })),
      cancel: vi.fn().mockResolvedValue(undefined)
    };

    mockFetch
      .mockResolvedValueOnce({ ok: true, body: { getReader: () => readerA } })
      .mockResolvedValueOnce({ ok: true, body: { getReader: () => readerB } });

    render(<ChatWorkspace configState={mockConfig} onMetricsUpdate={mockOnMetricsUpdate} />);

    const input = screen.getByPlaceholderText('Send a message...');
    fireEvent.change(input, { target: { value: 'First request' } });
    fireEvent.click(screen.getByTestId('playground-send'));

    await waitFor(() => {
      expect(readerA.read).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByTestId('playground-stop'));
    fireEvent.change(input, { target: { value: 'Second request' } });
    fireEvent.click(screen.getByTestId('playground-send'));

    await waitFor(() => {
      expect(readerB.read).toHaveBeenCalledTimes(1);
    });

    resolveReaderA({
      done: false,
      value: encoder.encode('data: {"choices":[{"delta":{"content":"STALE_A_CONTENT"}}]}\n\n')
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(screen.queryByText('STALE_A_CONTENT')).toBeNull();

    resolveReaderB({
      done: false,
      value: encoder.encode('data: {"choices":[{"delta":{"content":"FRESH_B_CONTENT"}}]}\n\ndata: [DONE]\n\n')
    });

    await waitFor(() => {
      expect(screen.getByText('FRESH_B_CONTENT')).toBeTruthy();
      expect(screen.queryByText('STALE_A_CONTENT')).toBeNull();
      expect(screen.getByTestId('playground-send')).toBeTruthy();
    });
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

  it('sends an image-only request through the real request builder without rendering its data URL', async () => {
    const originalFileReader = global.FileReader;
    global.FileReader = class {
      readAsDataURL() { this.onload({ target: { result: 'data:image/png;base64,attachment-data' } }); }
    };
    const onResult = vi.fn();
    const imageConfig = { ...mockConfig, model: { id: 'vision-model', capabilities: { images: true } } };
    mockFetch.mockResolvedValueOnce({ ok: true, body: createFakeStream(['data: [DONE]\n\n']) });

    try {
      const { container } = render(<ChatWorkspace configState={imageConfig} onResult={onResult} />);
      const file = new File(['image'], 'attachment.png', { type: 'image/png' });
      const imageInput = screen.getByTestId('playground-image-input');
      expect(imageInput.accept).toBe('image/*');
      expect(imageInput.multiple).toBe(true);
      fireEvent.change(imageInput, { target: { files: [file] } });

      await waitFor(() => expect(screen.getByText(/attachment\.png/)).toBeTruthy());
      expect(container.innerHTML).not.toContain('attachment-data');
      fireEvent.click(screen.getByTestId('playground-send'));

      await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
      const request = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(request.messages.at(-1)).toEqual({
        role: 'user',
        content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,attachment-data' } }]
      });
      await waitFor(() => expect(onResult).toHaveBeenCalled());
      expect(screen.queryByText(/attachment\.png/)).toBeNull();
      expect(JSON.stringify(onResult.mock.calls)).not.toContain('attachment-data');
    } finally {
      global.FileReader = originalFileReader;
    }
  });

  it('removes a single attachment', async () => {
    const originalFileReader = global.FileReader;
    global.FileReader = DelayedFileReader;
    const imageConfig = { ...mockConfig, model: { id: 'vision-model', capabilities: { images: true } } };

    try {
      render(<ChatWorkspace configState={imageConfig} />);
      fireEvent.change(screen.getByTestId('playground-image-input'), { target: { files: [new File(['one'], 'one.png', { type: 'image/png' })] } });
      DelayedFileReader.instances[0].complete('data:image/png;base64,one');
      await waitFor(() => expect(screen.getByText(/one\.png/)).toBeTruthy());
      fireEvent.click(screen.getByRole('button', { name: 'Remove one.png (1)' }));
      expect(screen.queryByText(/one\.png/)).toBeNull();
    } finally {
      global.FileReader = originalFileReader;
    }
  });

  it('clears a pending attachment without sending', async () => {
    const originalFileReader = global.FileReader;
    global.FileReader = DelayedFileReader;
    const imageConfig = { ...mockConfig, model: { id: 'vision-model', capabilities: { images: true } } };

    try {
      render(<ChatWorkspace configState={imageConfig} />);
      fireEvent.change(screen.getByTestId('playground-image-input'), { target: { files: [new File(['one'], 'one.png', { type: 'image/png' })] } });
      DelayedFileReader.instances[0].complete('data:image/png;base64,one');
      await waitFor(() => expect(screen.getByText(/one\.png/)).toBeTruthy());

      fireEvent.click(screen.getByTestId('playground-clear'));

      expect(screen.queryByText(/one\.png/)).toBeNull();
      expect(mockFetch).not.toHaveBeenCalled();
    } finally {
      global.FileReader = originalFileReader;
    }
  });

  it('clears existing attachments when image capability is lost', async () => {
    const originalFileReader = global.FileReader;
    global.FileReader = DelayedFileReader;
    const imageConfig = { ...mockConfig, model: { id: 'vision-model', capabilities: { images: true } } };

    try {
      const { rerender } = render(<ChatWorkspace configState={imageConfig} />);
      fireEvent.change(screen.getByTestId('playground-image-input'), { target: { files: [new File(['one'], 'one.png', { type: 'image/png' })] } });
      DelayedFileReader.instances[0].complete('data:image/png;base64,one');
      await waitFor(() => expect(screen.getByText(/one\.png/)).toBeTruthy());

      rerender(<ChatWorkspace configState={mockConfig} />);

      expect(screen.queryByTestId('playground-image-input')).toBeNull();
      expect(screen.queryByText(/one\.png/)).toBeNull();
    } finally {
      global.FileReader = originalFileReader;
    }
  });

  it('does not restore a delayed FileReader completion after image capability is lost', async () => {
    const originalFileReader = global.FileReader;
    global.FileReader = DelayedFileReader;
    const imageConfig = { ...mockConfig, model: { id: 'vision-model', capabilities: { images: true } } };

    try {
      const { rerender } = render(<ChatWorkspace configState={imageConfig} />);
      fireEvent.change(screen.getByTestId('playground-image-input'), { target: { files: [new File(['one'], 'one.png', { type: 'image/png' })] } });
      expect(DelayedFileReader.instances).toHaveLength(1);

      rerender(<ChatWorkspace configState={mockConfig} />);

      DelayedFileReader.instances[0].complete('data:image/png;base64,one');
      await Promise.resolve();
      await Promise.resolve();
      expect(screen.queryByText(/one\.png/)).toBeNull();

      rerender(<ChatWorkspace configState={imageConfig} />);
      expect(screen.queryByText(/one\.png/)).toBeNull();
    } finally {
      global.FileReader = originalFileReader;
    }
  });

  it('drops a file read that resolves after Clear', async () => {
    const originalFileReader = global.FileReader;
    global.FileReader = DelayedFileReader;
    const imageConfig = { ...mockConfig, model: { id: 'vision-model', capabilities: { images: true } } };

    try {
      render(<ChatWorkspace configState={imageConfig} />);
      fireEvent.change(screen.getByTestId('playground-image-input'), { target: { files: [new File(['one'], 'one.png', { type: 'image/png' })] } });
      DelayedFileReader.instances[0].complete('data:image/png;base64,one');
      await waitFor(() => expect(screen.getByText(/one\.png/)).toBeTruthy());

      fireEvent.change(screen.getByTestId('playground-image-input'), { target: { files: [new File(['two'], 'two.png', { type: 'image/png' })] } });
      expect(DelayedFileReader.instances).toHaveLength(2);

      fireEvent.click(screen.getByTestId('playground-clear'));
      DelayedFileReader.instances[1].complete('data:image/png;base64,two');
      await Promise.resolve();
      await Promise.resolve();

      expect(screen.queryByText(/two\.png/)).toBeNull();
      expect(screen.queryByText(/one\.png/)).toBeNull();
      expect(mockFetch).not.toHaveBeenCalled();
    } finally {
      global.FileReader = originalFileReader;
    }
  });

  it('drops a file read that resolves after an accepted send', async () => {
    const originalFileReader = global.FileReader;
    global.FileReader = DelayedFileReader;
    const imageConfig = { ...mockConfig, model: { id: 'vision-model', capabilities: { images: true } } };
    mockFetch.mockResolvedValueOnce({ ok: true, body: createFakeStream(['data: [DONE]\n\n']) });

    try {
      render(<ChatWorkspace configState={imageConfig} onMetricsUpdate={mockOnMetricsUpdate} />);
      fireEvent.change(screen.getByTestId('playground-image-input'), { target: { files: [new File(['one'], 'one.png', { type: 'image/png' })] } });
      DelayedFileReader.instances[0].complete('data:image/png;base64,one');
      await waitFor(() => expect(screen.getByText(/one\.png/)).toBeTruthy());

      fireEvent.change(screen.getByTestId('playground-image-input'), { target: { files: [new File(['two'], 'two.png', { type: 'image/png' })] } });
      fireEvent.change(screen.getByPlaceholderText('Send a message...'), { target: { value: 'send now' } });
      fireEvent.click(screen.getByTestId('playground-send'));

      await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));

      DelayedFileReader.instances[1].complete('data:image/png;base64,two');
      await Promise.resolve();
      await Promise.resolve();

      expect(screen.queryByText(/two\.png/)).toBeNull();
      await waitFor(() => expect(mockOnMetricsUpdate).toHaveBeenCalled());
    } finally {
      global.FileReader = originalFileReader;
    }
  });

  it('drops an earlier pending read when a newer file selection replaces it', async () => {
    const originalFileReader = global.FileReader;
    global.FileReader = DelayedFileReader;
    const imageConfig = { ...mockConfig, model: { id: 'vision-model', capabilities: { images: true } } };

    try {
      render(<ChatWorkspace configState={imageConfig} />);
      fireEvent.change(screen.getByTestId('playground-image-input'), { target: { files: [new File(['one'], 'one.png', { type: 'image/png' })] } });
      fireEvent.change(screen.getByTestId('playground-image-input'), { target: { files: [new File(['two'], 'two.png', { type: 'image/png' })] } });
      expect(DelayedFileReader.instances).toHaveLength(2);

      DelayedFileReader.instances[0].complete('data:image/png;base64,one');
      await Promise.resolve();
      await Promise.resolve();
      expect(screen.queryByText(/one\.png/)).toBeNull();

      DelayedFileReader.instances[1].complete('data:image/png;base64,two');
      await waitFor(() => expect(screen.getByText(/two\.png/)).toBeTruthy());
    } finally {
      global.FileReader = originalFileReader;
    }
  });

  it('ignores a FileReader completion after unmount', async () => {
    const originalFileReader = global.FileReader;
    global.FileReader = DelayedFileReader;
    const onChange = vi.fn();

    try {
      const { unmount } = render(<ChatAttachments attachments={[]} canAttach disabled={false} onChange={onChange} onError={vi.fn()} resetKey={0} />);
      fireEvent.change(screen.getByTestId('playground-image-input'), { target: { files: [new File(['x'], 'x.png', { type: 'image/png' })] } });
      unmount();
      DelayedFileReader.instances[0].complete('data:image/png;base64,x');
      await Promise.resolve();
      await Promise.resolve();
      expect(onChange).not.toHaveBeenCalled();
    } finally {
      global.FileReader = originalFileReader;
    }
  });
});
