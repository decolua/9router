import { useState, useEffect } from "react";
import PropTypes from "prop-types";

export default function CooldownTimer({ until }) {
  const [remaining, setRemaining] = useState("");

  useEffect(() => {
    const updateRemaining = () => {
      const diff = new Date(until).getTime() - Date.now();
      if (diff <= 0) {
        setRemaining("");
        return;
      }
      const secs = Math.floor(diff / 1000);
      if (secs < 60) {
        setRemaining(`${secs}s`);
      } else if (secs < 3600) {
        setRemaining(`${Math.floor(secs / 60)}m ${secs % 60}s`);
      } else {
        const hrs = Math.floor(secs / 3600);
        const mins = Math.floor((secs % 3600) / 60);
        setRemaining(`${hrs}h ${mins}m`);
      }
    };

    updateRemaining();
    const interval = setInterval(updateRemaining, 1000);
    return () => clearInterval(interval);
  }, [until]);

  if (!remaining) return null;

  return (
    <span className="inline-flex items-center gap-1 text-xs text-orange-500 font-mono">
      <span className="material-symbols-outlined text-[13px] leading-none">event_upcoming</span>
      {remaining}
    </span>
  );
}

CooldownTimer.propTypes = {
  until: PropTypes.string.isRequired,
};
