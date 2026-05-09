"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "lazyRenderPagesPage", {
    enumerable: true,
    get: function() {
        return lazyRenderPagesPage;
    }
});
const lazyRenderPagesPage = (...args)=>{
    if (process.env.NEXT_MINIMAL) {
        throw Object.defineProperty(new Error("Can't use lazyRenderPagesPage in minimal mode"), "__NEXT_ERROR_CODE", {
            value: "E272",
            enumerable: false,
            configurable: true
        });
    } else {
        const render = require('./module.compiled').renderToHTML;
        return render(...args);
    }
};

//# sourceMappingURL=module.render.js.map