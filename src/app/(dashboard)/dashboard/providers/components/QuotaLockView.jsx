"use client";

import React, { useState, useEffect } from "react";
import { Badge } from "@/shared/components";
import { deriveQuotaLockView } from "../quotaLockView";
import { getRelativeTime } from "@/shared/utils";

export default function QuotaLockView({ provider, exactModelId }) {
    const [now, setNow] = useState(Date.now());

    useEffect(() => {
        const interval = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(interval);
    }, []);

    const lockInfo = deriveQuotaLockView(provider, now, exactModelId);

    if (!lockInfo.isActive) return null;

    let tooltip = `Reason: ${lockInfo.reason}\nSource: ${lockInfo.source}`;
    if (lockInfo.classifiedAt) {
        tooltip += `\nClassified: ${new Date(lockInfo.classifiedAt).toLocaleString()}`;
    }

    const countdownText = getRelativeTime(lockInfo.expiry, now);

    return (
        <Badge
            variant="error"
            size="sm"
            title={tooltip}
            className="cursor-help"
        >
            <span data-testid="quota-lock-scope" className="font-semibold mr-1">
                {lockInfo.scope === 'account' ? 'Global Lock' : lockInfo.nearestModelId}
            </span>
            <span data-testid="quota-lock-countdown">
                expires {countdownText}
            </span>
            {lockInfo.additionalModelLocks > 0 && (
                <span className="ml-1 opacity-75">
                    (+{lockInfo.additionalModelLocks} more)
                </span>
            )}
            <span className="sr-only">
                Reason: <span data-testid="quota-lock-reason">{lockInfo.reason}</span>
                Source: <span data-testid="quota-lock-source">{lockInfo.source}</span>
            </span>
        </Badge>
    );
}
