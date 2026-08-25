import type { LeadProfile } from "../shared/types";

export const SERVICE_NEIGHBORHOODS = [
	"east austin",
	"hyde park",
	"mueller",
	"south congress",
	"soco",
	"round rock",
	"pflugerville",
	"downtown",
	"travis heights",
	"crestview",
	"north loop",
	"zilker",
	"barton hills",
	"tarrytown",
	"clarksville",
	"allandale",
	"brentwood",
	"the domain",
	"domain",
	"cedar park",
	"south lamar",
	"bouldin",
	"austin",
] as const;

const OUT_OF_AREA = [
	"houston",
	"dallas",
	"san antonio",
	"fort worth",
	"el paso",
	"new york",
	"los angeles",
	"miami",
	"chicago",
];

export const MIN_BUYER_BUDGET_USD = 250_000;
export const MAX_BUYER_TIMELINE_MONTHS = 6;
export const MAX_SELLER_TIMELINE_MONTHS = 12;

export type QualificationResult = {
	status: "qualified" | "needs_info" | "unqualified";
	missing: string[];
	reason?: string;
};

function normalize(value: string | undefined): string {
	return (value ?? "").trim().toLowerCase();
}

export function inServiceArea(neighborhood: string | undefined): boolean | null {
	const n = normalize(neighborhood);
	if (!n) return null;
	if (OUT_OF_AREA.some((city) => n.includes(city))) return false;
	return SERVICE_NEIGHBORHOODS.some((area) => n.includes(area));
}

export function evaluateQualification(profile: LeadProfile): QualificationResult {
	const missing: string[] = [];

	if (profile.refusedContact) {
		return {
			status: "unqualified",
			missing: [],
			reason: "Declined to share a name and a way to reach them.",
		};
	}

	if (!profile.intent) missing.push("intent (buy or sell)");
	if (profile.timelineMonths === undefined) missing.push("timeline in months");
	if (!profile.neighborhood) missing.push("neighborhood / area");
	if (!profile.name) missing.push("name");
	if (!profile.email && !profile.phone) missing.push("email or phone");

	if (profile.intent === "buy" && profile.budgetUsd === undefined) {
		missing.push("budget");
	}
	if (profile.intent === "sell" && profile.ownsProperty === undefined) {
		missing.push("whether they own the property");
	}

	if (profile.intent === "rent") {
		return {
			status: "unqualified",
			missing: [],
			reason: "Northside Realty does not handle rentals.",
		};
	}

	if (profile.intent === "other") {
		return {
			status: "unqualified",
			missing: [],
			reason: "Inquiry is outside residential buy/sell work.",
		};
	}

	const area = inServiceArea(profile.neighborhood);
	if (area === false) {
		return {
			status: "unqualified",
			missing: [],
			reason: "Location is outside the Austin metro service area.",
		};
	}

	if (profile.intent === "buy" && profile.budgetUsd !== undefined && profile.budgetUsd < MIN_BUYER_BUDGET_USD) {
		return {
			status: "unqualified",
			missing: [],
			reason: `Buyer budget is below the $${MIN_BUYER_BUDGET_USD.toLocaleString()} floor.`,
		};
	}

	if (
		profile.intent === "buy" &&
		profile.timelineMonths !== undefined &&
		profile.timelineMonths > MAX_BUYER_TIMELINE_MONTHS
	) {
		return {
			status: "unqualified",
			missing: [],
			reason: "Buyer timeline is beyond 6 months.",
		};
	}

	if (
		profile.intent === "sell" &&
		profile.timelineMonths !== undefined &&
		profile.timelineMonths > MAX_SELLER_TIMELINE_MONTHS
	) {
		return {
			status: "unqualified",
			missing: [],
			reason: "Seller timeline is beyond 12 months.",
		};
	}

	if (profile.intent === "sell" && profile.ownsProperty === false) {
		return {
			status: "unqualified",
			missing: [],
			reason: "Seller does not own the property.",
		};
	}

	if (missing.length > 0) {
		return { status: "needs_info", missing };
	}

	return { status: "qualified", missing: [] };
}
