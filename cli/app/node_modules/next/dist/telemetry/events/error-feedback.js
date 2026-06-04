"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    eventErrorFeedback: null,
    eventNameErrorFeedback: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    eventErrorFeedback: function() {
        return eventErrorFeedback;
    },
    eventNameErrorFeedback: function() {
        return eventNameErrorFeedback;
    }
});
const eventNameErrorFeedback = 'NEXT_ERROR_FEEDBACK';
function eventErrorFeedback(event) {
    return {
        eventName: eventNameErrorFeedback,
        payload: event
    };
}

//# sourceMappingURL=error-feedback.js.map