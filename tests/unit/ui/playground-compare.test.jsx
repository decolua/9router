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
  
  it("isolates streams and states correctly", async () => {
    // We mock read() to block until we want it to resolve
    let resolveRead1, resolveRead2;
    const p1 = new Promise(r => { resolveRead1 = r; });
    const p2 = new Promise(r => { resolveRead2 = r; });
    
    const mockFetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve({
        ok: true,
        body: { getReader: () => ({ read: () => p1 }) }
      }))
      .mockImplementationOnce(() => Promise.resolve({
        ok: true,
        body: { getReader: () => ({ read: () => p2 }) }
      }));
    global.fetch = mockFetch;
    
    const mockPush = vi.fn().mockReturnValue([{ type: "delta", text: "chunk " }]);
    const mockClose = vi.fn().mockReturnValue(null);
    createSseParser.mockReturnValue({ push: mockPush, close: mockClose });

    render(<CompareWorkspace configState={mockConfigState} availableModels={availableModels} />);
    
    const selects = screen.getAllByRole("combobox");
    fireEvent.change(selects[0], { target: { value: "openai/gpt-4o" } });
    fireEvent.change(selects[1], { target: { value: "anthropic/claude-3" } });
    
    fireEvent.change(screen.getByTestId("compare-input"), { target: { value: "Go" } });
    
    await act(async () => {
      fireEvent.click(screen.getByTestId("compare-send"));
    });
    
    // Yield to let the initial fetch resolve
    await act(async () => {
      await Promise.resolve();
    });

    // Both should be in STREAMING state since the mock fetch resolves immediately
    const states = screen.getAllByTestId(/state-col-/);
    expect(states[0].textContent).toBe("STREAMING");
    expect(states[1].textContent).toBe("STREAMING");
    
    // Stop column 2 specifically
    const stopBtns = screen.getAllByText(/Stop/i);
    // Column 1 is index 0, Column 2 is index 1
    await act(async () => {
      fireEvent.click(stopBtns[1]); // Stop col 2
    });
    
    // Column 1 is STREAMING, Column 2 is ABORTED
    const statesFinal = screen.getAllByTestId(/state-col-/);
    expect(statesFinal[0].textContent).toBe("STREAMING");
    expect(statesFinal[1].textContent).toBe("ABORTED");
    
    // Break the infinite loop of the active stream to finish test cleanly
    await act(async () => {
      resolveRead1({ done: true });
      resolveRead2({ done: true });
    });
  });
});