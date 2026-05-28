"use client";

import PropTypes from "prop-types";
import { Input, Select, Toggle } from "@/shared/components";
import {
  LIMIT_METRIC_OPTIONS,
  LIMIT_PERIOD_OPTIONS,
} from "../utils/endpointConstants";

export function ApiKeyLimitFormFields({ form, onChange, description }) {
  return (
    <div className="rounded-lg border border-border p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium">Usage limit</p>
          <p className="text-xs text-text-muted">{description}</p>
        </div>
        <Toggle
          checked={form.enabled}
          onChange={() =>
            onChange((prev) => ({ ...prev, enabled: !prev.enabled }))
          }
        />
      </div>

      {form.enabled && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Select
            label="Metric"
            value={form.metricType}
            onChange={(value) =>
              onChange((prev) => ({ ...prev, metricType: value }))
            }
            options={LIMIT_METRIC_OPTIONS}
          />
          <Select
            label="Period"
            value={form.periodType}
            onChange={(value) =>
              onChange((prev) => ({ ...prev, periodType: value }))
            }
            options={LIMIT_PERIOD_OPTIONS}
          />
          <Input
            label="Limit value"
            type="number"
            min="0"
            step="any"
            value={form.limitValue}
            onChange={(e) =>
              onChange((prev) => ({ ...prev, limitValue: e.target.value }))
            }
            placeholder="1000"
          />
        </div>
      )}
    </div>
  );
}

ApiKeyLimitFormFields.propTypes = {
  form: PropTypes.shape({
    enabled: PropTypes.bool.isRequired,
    metricType: PropTypes.string.isRequired,
    periodType: PropTypes.string.isRequired,
    limitValue: PropTypes.oneOfType([PropTypes.string, PropTypes.number])
      .isRequired,
  }).isRequired,
  onChange: PropTypes.func.isRequired,
  description: PropTypes.string.isRequired,
};
