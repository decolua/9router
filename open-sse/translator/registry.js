const requestRegistry = new Map();
const responseRegistry = new Map();

export function register(from, to, requestFn, responseFn) {
  const key = `${from}:${to}`;
  if (requestFn) requestRegistry.set(key, requestFn);
  if (responseFn) responseRegistry.set(key, responseFn);
}

export function getRequestTranslator(from, to) {
  return requestRegistry.get(`${from}:${to}`);
}

export function getResponseTranslator(from, to) {
  return responseRegistry.get(`${from}:${to}`);
}
