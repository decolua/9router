"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    TurbopackInternalError: null,
    throwTurbopackInternalError: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    TurbopackInternalError: function() {
        return TurbopackInternalError;
    },
    throwTurbopackInternalError: function() {
        return throwTurbopackInternalError;
    }
});
const _events = require("../../../telemetry/events");
const _shared = require("../../../trace/shared");
class TurbopackInternalError extends Error {
    constructor({ message, anonymizedLocation }){
        super(message), this.name = 'TurbopackInternalError', // Manually set this as this isn't statically determinable
        this.__NEXT_ERROR_CODE = 'TurbopackInternalError';
        this.location = anonymizedLocation;
    }
}
function throwTurbopackInternalError(conversionError, opts) {
    if (conversionError != null) {
        // Somehow napi failed to convert `opts` to a JS object??? Just give up and throw that instead.
        throw Object.defineProperty(new Error('NAPI type conversion error in throwTurbopackInternalError', {
            cause: conversionError
        }), "__NEXT_ERROR_CODE", {
            value: "E723",
            enumerable: false,
            configurable: true
        });
    }
    const err = new TurbopackInternalError(opts);
    const telemetry = _shared.traceGlobals.get('telemetry');
    if (telemetry) {
        telemetry.record((0, _events.eventErrorThrown)(err, opts.anonymizedLocation));
    } else {
        console.error('Expected `telemetry` to be set in globals');
    }
    throw err;
}

//# sourceMappingURL=internal-error.js.map