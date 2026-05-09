"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "throwEmptyGenerateStaticParamsError", {
    enumerable: true,
    get: function() {
        return throwEmptyGenerateStaticParamsError;
    }
});
function throwEmptyGenerateStaticParamsError() {
    const error = Object.defineProperty(new Error('When using Cache Components, all `generateStaticParams` functions must return at least one result. ' + 'This is to ensure that we can perform build-time validation that there is no other dynamic accesses that would cause a runtime error.\n\n' + 'Learn more: https://nextjs.org/docs/messages/empty-generate-static-params'), "__NEXT_ERROR_CODE", {
        value: "E898",
        enumerable: false,
        configurable: true
    });
    error.name = 'EmptyGenerateStaticParamsError';
    // This error is meant to interrupt the server start/build process
    // but the stack trace isn't meaningful, as it points to internal code.
    error.stack = undefined;
    throw error;
}

//# sourceMappingURL=empty-generate-static-params-error.js.map