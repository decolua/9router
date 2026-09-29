"use client";

import { useState, useEffect } from "react";
import PropTypes from "prop-types";
import Badge from "./Badge";
import { formatOnHoldRemaining } from "@/shared/utils/connectionStatus";

// "on hold" badge with live countdown. `until` is the earliest active model-lock
// ISO timestamp, or null when no lock is active (key failed but its cooldown
// expired and it hasn't been retried yet — still "on hold", just no known wait).
export default function OnHoldBadge({ until }) {
  const [remaining, setRemaining] = useState(null);

  useEffect(() => {
    // Single updater (never a bare setState in the effect body) so the tick is
    // one code path for "no lock" and "lock expiring".
    const update = () => {
      setRemaining(until ? formatOnHoldRemaining(new Date(until).getTime() - Date.now()) : null);
    };
    update();
    if (!until) return;
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [until]);

  return (
    <Badge variant="warning" size="sm" dot>
      {remaining ? `on hold · ${remaining}` : "on hold"}
    </Badge>
  );
}

OnHoldBadge.propTypes = {
  until: PropTypes.string,
};
