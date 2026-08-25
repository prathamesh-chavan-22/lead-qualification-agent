const LEAK_PATTERNS: RegExp[] = [
	/\(\s*placeholder[^)]*\)/gi,
	/actual slots will be listed when queried/gi,
	/<\|?tool_call\|?>[\s\S]*?<\/?\|?tool_call\|?>/gi,
	/\[listAvailableSlots\][^\n]*/gi,
];

export function stripToolLeakage(text: string): string {
	let next = text;
	for (const pattern of LEAK_PATTERNS) {
		next = next.replace(pattern, "");
	}
	return next.replace(/\n{3,}/g, "\n\n").replace(/[ \t]+\n/g, "\n").trim();
}
