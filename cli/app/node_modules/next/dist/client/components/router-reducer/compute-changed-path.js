"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    computeChangedPath: null,
    extractPathFromFlightRouterState: null,
    extractSourcePageFromFlightRouterState: null,
    getSelectedParams: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    computeChangedPath: function() {
        return computeChangedPath;
    },
    extractPathFromFlightRouterState: function() {
        return extractPathFromFlightRouterState;
    },
    extractSourcePageFromFlightRouterState: function() {
        return extractSourcePageFromFlightRouterState;
    },
    getSelectedParams: function() {
        return getSelectedParams;
    }
});
const _interceptionroutes = require("../../../shared/lib/router/utils/interception-routes");
const _segment = require("../../../shared/lib/segment");
const _matchsegments = require("../match-segments");
const removeLeadingSlash = (segment)=>{
    return segment[0] === '/' ? segment.slice(1) : segment;
};
const segmentToPathname = (segment)=>{
    if (typeof segment === 'string') {
        // 'children' is not a valid path -- it's technically a parallel route that corresponds with the current segment's page
        // if we don't skip it, then the computed pathname might be something like `/children` which doesn't make sense.
        if (segment === 'children') return '';
        return segment;
    }
    return segment[1];
};
const segmentToSourcePagePathname = (segment)=>{
    if (typeof segment === 'string') {
        if (segment === 'children') return '';
        if (segment.startsWith(_segment.PAGE_SEGMENT_KEY)) return 'page';
        return segment;
    }
    const [paramName, , dynamicParamType] = segment;
    switch(dynamicParamType){
        case 'c':
            return `[...${paramName}]`;
        case 'ci(..)(..)':
            return `(..)(..)[...${paramName}]`;
        case 'ci(.)':
            return `(.)[...${paramName}]`;
        case 'ci(..)':
            return `(..)[...${paramName}]`;
        case 'ci(...)':
            return `(...)[...${paramName}]`;
        case 'oc':
            return `[[...${paramName}]]`;
        case 'd':
            return `[${paramName}]`;
        case 'di(..)(..)':
            return `(..)(..)[${paramName}]`;
        case 'di(.)':
            return `(.)[${paramName}]`;
        case 'di(..)':
            return `(..)[${paramName}]`;
        case 'di(...)':
            return `(...)[${paramName}]`;
        default:
            dynamicParamType;
            return `[${paramName}]`;
    }
};
function normalizeSegments(segments) {
    return segments.reduce((acc, segment)=>{
        segment = removeLeadingSlash(segment);
        if (segment === '' || (0, _segment.isGroupSegment)(segment)) {
            return acc;
        }
        return `${acc}/${segment}`;
    }, '') || '/';
}
function extractPathFromFlightRouterState(flightRouterState) {
    const segment = Array.isArray(flightRouterState[0]) ? flightRouterState[0][1] : flightRouterState[0];
    if (segment === _segment.DEFAULT_SEGMENT_KEY || _interceptionroutes.INTERCEPTION_ROUTE_MARKERS.some((m)=>segment.startsWith(m))) return undefined;
    if (segment.startsWith(_segment.PAGE_SEGMENT_KEY)) return '';
    const segments = [
        segmentToPathname(segment)
    ];
    const parallelRoutes = flightRouterState[1] ?? {};
    const childrenPath = parallelRoutes.children ? extractPathFromFlightRouterState(parallelRoutes.children) : undefined;
    if (childrenPath !== undefined) {
        segments.push(childrenPath);
    } else {
        for (const [key, value] of Object.entries(parallelRoutes)){
            if (key === 'children') continue;
            const childPath = extractPathFromFlightRouterState(value);
            if (childPath !== undefined) {
                segments.push(childPath);
            }
        }
    }
    return normalizeSegments(segments);
}
function extractSourcePageSegmentsFromFlightRouterState(flightRouterState) {
    const segment = segmentToSourcePagePathname(flightRouterState[0]);
    if (segment === _segment.DEFAULT_SEGMENT_KEY) {
        return undefined;
    }
    if (segment === 'page') {
        return [
            segment
        ];
    }
    const parallelRoutes = flightRouterState[1] ?? {};
    const childrenPath = parallelRoutes.children ? extractSourcePageSegmentsFromFlightRouterState(parallelRoutes.children) : undefined;
    if (childrenPath !== undefined) {
        return segment === '' ? childrenPath : [
            removeLeadingSlash(segment),
            ...childrenPath
        ];
    }
    for (const [key, value] of Object.entries(parallelRoutes)){
        if (key === 'children') continue;
        const childPath = extractSourcePageSegmentsFromFlightRouterState(value);
        if (childPath !== undefined) {
            return segment === '' ? childPath : [
                removeLeadingSlash(segment),
                ...childPath
            ];
        }
    }
    return undefined;
}
function extractSourcePageFromFlightRouterState(flightRouterState) {
    const sourcePageSegments = extractSourcePageSegmentsFromFlightRouterState(flightRouterState);
    return sourcePageSegments ? `/${sourcePageSegments.join('/')}` : undefined;
}
function computeChangedPathImpl(treeA, treeB) {
    const [segmentA, parallelRoutesA] = treeA;
    const [segmentB, parallelRoutesB] = treeB;
    const normalizedSegmentA = segmentToPathname(segmentA);
    const normalizedSegmentB = segmentToPathname(segmentB);
    if (_interceptionroutes.INTERCEPTION_ROUTE_MARKERS.some((m)=>normalizedSegmentA.startsWith(m) || normalizedSegmentB.startsWith(m))) {
        return '';
    }
    if (!(0, _matchsegments.matchSegment)(segmentA, segmentB)) {
        // once we find where the tree changed, we compute the rest of the path by traversing the tree
        return extractPathFromFlightRouterState(treeB) ?? '';
    }
    for(const parallelRouterKey in parallelRoutesA){
        if (parallelRoutesB[parallelRouterKey]) {
            const changedPath = computeChangedPathImpl(parallelRoutesA[parallelRouterKey], parallelRoutesB[parallelRouterKey]);
            if (changedPath !== null) {
                return `${segmentToPathname(segmentB)}/${changedPath}`;
            }
        }
    }
    return null;
}
function computeChangedPath(treeA, treeB) {
    const changedPath = computeChangedPathImpl(treeA, treeB);
    if (changedPath == null || changedPath === '/') {
        return changedPath;
    }
    // lightweight normalization to remove route groups
    return normalizeSegments(changedPath.split('/'));
}
function getSelectedParams(currentTree, params = {}) {
    const parallelRoutes = currentTree[1];
    for (const parallelRoute of Object.values(parallelRoutes)){
        const segment = parallelRoute[0];
        const isDynamicParameter = Array.isArray(segment);
        const segmentValue = isDynamicParameter ? segment[1] : segment;
        if (!segmentValue || segmentValue.startsWith(_segment.PAGE_SEGMENT_KEY)) continue;
        // Ensure catchAll and optional catchall are turned into an array
        const isCatchAll = isDynamicParameter && (segment[2] === 'c' || segment[2] === 'oc');
        if (isCatchAll) {
            params[segment[0]] = segment[1].split('/');
        } else if (isDynamicParameter) {
            params[segment[0]] = segment[1];
        }
        params = getSelectedParams(parallelRoute, params);
    }
    return params;
}

if ((typeof exports.default === 'function' || (typeof exports.default === 'object' && exports.default !== null)) && typeof exports.default.__esModule === 'undefined') {
  Object.defineProperty(exports.default, '__esModule', { value: true });
  Object.assign(exports.default, exports);
  module.exports = exports.default;
}

//# sourceMappingURL=compute-changed-path.js.map