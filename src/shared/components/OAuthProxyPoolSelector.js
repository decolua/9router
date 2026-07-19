import PropTypes from "prop-types";

export default function OAuthProxyPoolSelector({
  value,
  onChange,
  proxyPools = [],
  proxyPoolsReady = true,
  visible = true,
}) {
  return (
    <>
      {visible && proxyPools.length > 0 && (
        <div className="flex flex-col gap-1.5 p-3 border border-border rounded-lg bg-sidebar/30">
          <label className="text-xs font-medium text-text-muted uppercase tracking-wider">
            Routing Proxy Pool
          </label>
          <select
            value={value}
            onChange={onChange}
            className="w-full bg-input text-sm border border-border rounded-lg px-3 py-2 outline-none focus:border-primary"
          >
            <option value="">Direct Connection</option>
            {proxyPools.map((pool) => (
              <option key={pool.id} value={pool.id}>
                {pool.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {!proxyPoolsReady && (
        <div className="flex items-center gap-2 px-3 py-2 border border-border rounded-lg bg-sidebar/50">
          <span className="material-symbols-outlined text-base text-primary animate-spin">
            progress_activity
          </span>
          <span className="text-sm">Loading proxy pools...</span>
        </div>
      )}
    </>
  );
}

OAuthProxyPoolSelector.propTypes = {
  value: PropTypes.string.isRequired,
  onChange: PropTypes.func.isRequired,
  proxyPools: PropTypes.arrayOf(PropTypes.shape({
    id: PropTypes.string.isRequired,
    name: PropTypes.string.isRequired,
  })),
  proxyPoolsReady: PropTypes.bool,
  visible: PropTypes.bool,
};
