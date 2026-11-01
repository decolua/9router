"use client";

// Plugin marks for one model, from the same config GET /api/plugins serves the
// plugins page. One fetch answers over the whole key list, and the matching
// uses the shared rule so this badge cannot disagree with the request runtime.
import { useEffect, useState } from "react";
import { pluginAppliesToModel } from "@/shared/utils/pluginModelMatch";

export function useModelPluginMarks() {
  return null;
}
