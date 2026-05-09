"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "HardDeprecatedConfigError", {
    enumerable: true,
    get: function() {
        return HardDeprecatedConfigError;
    }
});
class HardDeprecatedConfigError extends Error {
    constructor(message){
        super(message);
        // This error is meant to interrupt the server start/build process
        // but the stack trace isn't meaningful, as it points to internal code.
        this.stack = undefined;
    }
}

//# sourceMappingURL=hard-deprecated-config-error.js.map