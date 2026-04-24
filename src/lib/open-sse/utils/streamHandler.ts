// Stream handler with disconnect detection - shared for all providers

// Get HH:MM:SS timestamp
function getTimeString(): string {
  return new Date().toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export interface StreamControllerOptions {
  onDisconnect?: (data: { reason: string; duration: number }) => void;
  onError?: (error: Error) => void;
  log?: any;
  provider?: string | null;
  model?: string | null;
}

export interface StreamController {
  signal: AbortSignal;
  startTime: number;
  isConnected: () => boolean;
  handleDisconnect: (reason?: string) => void;
  handleComplete: () => void;
  handleError: (error: any) => void;
  abort: () => void;
}

/**
 * Create stream controller with abort and disconnect detection
 */
export function createStreamController({ onDisconnect, onError, log, provider, model }: StreamControllerOptions = {}): StreamController {
  const abortController = new AbortController();
  const startTime = Date.now();
  let disconnected = false;
  let abortTimeout: NodeJS.Timeout | null = null;

  const logStream = (status: string) => {
    const duration = Date.now() - startTime;
    const p = provider?.toUpperCase() || "UNKNOWN";
    console.log(`[${getTimeString()}] 🌊 [STREAM] ${p} | ${model || "unknown"} | ${duration}ms | ${status}`);
  };

  return {
    signal: abortController.signal,
    startTime,

    isConnected: () => !disconnected,

    // Call when client disconnects
    handleDisconnect: (reason: string = "client_closed") => {
      if (disconnected) return;
      disconnected = true;

      logStream(`disconnect: ${reason}`);

      // Delay abort to allow cleanup
      abortTimeout = setTimeout(() => {
        abortController.abort();
      }, 500);

      onDisconnect?.({ reason, duration: Date.now() - startTime });
    },

    // Call when stream completes normally
    handleComplete: () => {
      if (disconnected) return;
      disconnected = true;

      logStream("complete");

      if (abortTimeout) {
        clearTimeout(abortTimeout);
        abortTimeout = null;
      }
    },

    // Call on error
    handleError: (error: any) => {
      if (disconnected) return;
      disconnected = true;

      if (abortTimeout) {
        clearTimeout(abortTimeout);
        abortTimeout = null;
      }

      if (error.name === "AbortError") {
        logStream("aborted");
        return;
      }

      logStream(`error: ${error.message}`);
      onError?.(error);
    },

    abort: () => abortController.abort()
  };
}

/**
 * Create transform stream with disconnect detection
 * Wraps existing transform stream and adds abort capability
 */
export function createDisconnectAwareStream(transformStream: { readable: ReadableStream; writable: WritableStream }, streamController: StreamController): ReadableStream {
  const reader = transformStream.readable.getReader();
  const writer = transformStream.writable.getWriter();

  return new ReadableStream({
    async pull(controller) {
      if (!streamController.isConnected()) {
        controller.close();
        return;
      }

      try {
        const { done, value } = await reader.read();
        if (done) {
          streamController.handleComplete();
          controller.close();
          return;
        }
        controller.enqueue(value);
      } catch (error) {
        streamController.handleError(error);
        // Cleanup reader/writer to avoid orphaned streams
        reader.cancel().catch(() => {});
        writer.abort().catch(() => {});
        controller.error(error);
      }
    },

    cancel(reason) {
      streamController.handleDisconnect(reason || "cancelled");
      reader.cancel();
      writer.abort();
    }
  });
}

/**
 * Pipe provider response through transform with disconnect detection
 */
export function pipeWithDisconnect(providerResponse: Response, transformStream: TransformStream, streamController: StreamController): ReadableStream {
  if (!providerResponse.body) {
    throw new Error("Provider response body is null");
  }
  const transformedBody = providerResponse.body.pipeThrough(transformStream);
  return createDisconnectAwareStream(
    { readable: transformedBody, writable: new WritableStream({ write() { return Promise.resolve(); } }) },
    streamController
  );
}
