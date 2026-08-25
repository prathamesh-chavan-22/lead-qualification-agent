import { describe, expect, it } from "vitest";
import { evaluateQualification, inServiceArea, nextAsk } from "./qualify";

const readyBuyer = {
	name: "Sam",
	email: "sam@example.com",
	intent: "buy" as const,
	timelineMonths: 3,
	neighborhood: "East Austin",
	budgetUsd: 500_000,
};

describe("inServiceArea", () => {
	it("treats known Austin pockets as in-area", () => {
		expect(inServiceArea("Hyde Park")).toBe(true);
		expect(inServiceArea("south austin bungalow")).toBe(true);
	});

	it("treats named cities as out of area", () => {
		expect(inServiceArea("Houston")).toBe(false);
	});

	it("leaves unknown places undecided instead of rejecting", () => {
		expect(inServiceArea("West Lake Hills")).toBe(true);
		expect(inServiceArea("Manor")).toBe(null);
		expect(inServiceArea("Austin")).toBe(null);
	});
});

describe("evaluateQualification", () => {
	it("qualifies a complete in-area buyer", () => {
		expect(evaluateQualification(readyBuyer).status).toBe("qualified");
	});

	it("does not require financing to qualify", () => {
		expect(evaluateQualification({ ...readyBuyer, financing: undefined }).status).toBe(
			"qualified",
		);
	});

	it("asks to confirm unknown Austin-adjacent areas", () => {
		const result = evaluateQualification({
			...readyBuyer,
			neighborhood: "Manor",
		});
		expect(result.status).toBe("needs_info");
		expect(result.missing).toContain("confirm Austin metro");
	});

	it("accepts an unknown area after metro confirmation", () => {
		const result = evaluateQualification({
			...readyBuyer,
			neighborhood: "Manor",
			inMetro: true,
		});
		expect(result.status).toBe("qualified");
	});

	it("flags rentals and out-of-area cities", () => {
		expect(evaluateQualification({ ...readyBuyer, intent: "rent" }).status).toBe(
			"unqualified",
		);
		expect(
			evaluateQualification({ ...readyBuyer, neighborhood: "Dallas" }).status,
		).toBe("unqualified");
	});
});

describe("nextAsk", () => {
	it("asks one thing at a time", () => {
		expect(nextAsk({})).toMatch(/buy or sell/i);
		expect(nextAsk({ intent: "buy" })).toMatch(/neighborhood/i);
	});

	it("asks to confirm metro before timeline when the area is unknown", () => {
		expect(nextAsk({ intent: "buy", neighborhood: "Manor" })).toMatch(/Austin metro/i);
	});

	it("asks financing after budget, without blocking later fields", () => {
		expect(
			nextAsk({
				intent: "buy",
				neighborhood: "Mueller",
				timelineMonths: 2,
				budgetUsd: 400_000,
			}),
		).toMatch(/financing/i);
	});
});
