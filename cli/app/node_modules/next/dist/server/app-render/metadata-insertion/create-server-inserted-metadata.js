/**
 * For chromium based browsers (Chrome, Edge, etc.) and Safari,
 * icons need to stay under <head> to be picked up by the browser.
 *
 */ "use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "createServerInsertedMetadata", {
    enumerable: true,
    get: function() {
        return createServerInsertedMetadata;
    }
});
const REINSERT_ICON_SCRIPT = `\
document.querySelectorAll('body link[rel="icon"], body link[rel="apple-touch-icon"]').forEach(el => document.head.appendChild(el))`;
function createServerInsertedMetadata(nonce) {
    let inserted = false;
    return async function getServerInsertedMetadata() {
        if (inserted) {
            return '';
        }
        inserted = true;
        return `<script ${nonce ? `nonce="${nonce}"` : ''}>${REINSERT_ICON_SCRIPT}</script>`;
    };
}

//# sourceMappingURL=create-server-inserted-metadata.js.map