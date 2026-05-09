"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    isHtmlBotRequest: null,
    shouldServeStreamingMetadata: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    isHtmlBotRequest: function() {
        return isHtmlBotRequest;
    },
    shouldServeStreamingMetadata: function() {
        return shouldServeStreamingMetadata;
    }
});
const _isbot = require("../../shared/lib/router/utils/is-bot");
function shouldServeStreamingMetadata(userAgent, htmlLimitedBots) {
    const blockingMetadataUARegex = new RegExp(htmlLimitedBots || _isbot.HTML_LIMITED_BOT_UA_RE_STRING, 'i');
    // Only block metadata for HTML-limited bots
    if (userAgent && blockingMetadataUARegex.test(userAgent)) {
        return false;
    }
    return true;
}
function isHtmlBotRequest(req) {
    const ua = req.headers['user-agent'] || '';
    const botType = (0, _isbot.getBotType)(ua);
    return botType === 'html';
}

//# sourceMappingURL=streaming-metadata.js.map