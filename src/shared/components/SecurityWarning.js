"use client";

import InlineAlert from "./InlineAlert";

/** @deprecated Prefer InlineAlert — kept for existing imports. */
export default function SecurityWarning({ message, action }) {
  return <InlineAlert variant="warning" message={message} action={action} />;
}
