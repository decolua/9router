"use client";

import { StatusAlert } from "../../endpoint/components/StatusAlert";

export function ProfileStatus({ status, className = "" }) {
  if (!status.message) return null;
  return <StatusAlert status={status} className={className} />;
}
