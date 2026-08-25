import { describe, expect, it } from "vitest";
import { groundedPatch, ownershipFromEvidence, scrubInferredFields } from "./ground";
import { stripToolLeakage } from "../shared/sanitize";

describe("ownershipFromEvidence", () => {
	it("does not infer no from silence", () => {
		expect(
			ownershipFromEvidence({
				allUser: "Hi Maya — I'm Sam, looking to buy around East Austin.",
				latestUser: "Hi Maya — I'm Sam, looking to buy around East Austin.",
				lastAsk: "",
			}),
		).toBeUndefined();
	});

	it("records an explicit yes to the ownership question", () => {
		expect(
			ownershipFromEvidence({
				allUser: "Yes",
				latestUser: "Yes",
				lastAsk: "Do you already own the home you'd be listing?",
			}),
		).toBe(true);
	});

	it("records an explicit no to the ownership question", () => {
		expect(
			ownershipFromEvidence({
				allUser: "No",
				latestUser: "No",
				lastAsk: "Do you already own the home you'd be listing?",
			}),
		).toBe(false);
	});
});

describe("groundedPatch", () => {
	it("drops guessed ownsProperty and financing", () => {
		const patch = groundedPatch(
			{
				intent: "buy",
				ownsProperty: false,
				financing: "unknown",
				budgetUsd: 500_000,
			},
			{
				allUser: "Hi Maya — I'm Sam, looking to buy around East Austin.",
				latestUser: "Hi Maya — I'm Sam, looking to buy around East Austin.",
				lastAsk: "",
			},
		);
		expect(patch.ownsProperty).toBeUndefined();
		expect(patch.financing).toBeUndefined();
		expect(patch.budgetUsd).toBeUndefined();
		expect(patch.intent).toBe("buy");
	});

	it("keeps budget when they stated a number", () => {
		const patch = groundedPatch(
			{ budgetUsd: 500_000 },
			{
				allUser: "Budget is about $500k",
				latestUser: "Budget is about $500k",
				lastAsk: "",
			},
		);
		expect(patch.budgetUsd).toBe(500_000);
	});
});

describe("scrubInferredFields", () => {
	it("clears a fabricated ownsProperty: false", () => {
		const next = scrubInferredFields(
			{ intent: "buy", ownsProperty: false, name: "Sam" },
			{
				allUser: "Hi Maya — I'm Sam, looking to buy around East Austin.",
				latestUser: "Hi Maya — I'm Sam, looking to buy around East Austin.",
				lastAsk: "",
			},
		);
		expect(next.name).toBe("Sam");
		expect(next.ownsProperty).toBeUndefined();
	});
});

describe("stripToolLeakage", () => {
	it("removes calendar placeholder copy", () => {
		const text = stripToolLeakage(
			"Here are times. Available slots: (placeholder – actual slots will be listed when queried)\n- Tue",
		);
		expect(text.toLowerCase()).not.toContain("placeholder");
		expect(text.toLowerCase()).not.toContain("when queried");
	});
});
