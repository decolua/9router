import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { STREAM_STALL_TIMEOUT_MS } from "../../open-sse/config/runtimeConfig.js";
import { pipeWithDisconnect } from "../../open-sse/utils/streamHandler.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function makeController() {
	const abortController = new AbortController();
	const calls = { complete: 0, error: [], disconnect: [], abort: 0 };
	let connected = true;

	return {
		calls,
		signal: abortController.signal,
		startTime: Date.now(),
		isConnected: () => connected,
		handleComplete: () => {
			calls.complete++;
			connected = false;
		},
		handleError: (error) => {
			calls.error.push(error?.message);
			connected = false;
		},
		handleDisconnect: (reason) => {
			calls.disconnect.push(reason);
			connected = false;
		},
		abort: () => {
			calls.abort++;
			connected = false;
			abortController.abort();
		},
	};
}

function makeUpstream() {
	let controller;
	const body = new ReadableStream({
		start(c) {
			controller = c;
		},
	});

	return {
		response: { body },
		push: (text) => controller.enqueue(encoder.encode(text)),
		end: () => controller.close(),
		error: (error) => controller.error(error),
	};
}

function makePipedStream({ stallTimeoutMs = 1000 } = {}) {
	const upstream = makeUpstream();
	const streamController = makeController();
	const output = pipeWithDisconnect(
		upstream.response,
		new TransformStream(),
		streamController,
		null,
		stallTimeoutMs,
	);

	return { upstream, streamController, output };
}

async function readChunk(reader) {
	const { value, done } = await reader.read();
	return { text: value ? decoder.decode(value, { stream: true }) : "", done };
}

async function readUntilDone(stream) {
	const reader = stream.getReader();
	try {
		let text = "";
		while (true) {
			const { value, done } = await reader.read();
			if (done) break;
			text += decoder.decode(value, { stream: true });
		}
		text += decoder.decode();
		return text;
	} finally {
		reader.releaseLock();
	}
}

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	vi.clearAllTimers();
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe("pipeWithDisconnect stall watchdog", () => {
	it("fires after upstream silence", () => {
		const { streamController } = makePipedStream({ stallTimeoutMs: 1000 });

		vi.advanceTimersByTime(1000);

		expect(streamController.calls.error).toEqual(["stream stall timeout"]);
		expect(streamController.calls.abort).toBe(1);
		expect(streamController.signal.aborted).toBe(true);
	});

	it("resets the stall timer on each upstream chunk", async () => {
		const { upstream, streamController, output } = makePipedStream({
			stallTimeoutMs: 1000,
		});
		const reader = output.getReader();

		upstream.push("one");
		await expect(readChunk(reader)).resolves.toMatchObject({
			text: "one",
			done: false,
		});

		vi.advanceTimersByTime(900);
		upstream.push("two");
		await expect(readChunk(reader)).resolves.toMatchObject({
			text: "two",
			done: false,
		});

		vi.advanceTimersByTime(900);
		expect(streamController.calls.abort).toBe(0);
		expect(streamController.calls.error).toEqual([]);

		vi.advanceTimersByTime(100);
		expect(streamController.calls.error).toEqual(["stream stall timeout"]);
		expect(streamController.calls.abort).toBe(1);

		reader.releaseLock();
	});

	it("clears the stall timer when upstream reaches EOF", async () => {
		const { upstream, streamController, output } = makePipedStream({
			stallTimeoutMs: 1000,
		});

		upstream.push("done");
		upstream.end();

		await expect(readUntilDone(output)).resolves.toBe("done");
		vi.advanceTimersByTime(5000);

		expect(streamController.calls.complete).toBe(1);
		expect(streamController.calls.error).toEqual([]);
		expect(streamController.calls.abort).toBe(0);
	});

	it("does not fire a stale abort after normal completion", async () => {
		const { upstream, streamController, output } = makePipedStream({
			stallTimeoutMs: 1000,
		});

		upstream.push("final");
		upstream.end();
		await readUntilDone(output);

		vi.advanceTimersByTime(60_000);

		expect(streamController.calls.complete).toBe(1);
		expect(streamController.calls.error).toEqual([]);
		expect(streamController.calls.abort).toBe(0);
	});

	it("clears the stall timer on the upstream error path", async () => {
		const { upstream, streamController, output } = makePipedStream({
			stallTimeoutMs: 1000,
		});
		const reader = output.getReader();

		upstream.error(new Error("boom"));
		await expect(reader.read()).rejects.toThrow("boom");

		vi.advanceTimersByTime(5000);

		expect(streamController.calls.error).toEqual(["boom"]);
		expect(streamController.calls.abort).toBe(0);
		reader.releaseLock();
	});

	it("honors a custom stallTimeoutMs", () => {
		const { streamController } = makePipedStream({ stallTimeoutMs: 500 });

		vi.advanceTimersByTime(499);
		expect(streamController.calls.abort).toBe(0);
		expect(streamController.calls.error).toEqual([]);

		vi.advanceTimersByTime(1);
		expect(streamController.calls.error).toEqual(["stream stall timeout"]);
		expect(streamController.calls.abort).toBe(1);
	});

	it("uses STREAM_STALL_TIMEOUT_MS as the default watchdog delay", () => {
		const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
		const upstream = makeUpstream();
		const streamController = makeController();

		pipeWithDisconnect(
			upstream.response,
			new TransformStream(),
			streamController,
		);

		expect(
			setTimeoutSpy.mock.calls.some(
				([, delay]) => delay === STREAM_STALL_TIMEOUT_MS,
			),
		).toBe(true);
	});
});
