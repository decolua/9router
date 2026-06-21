import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	createDisconnectAwareStream,
	createStreamController,
} from "../../open-sse/utils/streamHandler.js";
import { buildAbortedResponsesTerminalBytes } from "../../open-sse/utils/responsesStreamHelpers.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function makeStreamController(options = {}) {
	return createStreamController({
		provider: "test",
		model: "model",
		log: {},
		...options,
	});
}

function makeControllerStub({ connected = true } = {}) {
	const calls = { complete: 0, error: [], disconnect: [] };
	let isConnected = connected;

	return {
		calls,
		signal: new AbortController().signal,
		startTime: Date.now(),
		isConnected: () => isConnected,
		setConnected: (value) => {
			isConnected = value;
		},
		handleComplete: () => {
			calls.complete++;
			isConnected = false;
		},
		handleError: (error) => {
			calls.error.push(error);
			isConnected = false;
		},
		handleDisconnect: (reason) => {
			calls.disconnect.push(reason);
			isConnected = false;
		},
		abort: () => {
			isConnected = false;
		},
	};
}

function makeReadableThatErrors(error, chunks = []) {
	return new ReadableStream({
		start(controller) {
			for (const chunk of chunks) {
				controller.enqueue(encoder.encode(chunk));
			}
			controller.error(error);
		},
	});
}

function makeTransformLike(readable) {
	return {
		readable,
		writable: {
			getWriter: () => ({
				abort: vi.fn(() => Promise.resolve()),
			}),
		},
	};
}

function fakeTransformLike() {
	const read = vi.fn();
	const cancel = vi.fn(() => Promise.resolve());
	const abort = vi.fn(() => Promise.resolve());
	return {
		transform: {
			readable: { getReader: () => ({ read, cancel }) },
			writable: { getWriter: () => ({ abort }) },
		},
		read,
		cancel,
		abort,
	};
}

async function readAll(stream) {
	const reader = stream.getReader();
	let text = "";

	while (true) {
		const { value, done } = await reader.read();
		if (done) break;
		text += decoder.decode(value, { stream: true });
	}

	text += decoder.decode();
	return text;
}

function countOccurrences(text, needle) {
	return text.split(needle).length - 1;
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
	vi.clearAllTimers();
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe("createStreamController disconnect lifecycle", () => {
	it("aborts 500ms after disconnect and reports the disconnect once", () => {
		const onDisconnect = vi.fn();
		const controller = makeStreamController({ onDisconnect });

		controller.handleDisconnect("client_closed");

		expect(controller.signal.aborted).toBe(false);
		expect(onDisconnect).toHaveBeenCalledTimes(1);
		expect(onDisconnect).toHaveBeenCalledWith({
			reason: "client_closed",
			duration: 0,
		});

		vi.advanceTimersByTime(499);
		expect(controller.signal.aborted).toBe(false);

		vi.advanceTimersByTime(1);
		expect(controller.signal.aborted).toBe(true);
	});

	it("does not schedule a delayed abort when completion wins the terminal latch", () => {
		const controller = makeStreamController();

		controller.handleComplete();
		vi.advanceTimersByTime(1000);

		expect(controller.isConnected()).toBe(false);
		expect(controller.signal.aborted).toBe(false);
	});

	it("keeps the first terminal decision when completion follows disconnect", () => {
		const onDisconnect = vi.fn();
		const controller = makeStreamController({ onDisconnect });

		controller.handleDisconnect("client_closed");
		controller.handleComplete();
		vi.advanceTimersByTime(500);

		expect(onDisconnect).toHaveBeenCalledTimes(1);
		expect(controller.signal.aborted).toBe(true);
	});

	it("makes repeated completion calls idempotent", () => {
		const controller = makeStreamController();

		controller.handleComplete();
		controller.handleComplete();

		expect(controller.isConnected()).toBe(false);
		expect(controller.signal.aborted).toBe(false);
	});

	it("treats AbortError as a silent error path", () => {
		const onError = vi.fn();
		const controller = makeStreamController({ onError });

		controller.handleError(new DOMException("aborted", "AbortError"));

		expect(controller.isConnected()).toBe(false);
		expect(onError).not.toHaveBeenCalled();
	});

	it("reports a generic error once and does not schedule a delayed abort", () => {
		const onError = vi.fn();
		const controller = makeStreamController({ onError });
		const error = new Error("boom");

		controller.handleError(error);
		controller.handleError(new Error("ignored"));
		vi.advanceTimersByTime(1000);

		expect(controller.isConnected()).toBe(false);
		expect(controller.signal.aborted).toBe(false);
		expect(onError).toHaveBeenCalledTimes(1);
		expect(onError).toHaveBeenCalledWith(error);
	});
});

describe("createDisconnectAwareStream resilience behavior", () => {
	it.each([
		{ label: "ECONNRESET message", error: new Error("read ECONNRESET") },
		{ label: "ETIMEDOUT message", error: new Error("connect ETIMEDOUT") },
		{ label: "EPIPE message", error: new Error("write EPIPE") },
		{ label: "socket hang up message", error: new Error("socket hang up") },
		{
			label: "AbortError name",
			error: new DOMException("aborted", "AbortError"),
		},
		{
			label: "UND_ERR_SOCKET code",
			error: Object.assign(new Error("terminated"), { code: "UND_ERR_SOCKET" }),
		},
	])("closes gracefully for $label", async ({ error }) => {
		const controller = makeControllerStub();
		const stream = createDisconnectAwareStream(
			makeTransformLike(makeReadableThatErrors(error)),
			controller,
			null,
		);

		await expect(readAll(stream)).resolves.toBe("");
		expect(controller.calls.error).toHaveLength(1);
	});

	it("emits one Responses terminal payload when an abort-like upstream close occurs", async () => {
		const controller = makeControllerStub();
		let pulls = 0;
		const readable = new ReadableStream({
			pull(streamController) {
				if (pulls++ === 0) {
					streamController.enqueue(
						encoder.encode("event: response.created\ndata: {}\n\n"),
					);
					return;
				}
				streamController.error(new Error("stream stall timeout"));
			},
		});
		const stream = createDisconnectAwareStream(
			makeTransformLike(readable),
			controller,
			buildAbortedResponsesTerminalBytes,
		);

		const text = await readAll(stream);

		expect(text).toContain("event: response.created");
		expect(countOccurrences(text, "event: response.failed")).toBe(1);
		expect(countOccurrences(text, "data: [DONE]")).toBe(1);
	});

	it("emits terminal and closes without reading upstream when already disconnected", async () => {
		const controller = makeControllerStub({ connected: false });
		const { transform, read } = fakeTransformLike();
		const stream = createDisconnectAwareStream(
			transform,
			controller,
			buildAbortedResponsesTerminalBytes,
		);

		const text = await readAll(stream);

		expect(text).toContain("event: response.failed");
		expect(text).toContain("data: [DONE]");
		expect(read).not.toHaveBeenCalled();
	});

	it("routes downstream cancel to handleDisconnect", async () => {
		const controller = makeControllerStub();
		const { transform, cancel, abort } = fakeTransformLike();
		const stream = createDisconnectAwareStream(transform, controller, null);

		await stream.cancel("downstream gone");

		expect(controller.calls.disconnect).toEqual(["downstream gone"]);
		expect(cancel).toHaveBeenCalledTimes(1);
		expect(abort).toHaveBeenCalledTimes(1);
	});
});
