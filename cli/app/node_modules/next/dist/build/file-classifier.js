"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    addSlotIfNew: null,
    combineSlots: null,
    extractSlotFromPath: null,
    extractSlotsFromRoutes: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    addSlotIfNew: function() {
        return addSlotIfNew;
    },
    combineSlots: function() {
        return combineSlots;
    },
    extractSlotFromPath: function() {
        return extractSlotFromPath;
    },
    extractSlotsFromRoutes: function() {
        return extractSlotsFromRoutes;
    }
});
const _apppaths = require("../shared/lib/router/utils/app-paths");
const _segment = require("../shared/lib/segment");
function extractSlotFromPath(pagePath) {
    const segments = pagePath.split('/');
    for(let i = segments.length - 1; i >= 0; i--){
        const segment = segments[i];
        if ((0, _segment.isParallelRouteSegment)(segment)) {
            return {
                name: segment.slice(1),
                parent: (0, _apppaths.normalizeAppPath)(segments.slice(0, i).join('/'))
            };
        }
    }
    return undefined;
}
function addSlotIfNew(slots, pagePath) {
    const slot = extractSlotFromPath(pagePath);
    if (!slot) return false;
    if (slots.some((s)=>s.name === slot.name && s.parent === slot.parent)) return false;
    slots.push(slot);
    return true;
}
function extractSlotsFromRoutes(routes, skipRoutes) {
    const slots = [];
    for (const [route] of Object.entries(routes)){
        if (skipRoutes == null ? void 0 : skipRoutes.has(route)) continue;
        addSlotIfNew(slots, route);
    }
    return slots;
}
function combineSlots(...slotArrays) {
    const slotSet = new Set();
    const result = [];
    for (const slots of slotArrays){
        for (const slot of slots){
            const key = `${slot.name}:${slot.parent}`;
            if (!slotSet.has(key)) {
                slotSet.add(key);
                result.push(slot);
            }
        }
    }
    return result;
}

//# sourceMappingURL=file-classifier.js.map