"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "createComponentStylesAndScripts", {
    enumerable: true,
    get: function() {
        return createComponentStylesAndScripts;
    }
});
const _interopdefault = require("./interop-default");
const _getcssinlinedlinktags = require("./get-css-inlined-link-tags");
const _getassetquerystring = require("./get-asset-query-string");
const _encodeuripath = require("../../shared/lib/encode-uri-path");
const _rendercssresource = require("./render-css-resource");
async function createComponentStylesAndScripts({ filePath, getComponent, injectedCSS, injectedJS, ctx }) {
    const { componentMod: { createElement } } = ctx;
    const { styles: entryCssFiles, scripts: jsHrefs } = (0, _getcssinlinedlinktags.getLinkAndScriptTags)(filePath, injectedCSS, injectedJS);
    const styles = (0, _rendercssresource.renderCssResource)(entryCssFiles, ctx);
    const scripts = jsHrefs ? jsHrefs.map((href, index)=>createElement('script', {
            src: `${ctx.assetPrefix}/_next/${(0, _encodeuripath.encodeURIPath)(href)}${(0, _getassetquerystring.getAssetQueryString)(ctx, true)}`,
            async: true,
            key: `script-${index}`
        })) : null;
    const Comp = (0, _interopdefault.interopDefault)(await getComponent());
    return [
        Comp,
        styles,
        scripts
    ];
}

//# sourceMappingURL=create-component-styles-and-scripts.js.map