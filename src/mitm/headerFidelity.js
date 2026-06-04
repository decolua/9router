"use strict";

const INTERNAL_REQUEST_HEADER_NAME = "x-request-source";

function stripInternalRequestHeaders(headers = {}) {
  const next = { ...headers };
  for (const key of Object.keys(next)) {
    if (key.toLowerCase() === INTERNAL_REQUEST_HEADER_NAME) {
      delete next[key];
    }
  }
  return next;
}

module.exports = { stripInternalRequestHeaders };
