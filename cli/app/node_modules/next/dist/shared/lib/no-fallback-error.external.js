"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "NoFallbackError", {
    enumerable: true,
    get: function() {
        return NoFallbackError;
    }
});
class NoFallbackError extends Error {
    constructor(){
        super();
        this.message = 'Internal: NoFallbackError';
    }
}

//# sourceMappingURL=no-fallback-error.external.js.map