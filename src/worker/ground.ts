import type { Financing, LeadIntent, LeadProfile } from "../shared/types";

type ChatMessage = {
	role: string;
	parts?: Array<{ type: string; text?: string }>;
};

function lower(value: string): string {
	return value.toLowerCase();
}

function partsText(message: ChatMessage | undefined): string {
	if (!message) return "";
	return (message.parts ?? [])
		.filter((part) => part.type === "text" && part.text)
		.map((part) => part.text as string)
		.join("\n");
}

export type InquiryEvidence = {
	allUser: string;
	latestUser: string;
	lastAsk: string;
};

export function collectEvidence(
	messages: ChatMessage[],
	extra: string[] = [],
): InquiryEvidence {
	const users = messages.filter((message) => message.role === "user");
	const fromChat = users.map(partsText);
	const lastAsk = [...messages].reverse().find((message) => message.role === "assistant");
	return {
		allUser: [...fromChat, ...extra.filter(Boolean)].join("\n"),
		latestUser: fromChat.at(-1) ?? "",
		lastAsk: partsText(lastAsk),
	};
}

export function collectUserEvidence(messages: ChatMessage[], extra: string[] = []): string {
	const evidence = collectEvidence(messages, extra);
	return [evidence.allUser, evidence.lastAsk].join("\n");
}

function yesNo(text: string): boolean | undefined {
	const t = lower(text).trim();
	if (!t) return undefined;
	if (/^(yes|yeah|yep|y|correct|i do|we do|that's right)\b/.test(t)) return true;
	if (/^(no|nope|n|not yet|i don't|we don't|i do not)\b/.test(t)) return false;
	return undefined;
}

export function ownershipFromEvidence(evidence: InquiryEvidence | string): boolean | undefined {
	const pack = typeof evidence === "string" ? { allUser: evidence, latestUser: evidence, lastAsk: "" } : evidence;
	const text = lower(pack.allUser);
	const owns =
		/\b(i|we)\s+(do\s+)?own\b/.test(text) ||
		/\b(i'm|i am|we're|we are)\s+the owner\b/.test(text) ||
		/\blisting\s+(my|our)\b/.test(text) ||
		/\balready own\b/.test(text) ||
		/\byes[,.]?\s+(i|we)\s+own\b/.test(text);
	const notOwn =
		/\bdon'?t own\b/.test(text) ||
		/\bdo not own\b/.test(text) ||
		/\bnot the owner\b/.test(text) ||
		/\bno[,.]?\s+(i|we)\s+(don'?t|do not)\b/.test(text) ||
		/\bstill rent/.test(text) ||
		/\bi('m| am) renting\b/.test(text);
	if (owns && !notOwn) return true;
	if (notOwn && !owns) return false;
	if (/\bown|listing\b/.test(lower(pack.lastAsk))) {
		return yesNo(pack.latestUser);
	}
	return undefined;
}

function metroFromEvidence(evidence: InquiryEvidence): boolean | undefined {
	const text = lower(evidence.allUser);
	if (/\bnot (in )?(the )?austin( metro)?\b/.test(text) || /\boutside (the )?metro\b/.test(text)) {
		return false;
	}
	if (/\bin the austin metro\b/.test(text) || /\bit'?s in austin\b/.test(text)) return true;
	if (/\b(austin metro|in austin|round rock|pflugerville|cedar park)\b/.test(lower(evidence.lastAsk))) {
		return yesNo(evidence.latestUser);
	}
	return undefined;
}

function financingFromEvidence(evidence: InquiryEvidence): Financing | undefined {
	const text = lower(evidence.allUser);
	if (/\bcash\b/.test(text)) return "cash";
	if (/\bpre[-\s]?approv/.test(text)) return "preapproved";
	if (/\b(not sure|still figuring|don'?t know|no idea|unknown)\b/.test(text)) return "unknown";
	if (/\b(no (loan|financing|mortgage)|unqualified for (a )?loan)\b/.test(text)) return "none";
	return undefined;
}

function intentFromEvidence(evidence: InquiryEvidence): LeadIntent | undefined {
	const text = lower(evidence.allUser);
	if (/\brent(al|ing)?\b/.test(text) && !/\bbuy\b/.test(text) && !/\bsell\b/.test(text)) {
		return "rent";
	}
	if (/\blisting\b/.test(text) && !/\bbuy\b/.test(text)) return "sell";
	if (/\bsell(ing|er)?\b/.test(text) && !/\bbuy\b/.test(text)) return "sell";
	if (/\bbuy(ing|er)?\b/.test(text) || /\bpurchase\b/.test(text)) return "buy";
	return undefined;
}

function hasContactRefusal(evidence: InquiryEvidence): boolean {
	const text = lower(evidence.allUser);
	return (
		/\b(won'?t|will not|not going to|refuse|rather not)\b/.test(text) &&
		/\b(email|phone|number|contact|name)\b/.test(text)
	);
}

function mentionedNumber(evidence: string, value: number): boolean {
	const compact = evidence.replace(/,/g, "");
	if (compact.includes(String(value))) return true;
	if (value >= 1000 && compact.toLowerCase().includes(`${Math.round(value / 1000)}k`)) return true;
	return false;
}

function hasTimelineLanguage(evidence: string): boolean {
	return /\b(\d+\s*(month|mo|week)s?|asap|this month|right away|immediately)\b/i.test(evidence);
}

function hasBudgetLanguage(evidence: string): boolean {
	return /\$|\b\d+(\.\d+)?\s*k\b|\b(thousand|budget|price range|up to)\b/i.test(evidence);
}

function mentioned(evidence: string, value: string): boolean {
	const needle = value.trim().toLowerCase();
	if (needle.length < 2) return false;
	return lower(evidence).includes(needle);
}

function phoneInEvidence(evidence: string, phone: string): boolean {
	const digits = phone.replace(/\D/g, "");
	if (digits.length < 7) return mentioned(evidence, phone);
	return evidence.replace(/\D/g, "").includes(digits);
}

export function groundedPatch(patch: LeadProfile, evidence: InquiryEvidence | string): LeadProfile {
	const pack =
		typeof evidence === "string"
			? { allUser: evidence, latestUser: evidence, lastAsk: "" }
			: evidence;
	const next: LeadProfile = {};
	const owns = ownershipFromEvidence(pack);
	const metro = metroFromEvidence(pack);
	const financing = financingFromEvidence(pack);
	const intent = intentFromEvidence(pack);
	const hay = pack.allUser;

	if (patch.name && mentioned(hay, patch.name)) next.name = patch.name;
	if (patch.email && mentioned(hay, patch.email)) next.email = patch.email;
	if (patch.phone && phoneInEvidence(hay, patch.phone)) next.phone = patch.phone;

	if (patch.intent && intent === patch.intent) next.intent = patch.intent;
	else if (intent && patch.intent) next.intent = intent;

	if (patch.neighborhood && mentioned(hay, patch.neighborhood)) {
		next.neighborhood = patch.neighborhood;
	}

	if (
		patch.timelineMonths !== undefined &&
		hasTimelineLanguage(hay) &&
		mentionedNumber(hay, patch.timelineMonths)
	) {
		next.timelineMonths = patch.timelineMonths;
	} else if (patch.timelineMonths !== undefined && hasTimelineLanguage(hay)) {
		next.timelineMonths = patch.timelineMonths;
	}

	if (patch.budgetUsd !== undefined && hasBudgetLanguage(hay)) {
		next.budgetUsd = patch.budgetUsd;
	}

	if (patch.financing && patch.financing === financing) next.financing = patch.financing;
	else if (financing && patch.financing) next.financing = financing;

	if (patch.ownsProperty !== undefined && owns === patch.ownsProperty) {
		next.ownsProperty = patch.ownsProperty;
	} else if (owns !== undefined && patch.ownsProperty !== undefined) {
		next.ownsProperty = owns;
	}

	if (patch.inMetro !== undefined && metro === patch.inMetro) next.inMetro = patch.inMetro;
	else if (metro !== undefined && patch.inMetro !== undefined) next.inMetro = metro;

	if (patch.refusedContact && hasContactRefusal(pack)) next.refusedContact = true;
	if (patch.notes && mentioned(hay, patch.notes.slice(0, 24))) next.notes = patch.notes;

	return next;
}

export function scrubInferredFields(
	profile: LeadProfile,
	evidence: InquiryEvidence | string,
): LeadProfile {
	const pack =
		typeof evidence === "string"
			? { allUser: evidence, latestUser: evidence, lastAsk: "" }
			: evidence;
	const next = { ...profile };
	if (ownershipFromEvidence(pack) === undefined) delete next.ownsProperty;
	if (metroFromEvidence(pack) === undefined) delete next.inMetro;
	if (financingFromEvidence(pack) === undefined) delete next.financing;
	if (!hasContactRefusal(pack)) delete next.refusedContact;
	return next;
}
