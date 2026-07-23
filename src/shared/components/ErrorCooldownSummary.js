"use client";

import PropTypes from "prop-types";
import { useRuntimeTranslation } from "@/i18n/useRuntimeTranslation";

export default function ErrorCooldownSummary({ connection }) {
  const { locale, t } = useRuntimeTranslation();
  if (!connection.lastCooldownUntil) return null;
  const timezone = connection.errorCooldownPolicy?.timezone || "UTC";
  const until = new Intl.DateTimeFormat(locale, {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(connection.lastCooldownUntil));
  const trigger = [connection.errorCode, connection.upstreamErrorCode]
    .filter((value) => value !== null && value !== undefined && value !== "")
    .join("/");
  const source = connection.lastCooldownSource === "default"
    ? t("Default")
    : connection.lastCooldownSource === "upstream" ? t("Provider") : t("Error cooldown");
  const rule = connection.lastCooldownRule || source;
  const text = `${rule}${trigger ? ` · ${trigger}` : ""} · ${until}`;
  return <span className="max-w-full truncate text-xs text-orange-500" title={text}>{text}</span>;
}

ErrorCooldownSummary.propTypes = {
  connection: PropTypes.shape({
    errorCode: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    upstreamErrorCode: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    lastCooldownRule: PropTypes.string,
    lastCooldownSource: PropTypes.string,
    lastCooldownUntil: PropTypes.string,
    errorCooldownPolicy: PropTypes.shape({ timezone: PropTypes.string }),
  }).isRequired,
};
