/**
 * Cursor IDE usage handler
 *
 * Dashboard usage lives behind Connect RPC (api2.cursor.sh), not a plain REST
 * endpoint — same Bearer token as chat, body is a literal empty proto "{}".
 *
 * Only the individual/Pro percent-of-limit path is implemented.
 * Skipped: team/enterprise pooled-dollar display (the ratio math is the same,
 * we just always render it as a %), the request-based legacy fallback
 * (cursor.com/api/usage + api/usage-summary, cookie-auth), credit
 * grants/Stripe balance, and the usage-events CSV spend history. Add those if
 * reports show individual-Pro accounts aren't covered by this.
 */
import { proxyAwareFetch } from "../../utils/proxyFetch.js";
import { U, parseResetTime } from "./shared.js";

const CURSOR_CONFIG = {
	usageUrl: U("cursor").usageUrl,
	planUrl: U("cursor").planUrl,
};

function connectHeaders(accessToken) {
	return {
		Authorization: `Bearer ${accessToken}`,
		"Content-Type": "application/json",
		"Connect-Protocol-Version": "1",
	};
}

async function connectPost(url, accessToken, proxyOptions) {
	return proxyAwareFetch(
		url,
		{
			method: "POST",
			headers: connectHeaders(accessToken),
			body: "{}",
		},
		proxyOptions,
	);
}

function percentQuota(usedPercent, resetAt) {
	const used = Math.max(0, Math.min(100, usedPercent));
	return {
		used,
		total: 100,
		remaining: Math.max(0, 100 - used),
		resetAt,
		unlimited: false,
	};
}

// Best-effort plan label from GetPlanInfo — never fails the whole fetch.
async function fetchPlanName(accessToken, proxyOptions) {
	try {
		const response = await connectPost(
			CURSOR_CONFIG.planUrl,
			accessToken,
			proxyOptions,
		);
		if (!response.ok) return null;
		const body = await response.json();
		const name = body?.planInfo?.planName;
		return typeof name === "string" && name.trim() ? name.trim() : null;
	} catch {
		return null;
	}
}

export async function getCursorUsage(accessToken, proxyOptions = null) {
	if (!accessToken) {
		return {
			message:
				"No Cursor access token available. Re-import your Cursor session.",
		};
	}

	let response;
	try {
		response = await connectPost(
			CURSOR_CONFIG.usageUrl,
			accessToken,
			proxyOptions,
		);
	} catch (error) {
		return {
			message: `Cursor connected. Unable to fetch usage: ${error.message}`,
		};
	}

	if (!response.ok) {
		return {
			message: `Cursor connected. Usage API temporarily unavailable (${response.status}).`,
		};
	}

	let usage;
	try {
		usage = await response.json();
	} catch {
		return {
			message: "Cursor connected. Usage API returned an invalid response.",
		};
	}

	const planUsage = usage?.planUsage;
	if (usage?.enabled === false || !planUsage) {
		return { message: "No active Cursor subscription." };
	}

	const limit = Number(planUsage.limit);
	const hasLimit = Number.isFinite(limit);
	const totalPercentUsed = Number(planUsage.totalPercentUsed);
	const hasTotalPercent = Number.isFinite(totalPercentUsed);
	if (!hasLimit && !hasTotalPercent) {
		return {
			message: "Cursor connected. Usage totals unavailable for this account.",
		};
	}

	const resetAt = parseResetTime(usage.billingCycleEnd);
	const quotas = {};

	const totalSpend = Number(planUsage.totalSpend);
	const remaining = Number(planUsage.remaining);
	let usedAmount = 0;
	if (Number.isFinite(totalSpend)) usedAmount = totalSpend;
	else if (hasLimit && Number.isFinite(remaining))
		usedAmount = limit - remaining;
	const computedPercent =
		hasLimit && limit > 0 ? (usedAmount / limit) * 100 : 0;
	quotas["Total usage"] = percentQuota(
		hasTotalPercent ? totalPercentUsed : computedPercent,
		resetAt,
	);

	const autoPercentUsed = Number(planUsage.autoPercentUsed);
	if (Number.isFinite(autoPercentUsed))
		quotas["Auto usage"] = percentQuota(autoPercentUsed, resetAt);

	const apiPercentUsed = Number(planUsage.apiPercentUsed);
	if (Number.isFinite(apiPercentUsed))
		quotas["API usage"] = percentQuota(apiPercentUsed, resetAt);

	const plan = await fetchPlanName(accessToken, proxyOptions);
	return { plan: plan || "Cursor", quotas };
}
