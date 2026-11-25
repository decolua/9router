// Compatibility hooks. Only requestDetailsRepo may persist request or response content.
function createNoOpLogger() {
  return {
    sessionPath: null,
    logClientRawRequest() {},
    logRawRequest() {},
    logOpenAIRequest() {},
    logTargetRequest() {},
    logProviderResponse() {},
    appendProviderChunk() {},
    appendOpenAIChunk() {},
    logConvertedResponse() {},
    appendConvertedChunk() {},
    logError() {}
  };
}

export async function createRequestLogger() { return createNoOpLogger(); }
export function logRequest() {}
export function logResponse() {}
export function logError() {}
