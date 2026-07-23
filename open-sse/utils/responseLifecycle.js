export function bindResponseLifecycle(response, onSettled) {
  if (!(response instanceof Response)) {
    throw new TypeError("response must be a Response");
  }
  if (typeof onSettled !== "function") {
    throw new TypeError("onSettled must be a function");
  }

  let settled = false;
  const settle = () => {
    if (settled) return false;
    settled = true;
    try {
      onSettled();
    } catch {
      // Lifecycle cleanup must not replace the response outcome.
    }
    return true;
  };

  if (!response.body) {
    settle();
    return response;
  }

  let reader;
  try {
    reader = response.body.getReader();
  } catch (error) {
    settle();
    throw error;
  }

  const body = new ReadableStream({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          settle();
          controller.close();
          return;
        }
        controller.enqueue(value);
      } catch (error) {
        settle();
        controller.error(error);
      }
    },
    async cancel(reason) {
      try {
        await reader.cancel(reason);
      } finally {
        settle();
      }
    },
  });

  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}
