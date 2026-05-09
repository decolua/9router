"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "parseAndValidateFlightRouterState", {
    enumerable: true,
    get: function() {
        return parseAndValidateFlightRouterState;
    }
});
const _types = require("./types");
const _superstruct = require("next/dist/compiled/superstruct");
function parseAndValidateFlightRouterState(stateHeader) {
    if (typeof stateHeader === 'undefined') {
        return undefined;
    }
    if (Array.isArray(stateHeader)) {
        throw Object.defineProperty(new Error('Multiple router state headers were sent. This is not allowed.'), "__NEXT_ERROR_CODE", {
            value: "E418",
            enumerable: false,
            configurable: true
        });
    }
    // We limit the size of the router state header to ~40kb. This is to prevent
    // a malicious user from sending a very large header and slowing down the
    // resolving of the router state.
    // This is around 2,000 nested or parallel route segment states:
    // '{"children":["",{}]}'.length === 20.
    if (stateHeader.length > 20 * 2000) {
        throw Object.defineProperty(new Error('The router state header was too large.'), "__NEXT_ERROR_CODE", {
            value: "E142",
            enumerable: false,
            configurable: true
        });
    }
    try {
        const state = JSON.parse(decodeURIComponent(stateHeader));
        (0, _superstruct.assert)(state, _types.flightRouterStateSchema);
        return state;
    } catch  {
        throw Object.defineProperty(new Error('The router state header was sent but could not be parsed.'), "__NEXT_ERROR_CODE", {
            value: "E10",
            enumerable: false,
            configurable: true
        });
    }
}

//# sourceMappingURL=parse-and-validate-flight-router-state.js.map