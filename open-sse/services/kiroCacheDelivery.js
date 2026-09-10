import { kiroCreditCache } from "./kiroCreditCache.js";

const responses = new WeakMap();

// custom-server owns this AsyncLocalStorage. No request header or wire field can
// create a delivery receipt. Bare next dev/start has no receipt and cannot learn.
export function prepareKiroCacheDelivery(request, cache = kiroCreditCache) {
  const delivery = globalThis[Symbol.for("9router.responseDelivery")]?.getStore();
  if (!delivery || delivery.finished) return null;
  const plan = cache.prepare(request);
  if (!plan) return null;
  const transaction = {
    plan, observation: null,
    complete(success) {
      plan.complete(transaction.observation, success && !request.signal?.aborted);
      delivery.callbacks.delete(finish);
    }
  };
  const finish = success => transaction.complete(success && delivery.selected === transaction);
  delivery.callbacks.add(finish);
  return transaction;
}

export function bindKiroCacheDelivery(response, transaction) {
  if (response && transaction) responses.set(response, transaction);
}

export function forwardKiroCacheDelivery(upstream, downstream) {
  bindKiroCacheDelivery(downstream, responses.get(upstream));
  return downstream;
}

export function cancelKiroCacheDelivery(response) {
  responses.get(response)?.complete(false);
}

// Called only for the response selected by the outer request router. Internal
// fallback probes, fusion/search generations and discarded Responses never win.
export function selectKiroCacheResponse(response) {
  const delivery = globalThis[Symbol.for("9router.responseDelivery")]?.getStore();
  if (delivery && !delivery.finished) delivery.selected = responses.get(response);
  return response;
}
