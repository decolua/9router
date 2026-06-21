import { describe, expect, it } from "vitest";
import { PARITY_MANIFEST } from "./parity-manifest.js";
import { REQUEST_ASSERTED_IDS } from "./request-parity.test.js";
import { RESPONSE_ASSERTED_IDS } from "./response-parity.test.js";

const assertedIds = new Set([
	...REQUEST_ASSERTED_IDS,
	...RESPONSE_ASSERTED_IDS,
]);
const ids = PARITY_MANIFEST.map((entry) => entry.id);

function formatEntries(entries) {
	return entries
		.map(
			(entry) =>
				`${entry.id} [${entry.leg}/${entry.direction}]: ${entry.reason || "no reason"}`,
		)
		.join("\n");
}

describe("PA-01 parity manifest coverage gate", () => {
	it("keeps manifest ids unique and status values explicit", () => {
		expect(new Set(ids).size, "duplicate parity manifest ids").toBe(ids.length);
		expect(
			PARITY_MANIFEST.every((entry) =>
				["translated", "documented-loss", "unknown"].includes(entry.status),
			),
		).toBe(true);
	});

	it("requires every translated field to be covered by a passing request/response assertion id", () => {
		const uncovered = PARITY_MANIFEST.filter(
			(entry) => entry.status === "translated" && !assertedIds.has(entry.id),
		);

		expect(
			uncovered,
			`Translated manifest entries without assertions:\n${formatEntries(uncovered)}`,
		).toEqual([]);
	});

	it("requires every documented loss to carry evidence and blocks unresolved parity policy fields", () => {
		const documentedLossesMissingEvidence = PARITY_MANIFEST.filter(
			(entry) =>
				entry.status === "documented-loss" &&
				!(
					entry.reason &&
					/PA-01 planner|\.js|no-.*equivalent/i.test(entry.reason)
				),
		);
		const unresolvedPolicyFields = PARITY_MANIFEST.filter(
			(entry) => entry.status === "unknown",
		);

		expect(
			documentedLossesMissingEvidence,
			`Documented losses missing evidence citations:\n${formatEntries(documentedLossesMissingEvidence)}`,
		).toEqual([]);
		expect(
			unresolvedPolicyFields,
			`Unresolved PA-01 parity policy fields; decide translator support vs documented-loss before closing gate:\n${formatEntries(unresolvedPolicyFields)}`,
		).toEqual([]);
	});
});
