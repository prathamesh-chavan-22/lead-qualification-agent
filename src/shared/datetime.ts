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
