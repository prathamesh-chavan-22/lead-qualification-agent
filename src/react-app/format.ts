export function formatAustinRange(startsAt: string, endsAt: string): string {
	const start = new Date(startsAt);
	const end = new Date(endsAt);
	const day = new Intl.DateTimeFormat("en-US", {
		timeZone: "America/Chicago",
		weekday: "short",
		month: "short",
		day: "numeric",
	}).format(start);
	const time = new Intl.DateTimeFormat("en-US", {
		timeZone: "America/Chicago",
		hour: "numeric",
		minute: "2-digit",
	});
	return `${day} · ${time.format(start)}–${time.format(end)} CT`;
}

export function formatUsd(value: number | undefined): string {
	if (value === undefined) return "—";
	return new Intl.NumberFormat("en-US", {
		style: "currency",
		currency: "USD",
		maximumFractionDigits: 0,
	}).format(value);
}
