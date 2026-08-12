"use client";

import { useSyncExternalStore } from "react";
import usePrivacyStore from "@/store/privacyStore";

// Applied to any element rendering an account email. The transition is always
// present so the blur eases in *and* out; only the blur itself is state-driven.
const BLUR_TRANSITION = "transition-[filter] duration-500 ease-[cubic-bezier(.4,0,.2,1)] motion-reduce:transition-none";
const BLUR_ON = "blur-[4px] select-none";

function getSnapshot() {
  return usePrivacyStore.getState().blurEmails;
}

// The persisted value only exists client-side — render unblurred on the server
// and on the hydrating pass so both agree, then settle on the stored value.
function getServerSnapshot() {
  return false;
}

export function useBlurEmails() {
  const toggleBlurEmails = usePrivacyStore((s) => s.toggleBlurEmails);

  const isBlurred = useSyncExternalStore(
    usePrivacyStore.subscribe,
    getSnapshot,
    getServerSnapshot
  );

  return {
    isBlurred,
    toggleBlurEmails,
    // Spread onto the className of an email element
    blurClass: `${BLUR_TRANSITION} ${isBlurred ? BLUR_ON : ""}`,
  };
}

export default useBlurEmails;
