/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import CompareWorkspace from "../../../src/app/(dashboard)/dashboard/playground/components/tabs/CompareWorkspace";
import { createSseParser } from "../../../src/app/(dashboard)/dashboard/playground/lib/sseParser";
import { buildPlaygroundRequest } from "../../../src/app/(dashboard)/dashboard/playground/lib/requestBuilder";

vi.mock("../../../src/app/(dashboard)/dashboard/playground/lib/requestBuilder", () => ({
  buildPlaygroundRequest: vi.fn(),
}));

vi.mock("../../../src/app/(dashboard)/dashboard/playground/lib/sseParser", () => ({
  createSseParser: vi.fn(),
}));

describe("CompareWorkspace", () => {
  const mockConfigState = {
    systemPrompt: "You are helpful.",
    params: { temperature: 0.8 },
  };

  const availableModels = [
    { id: "openai/gpt-4o", label: "GPT-4o" },
    { id: "anthropic/claude-3", label: "Claude 3" },
    { id: "google/gemini", label: "Gemini" }
  ];

  describe("Draft persistence and accessibility", () => {
    it("calls onDraftChange when compare input changes", () => {
      const onDraftChange = vi.fn();
      render(
        <CompareWorkspace
          configState={{ systemPrompt: "", params: {} }}
          availableModels={[]}
          onResult={() => {}}
          draft="Initial draft"
          onDraftChange={onDraftChange}
        />
      );

      const textarea = screen.getByTestId("compare-input");
      expect(textarea.value).toBe("Initial draft");

      fireEvent.change(textarea, { target: { value: "New draft content" } });
      expect(onDraftChange).toHaveBeenCalledWith("New draft content");
    });

    it("has accessible names for model selects and composer", () => {
      render(
        <CompareWorkspace
          configState={{ systemPrompt: "", params: {} }}
          availableModels={[{ id: "model-a", label: "Model A" }]}
          onResult={() => {}}
          draft=""
          onDraftChange={() => {}}
        />
      );

      const selects = screen.getAllByRole("combobox");
      expect(selects.length).toBe(2);
      expect(selects[0].getAttribute("aria-label")).toBe("Select model for column 1");
      expect(selects[1].getAttribute("aria-label")).toBe("Select model for column 2");

      const composer = screen.getByRole("textbox", { name: /Send a message to all selected models/i });
      expect(composer).not.toBeNull();
    });

    it("exposes full model label via title attribute on select", () => {
      const longLabel = "A Very Long Model Label That Might Be Truncated In Narrow Columns";
      render(
        <CompareWorkspace
          configState={{ systemPrompt: "", params: {} }}
          availableModels={[{ id: "model-a", label: longLabel }]}
          onResult={() => {}}
          draft=""
          onDraftChange={() => {}}
        />
      );

      const select = screen.getAllByRole("combobox")[0];
      fireEvent.change(select, { target: { value: "model-a" } });
      
      expect(select.getAttribute("title")).toBe(longLabel);
    });
  });

  beforeEach(() => {
    vi.clearAllMocks();
    buildPlaygroundRequest.mockReturnValue({
      model: "test-model",
      messages: [{ role: "user", content: "test" }],
      stream: true,
    });
    
    // Setup requestAnimationFrame mock for immediate execution
    vi.stubGlobal("requestAnimationFrame", (cb) => {
      cb();
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});
  });

  it("renders correctly with initial two columns", () => {
    render(<CompareWorkspace configState={mockConfigState} availableModels={availableModels} />);
    
    expect(screen.getByTestId("playground-compare-workspace")).toBeTruthy();
    expect(screen.getAllByRole("combobox").length).toBe(2);
    expect(screen.getByTestId("compare-input")).toBeTruthy();
    expect(screen.getByTestId("compare-send").disabled).toBe(true); // No models selected
  });

  it("allows adding and removing columns up to 4", () => {
    render(<CompareWorkspace configState={mockConfigState} availableModels={availableModels} />);
    
    expect(screen.getAllByRole("combobox").length).toBe(2);
    
    const addButton = screen.getByTitle("Add model column");
    fireEvent.click(addButton);
    expect(screen.getAllByRole("combobox").length).toBe(3);
    
    fireEvent.click(addButton);
    expect(screen.getAllByRole("combobox").length).toBe(4);
    
    expect(screen.queryByTitle("Add model column")).toBeNull();
    
    const removeButtons = screen.getAllByTitle("Remove column");
    fireEvent.click(removeButtons[0]);
    expect(screen.getAllByRole("combobox").length).toBe(3);
  });

  it("sends identical requests to selected models", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      body: { getReader: () => ({ read: () => Promise.resolve({ done: true }) }) }
    });
    global.fetch = mockFetch;
    
    const mockPush = vi.fn().mockReturnValue([]);
    const mockClose = vi.fn().mockReturnValue({ type: "done" });
    createSseParser.mockReturnValue({ push: mockPush, close: mockClose });

    render(<CompareWorkspace configState={mockConfigState} availableModels={availableModels} />);
    
    // Select models
    const selects = screen.getAllByRole("combobox");
    fireEvent.change(selects[0], { target: { value: "openai/gpt-4o" } });
    fireEvent.change(selects[1], { target: { value: "anthropic/claude-3" } });
    
    // Type input
    const input = screen.getByTestId("compare-input");
    fireEvent.change(input, { target: { value: "Hello models" } });
    
    // Send
    const sendBtn = screen.getByTestId("compare-send");
    await act(async () => {
      fireEvent.click(sendBtn);
    });
    
    // Verify fetch was called twice with different abort signals
    expect(mockFetch).toHaveBeenCalledTimes(2);
    
    const fetchCall1 = mockFetch.mock.calls[0];
    const fetchCall2 = mockFetch.mock.calls[1];
    
    expect(fetchCall1[1].signal).not.toBe(fetchCall2[1].signal);
    
    // Verify request builder was called with identical shared config but different model
    expect(buildPlaygroundRequest).toHaveBeenCalledTimes(2);
    
    const req1 = buildPlaygroundRequest.mock.calls[0][0];
    const req2 = buildPlaygroundRequest.mock.calls[1][0];
    
    expect(req1.systemPrompt).toBe(mockConfigState.systemPrompt);
    expect(req1.messages).toEqual([{ role: "user", content: "Hello models" }]);
    expect(req2.messages).toEqual([{ role: "user", content: "Hello models" }]);
    
    // The only difference is the selected model
    expect(req1.model.id).toBe("openai/gpt-4o");
    expect(req2.model.id).toBe("anthropic/claude-3");
  });
  
  it("reports sanitized incomplete and error terminal results through onResult", async () => {
    const { createSseParser: createActualSseParser } = await vi.importActual(
      "../../../src/app/(dashboard)/dashboard/playground/lib/sseParser"
    );
    createSseParser.mockImplementation(createActualSseParser);
    const encoder = new TextEncoder();
    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, body: { getReader: () => ({ read: vi.fn().mockResolvedValue({ done: true }), cancel: vi.fn().mockResolvedValue(undefined) }) } })
      .mockResolvedValueOnce({ ok: true, status: 200, body: { getReader: () => ({ read: vi.fn().mockResolvedValue({ done: false, value: encoder.encode('data: {"error":{"message":"Bearer sk-secret-value"}}\n\n') }), cancel: vi.fn().mockResolvedValue(undefined) }) } });
    const onResult = vi.fn();

    render(<CompareWorkspace configState={mockConfigState} availableModels={availableModels} onResult={onResult} />);
    const selects = screen.getAllByRole("combobox");
    fireEvent.change(selects[0], { target: { value: "openai/gpt-4o" } });
    fireEvent.change(selects[1], { target: { value: "anthropic/claude-3" } });
    fireEvent.change(screen.getByTestId("compare-input"), { target: { value: "Inspect terminal states" } });

    await act(async () => {
      fireEvent.click(screen.getByTestId("compare-send"));
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(onResult).toHaveBeenCalledTimes(2);
    expect(onResult.mock.calls.map(([result]) => result.metrics.terminalState)).toEqual(expect.arrayContaining(["incomplete", "error"]));
    expect(JSON.stringify(onResult.mock.calls)).not.toContain("sk-secret-value");
  });

  it("keeps a replacement run authoritative when an old aborted fetch resolves late", async () => {
    const { createSseParser: createActualSseParser } = await vi.importActual(
      "../../../src/app/(dashboard)/dashboard/playground/lib/sseParser"
    );
    createSseParser.mockImplementation(createActualSseParser);
    let resolveOldFetch;
    const oldFetch = new Promise((resolve) => { resolveOldFetch = resolve; });
    const freshReader = {
      read: vi.fn().mockResolvedValue({ done: false, value: new TextEncoder().encode('data: [DONE]\\n\\n') }),
      cancel: vi.fn().mockResolvedValue(undefined),
    };
    global.fetch = vi.fn()
      .mockReturnValueOnce(oldFetch)
      .mockResolvedValueOnce({ ok: true, status: 200, body: { getReader: () => freshReader } });

    render(<CompareWorkspace configState={mockConfigState} availableModels={availableModels} />);
    fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: "openai/gpt-4o" } });
    fireEvent.change(screen.getByTestId("compare-input"), { target: { value: "old run" } });
    fireEvent.click(screen.getByTestId("compare-send"));
    await act(async () => { await Promise.resolve(); });
    const oldSignal = global.fetch.mock.calls[0][1].signal;

    fireEvent.click(screen.getByTestId("stop-col-col-default-a"));
    fireEvent.change(screen.getByTestId("compare-input"), { target: { value: "replacement run" } });
    fireEvent.click(screen.getByTestId("compare-send"));
    await act(async () => { await Promise.resolve(); });

    resolveOldFetch({ ok: true, status: 200, body: { getReader: () => freshReader } });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(oldSignal.aborted).toBe(true);
    expect(screen.getByTestId("state-col-default-a").textContent).toBe("COMPLETE");
  });

  it("treats a malformed frame as terminal error even when followed by done", async () => {
    const { createSseParser: createActualSseParser } = await vi.importActual(
      "../../../src/app/(dashboard)/dashboard/playground/lib/sseParser"
    );
    createSseParser.mockImplementation(createActualSseParser);
    const reader = {
      read: vi.fn().mockResolvedValue({
        done: false,
        value: new TextEncoder().encode('data: {BAD_JSON\\n\\ndata: [DONE]\\n\\n'),
      }),
      cancel: vi.fn().mockResolvedValue(undefined),
    };
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, body: { getReader: () => reader } });

    render(<CompareWorkspace configState={mockConfigState} availableModels={availableModels} />);
    fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: "openai/gpt-4o" } });
    fireEvent.change(screen.getByTestId("compare-input"), { target: { value: "malformed run" } });
    fireEvent.click(screen.getByTestId("compare-send"));

    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(reader.cancel).toHaveBeenCalled();
    expect(screen.getByTestId("state-col-default-a").textContent).toBe("ERROR");
  });

  it("proves real request-body equality, four-way stream isolation, and RAF cleanup on unmount", async () => {
    const { createSseParser: createActualSseParser } = await vi.importActual(
      "../../../src/app/(dashboard)/dashboard/playground/lib/sseParser"
    );
    createSseParser.mockImplementation(createActualSseParser);

    const encoder = new TextEncoder();
    const readers = [];
    const pendingReads = [];
    let fetchCallCount = 0;

    global.fetch = vi.fn().mockImplementation((url, opts) => {
      const idx = fetchCallCount++;
      const reader = {
        read: vi.fn(() => new Promise((resolve) => { pendingReads[idx] = resolve; })),
        cancel: vi.fn().mockResolvedValue(undefined),
      };
      readers[idx] = reader;
      if (fetchCallCount <= 4) {
        global.fetch.mock.calls[idx][1] = opts; // capture body for later parse
      }
      return Promise.resolve({ ok: true, body: { getReader: () => reader } });
    });

    const queuedRafs = new Map();
    let rafId = 0;
    global.requestAnimationFrame = vi.fn((cb) => { const id = ++rafId; queuedRafs.set(id, cb); return id; });
    global.cancelAnimationFrame = vi.fn((id) => { queuedRafs.delete(id); });

    const availableModels4 = [
      ...availableModels,
      { id: "test-provider/model-d", label: "Model D" },
    ];

    const { unmount } = render(<CompareWorkspace configState={mockConfigState} availableModels={availableModels4} />);
    fireEvent.click(screen.getByTitle("Add model column")); // get to 3 columns
    fireEvent.click(screen.getByTitle("Add model column")); // get to 4 columns

    const selects = screen.getAllByRole("combobox");
    fireEvent.change(selects[0], { target: { value: "openai/gpt-4o" } });
    fireEvent.change(selects[1], { target: { value: "anthropic/claude-3" } });
    fireEvent.change(selects[2], { target: { value: "google/gemini" } });
    fireEvent.change(selects[3], { target: { value: "test-provider/model-d" } });

    fireEvent.change(screen.getByTestId("compare-input"), { target: { value: "compare this" } });
    
    await act(async () => {
      fireEvent.click(screen.getByTestId("compare-send"));
    });

    // 1. real-body equality except model
    const bodies = global.fetch.mock.calls.slice(0, 4).map((call) => JSON.parse(call[1].body));
    const strippedBodies = bodies.map(({ model, ...rest }) => rest);
    expect(strippedBodies[0]).toEqual(strippedBodies[1]);
    expect(strippedBodies[0]).toEqual(strippedBodies[2]);
    expect(strippedBodies[0]).toEqual(strippedBodies[3]);
    expect(new Set(bodies.map((b) => b.model)).size).toBe(4);

    // Provide initial promise tick for states to become STREAMING
    await act(async () => {
      await Promise.resolve();
    });

    // 2. column A -> complete
    await act(async () => {
      pendingReads[0]({ done: false, value: encoder.encode('data: {"choices":[{"delta":{"content":"A"}}]}\n\ndata: [DONE]\n\n') });
    });

    // 3. column B -> stop while its partial output is still buffered in a queued RAF
    await act(async () => {
      pendingReads[1]({ done: false, value: encoder.encode('data: {"choices":[{"delta":{"content":"B_PARTIAL"}}]}\n\n') });
      await Promise.resolve();
    });

    const bufferedBOutput = "B_PARTIAL";
    const queuedBHandle = Array.from(queuedRafs.keys()).at(-1);
    expect(queuedBHandle).toBeDefined();
    const bSignal = global.fetch.mock.calls[1][1].signal;
    await act(async () => {
      fireEvent.click(screen.getByTestId("stop-col-col-default-b"));
    });

    expect(bSignal.aborted).toBe(true);
    expect(global.cancelAnimationFrame).toHaveBeenCalledWith(queuedBHandle);
    expect(screen.getByTestId("compare-col-col-default-b").textContent).toContain(bufferedBOutput);
    expect(screen.getByTestId("state-col-default-b").textContent).toBe("ABORTED");

    await act(async () => {
      pendingReads[1]({ done: false, value: encoder.encode('data: {"choices":[{"delta":{"content":"_LATE"}}]}\n\n') });
      await Promise.resolve();
    });
    expect(screen.getByTestId("compare-col-col-default-b").textContent).toContain(bufferedBOutput);
    expect(screen.getByTestId("compare-col-col-default-b").textContent).not.toContain("_LATE");
    expect(screen.getByTestId("state-col-default-b").textContent).toBe("ABORTED");

    // 4. column C -> error
    await act(async () => {
      pendingReads[2]({ done: false, value: encoder.encode('data: {"error":{"message":"Rate limited"}}\n\n') });
    });

    // 5. column D -> incomplete (EOF, no [DONE])
    await act(async () => {
      pendingReads[3]({ done: true });
    });
    
    await act(async () => {
      const callbacks = Array.from(queuedRafs.values());
      queuedRafs.clear();
      callbacks.forEach(cb => cb());
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByText(/^A$/)).toBeTruthy();
    expect(screen.getByText(/B_PARTIAL/)).toBeTruthy(); // frozen partial preserved
    expect(screen.getByText(/Rate limited/)).toBeTruthy();

    const statesFinal = screen.getAllByTestId(/state-/);
    expect(statesFinal[0].textContent).toBe("COMPLETE");
    expect(statesFinal[1].textContent).toBe("ABORTED");
    expect(statesFinal[2].textContent).toBe("ERROR");
    expect(statesFinal[3].textContent).toBe("INCOMPLETE");

    fireEvent.change(screen.getByTestId("compare-input"), { target: { value: "queue cleanup" } });
    await act(async () => {
      fireEvent.click(screen.getByTestId("compare-send"));
      await Promise.resolve();
    });
    await act(async () => {
      pendingReads[4]({ done: false, value: encoder.encode('data: {"choices":[{"delta":{"content":"QUEUED"}}]}\n\n') });
      await Promise.resolve();
    });
    const queuedUnmountHandle = Array.from(queuedRafs.keys()).at(-1);
    expect(queuedUnmountHandle).toBeDefined();
    unmount();
    expect(global.cancelAnimationFrame).toHaveBeenCalledWith(queuedUnmountHandle);
    expect(queuedRafs.size).toBe(0);
  });
});