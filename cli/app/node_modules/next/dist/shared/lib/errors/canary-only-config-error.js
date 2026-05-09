"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    CanaryOnlyConfigError: null,
    isStableBuild: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    CanaryOnlyConfigError: function() {
        return CanaryOnlyConfigError;
    },
    isStableBuild: function() {
        return isStableBuild;
    }
});
function isStableBuild() {
    return !"16.2.1"?.includes('canary') && !process.env.__NEXT_TEST_MODE && !process.env.NEXT_PRIVATE_LOCAL_DEV;
}
class CanaryOnlyConfigError extends Error {
    constructor(arg){
        if (typeof arg === 'object' && 'feature' in arg) {
            super(`The experimental feature "${arg.feature}" can only be enabled when using the latest canary version of Next.js.`);
        } else {
            super(arg);
        }
        // This error is meant to interrupt the server start/build process
        // but the stack trace isn't meaningful, as it points to internal code.
        this.stack = undefined;
    }
}

//# sourceMappingURL=canary-only-config-error.js.map