/**
 * Decodes a query path parameter.
 *
 * @param value - The value to decode.
 * @returns The decoded value.
 */ "use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "decodeQueryPathParameter", {
    enumerable: true,
    get: function() {
        return decodeQueryPathParameter;
    }
});
function decodeQueryPathParameter(value) {
    // When deployed to Vercel, the value may be encoded, so this attempts to
    // decode it and returns the original value if it fails.
    try {
        return decodeURIComponent(value);
    } catch  {
        return value;
    }
}

//# sourceMappingURL=decode-query-path-parameter.js.map