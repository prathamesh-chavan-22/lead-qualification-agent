export { formatAustinRange } from "../shared/datetime";

export function formatUsd(value: number | undefined): string {
	if (value === undefined) return "—";
	return new Intl.NumberFormat("en-US", {
		style: "currency",
		currency: "USD",
		maximumFractionDigits: 0,
	}).format(value);
}

function icsStamp(iso: string): string {
	return new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

export function consultIcs(input: {
	slotId: string;
	startsAt: string;
	endsAt: string;
	name?: string;
}): string {
	const who = input.name || "Inbound lead";
	return [
		"BEGIN:VCALENDAR",
		"VERSION:2.0",
		"PRODID:-//Northside Realty//Intake//EN",
		"CALSCALE:GREGORIAN",
		"METHOD:PUBLISH",
		"BEGIN:VEVENT",
		`UID:${input.slotId}@northside-realty`,
		`DTSTAMP:${icsStamp(new Date().toISOString())}`,
		`DTSTART:${icsStamp(input.startsAt)}`,
		`DTEND:${icsStamp(input.endsAt)}`,
		"SUMMARY:Northside Realty consult",
		`DESCRIPTION:Consult with ${who.replace(/,/g, " ")}`,
		"LOCATION:Northside Realty, Austin",
		"END:VEVENT",
		"END:VCALENDAR",
		"",
	].join("\r\n");
}

export function confirmationCopy(label: string, name?: string): string {
	const who = name || "there";
	return `Hi ${who} — you're on the Northside Realty board for ${label}. Reply to this thread if you need to move it.`;
}
