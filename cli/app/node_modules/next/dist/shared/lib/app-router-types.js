/**
 * App Router types - Client-safe types for the Next.js App Router
 *
 * This file contains type definitions that can be safely imported
 * by both client-side and server-side code without circular dependencies.
 */ "use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "PrefetchHint", {
    enumerable: true,
    get: function() {
        return PrefetchHint;
    }
});
var PrefetchHint = /*#__PURE__*/ function(PrefetchHint) {
    // This segment has a runtime prefetch enabled (via unstable_instant with
    // prefetch: 'runtime'). Per-segment only, does not propagate to ancestors.
    PrefetchHint[PrefetchHint["HasRuntimePrefetch"] = 1] = "HasRuntimePrefetch";
    // This segment or one of its descendants has an instant config defined
    // (any truthy unstable_instant, regardless of prefetch mode). Propagates
    // upward so the root segment reflects the entire subtree.
    PrefetchHint[PrefetchHint["SubtreeHasInstant"] = 2] = "SubtreeHasInstant";
    // This segment itself has a loading.tsx boundary.
    PrefetchHint[PrefetchHint["SegmentHasLoadingBoundary"] = 4] = "SegmentHasLoadingBoundary";
    // A descendant segment (but not this one) has a loading.tsx boundary.
    // Propagates upward so the root reflects the entire subtree.
    PrefetchHint[PrefetchHint["SubtreeHasLoadingBoundary"] = 8] = "SubtreeHasLoadingBoundary";
    // This segment is the root layout of the application.
    PrefetchHint[PrefetchHint["IsRootLayout"] = 16] = "IsRootLayout";
    // This segment's response includes its parent's data inlined into it.
    // Set at build time by the segment size measurement pass.
    PrefetchHint[PrefetchHint["ParentInlinedIntoSelf"] = 32] = "ParentInlinedIntoSelf";
    // This segment's data is inlined into one of its children — don't fetch
    // it separately. Set at build time by the segment size measurement pass.
    PrefetchHint[PrefetchHint["InlinedIntoChild"] = 64] = "InlinedIntoChild";
    // On a __PAGE__: this page's response includes the head (metadata/viewport)
    // at the end of its SegmentPrefetch[] array.
    PrefetchHint[PrefetchHint["HeadInlinedIntoSelf"] = 128] = "HeadInlinedIntoSelf";
    // On the root hint node: the head was NOT inlined into any page — fetch
    // it separately. Absence of this bit means the head is bundled into a page.
    PrefetchHint[PrefetchHint["HeadOutlined"] = 256] = "HeadOutlined";
    return PrefetchHint;
}({});

//# sourceMappingURL=app-router-types.js.map