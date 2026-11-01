"use client";

import { CAPACITY_META, PLUGIN_MARK_META, pluginMarksFor } from "@/shared/constants/models";
import Tooltip from "./Tooltip";
import PluginMark from "./PluginMark";

// Render the badges for a model: its capabilities, plus the marks of the custom
// plugins active on it.
//
// The two are separate on purpose. A plugin used to signal itself by setting a
// capability - Image Vision set caps.vision, which is identical to native vision -
// so enabling it drew nothing and the badge could not be told apart from a
// built-in. `marks` is the payload's explicit pluginMarks list, falling back to
// the caps flags for older payloads.
// Which native capabilities a plugin already speaks for. imageVision is the
// only overlap that is a pure alias: the plugin turns caps.vision on itself, so
// showing both would print the same fact twice. The other plugin keys used to be
// handled by dropping the PLUGIN MARK - which is how the old material ligature
// (`psychology`, `bolt`, `compress`) kept appearing on model rows. The mark is
// the explicit signal now and it always renders.
const PLUGIN_COVERED_CAPS = { imageVision: "vision" };

export default function CapacityBadges({ caps, marks, className = "", colorOverride, size = 16 }) {
  const active = caps ? Object.keys(CAPACITY_META).filter((k) => caps[k]) : [];
  if (active.length === 0) return null;

  const tone = colorOverride || "text-text-muted";

  return (
    <span className={`inline-flex items-center gap-0.5 ${className}`}>
      {active.map((k) => {
        const meta = CAPACITY_META[k];
        return (
          <Tooltip key={k} text={`${meta.label} - ${meta.desc}`}>
            <span
              className={`inline-flex items-center justify-center cursor-help ${tone}`}
              style={{ width: `${size}px`, height: `${size}px` }}
            >
              <PluginMark name={meta.mark} size={size} strokeWidth={1.9} />
            </span>
          </Tooltip>
        );
      })}
    </span>
  );
}