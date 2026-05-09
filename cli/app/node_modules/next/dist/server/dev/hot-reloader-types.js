"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    HMR_MESSAGE_SENT_TO_BROWSER: null,
    HMR_MESSAGE_SENT_TO_SERVER: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    HMR_MESSAGE_SENT_TO_BROWSER: function() {
        return HMR_MESSAGE_SENT_TO_BROWSER;
    },
    HMR_MESSAGE_SENT_TO_SERVER: function() {
        return HMR_MESSAGE_SENT_TO_SERVER;
    }
});
var HMR_MESSAGE_SENT_TO_BROWSER = /*#__PURE__*/ function(HMR_MESSAGE_SENT_TO_BROWSER) {
    // JSON messages:
    HMR_MESSAGE_SENT_TO_BROWSER["ADDED_PAGE"] = "addedPage";
    HMR_MESSAGE_SENT_TO_BROWSER["REMOVED_PAGE"] = "removedPage";
    HMR_MESSAGE_SENT_TO_BROWSER["RELOAD_PAGE"] = "reloadPage";
    HMR_MESSAGE_SENT_TO_BROWSER["SERVER_COMPONENT_CHANGES"] = "serverComponentChanges";
    HMR_MESSAGE_SENT_TO_BROWSER["MIDDLEWARE_CHANGES"] = "middlewareChanges";
    HMR_MESSAGE_SENT_TO_BROWSER["CLIENT_CHANGES"] = "clientChanges";
    HMR_MESSAGE_SENT_TO_BROWSER["SERVER_ONLY_CHANGES"] = "serverOnlyChanges";
    HMR_MESSAGE_SENT_TO_BROWSER["SYNC"] = "sync";
    HMR_MESSAGE_SENT_TO_BROWSER["BUILT"] = "built";
    HMR_MESSAGE_SENT_TO_BROWSER["BUILDING"] = "building";
    HMR_MESSAGE_SENT_TO_BROWSER["DEV_PAGES_MANIFEST_UPDATE"] = "devPagesManifestUpdate";
    HMR_MESSAGE_SENT_TO_BROWSER["TURBOPACK_MESSAGE"] = "turbopack-message";
    HMR_MESSAGE_SENT_TO_BROWSER["SERVER_ERROR"] = "serverError";
    HMR_MESSAGE_SENT_TO_BROWSER["TURBOPACK_CONNECTED"] = "turbopack-connected";
    HMR_MESSAGE_SENT_TO_BROWSER["ISR_MANIFEST"] = "isrManifest";
    HMR_MESSAGE_SENT_TO_BROWSER["CACHE_INDICATOR"] = "cacheIndicator";
    HMR_MESSAGE_SENT_TO_BROWSER["DEV_INDICATOR"] = "devIndicator";
    HMR_MESSAGE_SENT_TO_BROWSER["DEVTOOLS_CONFIG"] = "devtoolsConfig";
    HMR_MESSAGE_SENT_TO_BROWSER["REQUEST_CURRENT_ERROR_STATE"] = "requestCurrentErrorState";
    HMR_MESSAGE_SENT_TO_BROWSER["REQUEST_PAGE_METADATA"] = "requestPageMetadata";
    // Binary messages:
    HMR_MESSAGE_SENT_TO_BROWSER[HMR_MESSAGE_SENT_TO_BROWSER["REACT_DEBUG_CHUNK"] = 0] = "REACT_DEBUG_CHUNK";
    HMR_MESSAGE_SENT_TO_BROWSER[HMR_MESSAGE_SENT_TO_BROWSER["ERRORS_TO_SHOW_IN_BROWSER"] = 1] = "ERRORS_TO_SHOW_IN_BROWSER";
    return HMR_MESSAGE_SENT_TO_BROWSER;
}({});
var HMR_MESSAGE_SENT_TO_SERVER = /*#__PURE__*/ function(HMR_MESSAGE_SENT_TO_SERVER) {
    // JSON messages:
    HMR_MESSAGE_SENT_TO_SERVER["MCP_ERROR_STATE_RESPONSE"] = "mcp-error-state-response";
    HMR_MESSAGE_SENT_TO_SERVER["MCP_PAGE_METADATA_RESPONSE"] = "mcp-page-metadata-response";
    HMR_MESSAGE_SENT_TO_SERVER["PING"] = "ping";
    return HMR_MESSAGE_SENT_TO_SERVER;
}({});

//# sourceMappingURL=hot-reloader-types.js.map