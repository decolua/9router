"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "getRspackCore", {
    enumerable: true,
    get: function() {
        return getRspackCore;
    }
});
const _log = require("../../build/output/log");
function getRspackCore() {
    warnRspack();
    try {
        // eslint-disable-next-line @next/internal/typechecked-require
        return require('next-rspack/rspack-core');
    } catch (e) {
        if (e instanceof Error && 'code' in e && e.code === 'MODULE_NOT_FOUND') {
            throw Object.defineProperty(new Error('@rspack/core is not available. Please make sure `next-rspack` is correctly installed.'), "__NEXT_ERROR_CODE", {
                value: "E647",
                enumerable: false,
                configurable: true
            });
        }
        throw e;
    }
}
function warnRspack() {
    if (process.env.__NEXT_TEST_MODE) {
        return;
    }
    (0, _log.warnOnce)(`\`next-rspack\` is currently experimental. It's not an official Next.js plugin, and is supported by the Rspack team in partnership with Next.js. Help improve Next.js and Rspack by providing feedback at https://github.com/vercel/next.js/discussions/77800`);
}

//# sourceMappingURL=get-rspack.js.map