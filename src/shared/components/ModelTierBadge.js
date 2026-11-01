import PropTypes from "prop-types";
import { isOpencodeFreeModel } from "@/shared/utils/modelTier";

export default function ModelTierBadge({ model, providerId, isFree, className = "" }) {
  if (!isOpencodeFreeModel(model, providerId, isFree)) {
    return null;
  }

  return (
    <span
      title="Free Model (Free Tier)"
      className={`shrink-0 inline-flex items-center gap-1 text-xs font-bold tracking-wider text-success bg-emerald-500/10 border border-emerald-500/25 px-1.5 py-0.5 rounded leading-none align-middle ${className}`}
    >
      <span className="material-symbols-outlined text-[10px] leading-none select-none">sell</span>
      FREE
    </span>
  );
}

ModelTierBadge.propTypes = {
  model: PropTypes.oneOfType([PropTypes.string, PropTypes.object]),
  providerId: PropTypes.string,
  isFree: PropTypes.bool,
  className: PropTypes.string,
};
