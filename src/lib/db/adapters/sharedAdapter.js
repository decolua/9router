import { AsyncLocalStorage } from "node:async_hooks";
import path from "node:path";

const registry = globalThis.__9routerAdapterRegistry__ ??= new Map();
const transactions = globalThis.__9routerAdapterTransactions__ ??= new AsyncLocalStorage();

function keyFor(filePath) {
  return path.resolve(filePath);
}

function isThenable(value) {
  return value && (typeof value === "object" || typeof value === "function") && typeof value.then === "function";
}

function facade(key, entry) {
  entry.refs += 1;
  let closed = false;
  return {
    ...entry.adapter,
    transaction(fn) {
      if (transactions.getStore()) throw new Error("Nested database transactions are not supported");
      return entry.adapter.transaction(() => transactions.run(true, () => {
        const result = fn();
        if (isThenable(result)) throw new TypeError("Database transactions must be synchronous");
        return result;
      }));
    },
    close() {
      if (closed) return;
      closed = true;
      entry.refs -= 1;
      if (entry.refs === 0) {
        registry.delete(key);
        entry.adapter.close();
      }
    },
  };
}

export function sharedAdapter(filePath, create) {
  const key = keyFor(filePath);
  let entry = registry.get(key);
  if (!entry) {
    entry = { adapter: create(key), refs: 0 };
    registry.set(key, entry);
  }
  return facade(key, entry);
}

export async function sharedAdapterAsync(filePath, create) {
  const key = keyFor(filePath);
  let entry = registry.get(key);
  if (!entry) {
    const pending = Promise.resolve(create(key));
    entry = { adapter: null, pending, refs: 0 };
    registry.set(key, entry);
    try { entry.adapter = await pending; }
    catch (error) { registry.delete(key); throw error; }
  } else if (entry.pending) {
    await entry.pending;
  }
  return facade(key, entry);
}
