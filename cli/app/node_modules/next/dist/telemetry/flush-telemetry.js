"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "flushTelemetry", {
    enumerable: true,
    get: function() {
        return flushTelemetry;
    }
});
const _shared = require("../trace/shared");
async function flushTelemetry() {
    let telemetry = _shared.traceGlobals.get('telemetry');
    if (telemetry) {
        await telemetry.flush();
    }
}

//# sourceMappingURL=flush-telemetry.js.map