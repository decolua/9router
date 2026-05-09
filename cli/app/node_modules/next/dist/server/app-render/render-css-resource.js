"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "renderCssResource", {
    enumerable: true,
    get: function() {
        return renderCssResource;
    }
});
const _encodeuripath = require("../../shared/lib/encode-uri-path");
const _getassetquerystring = require("./get-asset-query-string");
function renderCssResource(entryCssFiles, ctx, preloadCallbacks) {
    const { componentMod: { createElement } } = ctx;
    return entryCssFiles.map((entryCssFile, index)=>{
        // `Precedence` is an opt-in signal for React to handle resource
        // loading and deduplication, etc. It's also used as the key to sort
        // resources so they will be injected in the correct order.
        // During HMR, it's critical to use different `precedence` values
        // for different stylesheets, so their order will be kept.
        // https://github.com/facebook/react/pull/25060
        const precedence = process.env.NODE_ENV === 'development' ? 'next_' + entryCssFile.path : 'next';
        // In dev, Safari and Firefox will cache the resource during HMR:
        // - https://github.com/vercel/next.js/issues/5860
        // - https://bugs.webkit.org/show_bug.cgi?id=187726
        // Because of this, we add a `?v=` query to bypass the cache during
        // development. We need to also make sure that the number is always
        // increasing.
        const fullHref = `${ctx.assetPrefix}/_next/${(0, _encodeuripath.encodeURIPath)(entryCssFile.path)}${(0, _getassetquerystring.getAssetQueryString)(ctx, true)}`;
        if (entryCssFile.inlined && !ctx.parsedRequestHeaders.isRSCRequest) {
            return createElement('style', {
                key: index,
                nonce: ctx.nonce,
                precedence: precedence,
                href: fullHref
            }, entryCssFile.content);
        }
        preloadCallbacks == null ? void 0 : preloadCallbacks.push(()=>{
            ctx.componentMod.preloadStyle(fullHref, ctx.renderOpts.crossOrigin, ctx.nonce);
        });
        return createElement('link', {
            key: index,
            rel: 'stylesheet',
            href: fullHref,
            precedence: precedence,
            crossOrigin: ctx.renderOpts.crossOrigin,
            nonce: ctx.nonce
        });
    });
}

//# sourceMappingURL=render-css-resource.js.map