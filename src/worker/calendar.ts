import { Agent } from "agents";
import { emptyCalendarState, type CalendarSlot, type CalendarState } from "../shared/types";

const SLOT_MINUTES = 45;
const START_HOUR = 9;
const LAST_START_HOUR = 16;

function weekdayKey(date: Date): string {
	return new Intl.DateTimeFormat("en-CA", {
		timeZone: "America/Chicago",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).format(date);
}

function austinParts(date: Date) {
	const parts = new Intl.DateTimeFormat("en-US", {
		timeZone: "America/Chicago",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		hourCycle: "h23",
	}).formatToParts(date);
	const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "0";
	return {
		year: Number(get("year")),
		month: Number(get("month")),
		day: Number(get("day")),
		hour: Number(get("hour")),
		minute: Number(get("minute")),
	};
}

function zonedTimeToUtc(
	year: number,
	month: number,
	day: number,
	hour: number,
	minute: number,
): Date {
	const guess = new Date(Date.UTC(year, month - 1, day, hour, minute));
	const asAustin = austinParts(guess);
	const desired = Date.UTC(year, month - 1, day, hour, minute);
	const actual = Date.UTC(asAustin.year, asAustin.month - 1, asAustin.day, asAustin.hour, asAustin.minute);
	return new Date(guess.getTime() + (desired - actual));
}

function generateSlots(now = new Date()): CalendarSlot[] {
	const slots: CalendarSlot[] = [];
	const start = new Date(now);
	let addedDays = 0;
	let offset = 1;

	while (addedDays < 5) {
		const candidate = new Date(start.getTime() + offset * 24 * 60 * 60 * 1000);
		const weekday = new Intl.DateTimeFormat("en-US", {
			timeZone: "America/Chicago",
			weekday: "short",
		}).format(candidate);
		offset += 1;
		if (weekday === "Sat" || weekday === "Sun") continue;
		addedDays += 1;
		const { year, month, day } = austinParts(candidate);
		for (let hour = START_HOUR; hour <= LAST_START_HOUR; hour++) {
			const begins = zonedTimeToUtc(year, month, day, hour, 0);
			const ends = new Date(begins.getTime() + SLOT_MINUTES * 60 * 1000);
			const id = `${weekdayKey(begins)}-${String(hour).padStart(2, "0")}00`;
			slots.push({
				id,
				startsAt: begins.toISOString(),
				endsAt: ends.toISOString(),
				booked: false,
			});
		}
	}

	const prebook = [0, 2, 11];
	for (const index of prebook) {
		const slot = slots[index];
		if (slot) {
			slot.booked = true;
			slot.leadName = index === 11 ? "Walk-through (existing client)" : "Held for listing prep";
		}
	}

	return slots;
}

export class OfficeCalendar extends Agent<Env, CalendarState> {
	initialState: CalendarState = emptyCalendarState();

	override onStart() {
		if (!this.state.seeded) {
			this.setState({
				seeded: true,
				slots: generateSlots(),
			});
		}
	}

	async listSlots(): Promise<CalendarSlot[]> {
		this.ensureSeeded();
		return this.state.slots;
	}

	async bookSlot(input: {
		slotId: string;
		leadName: string;
	}): Promise<{ ok: true; slot: CalendarSlot } | { ok: false; reason: string }> {
		this.ensureSeeded();
		const slots = this.state.slots.map((slot) => ({ ...slot }));
		const slot = slots.find((item) => item.id === input.slotId);
		if (!slot) {
			return { ok: false, reason: "That slot is not on the calendar." };
		}
		if (slot.booked) {
			return { ok: false, reason: "That time is already taken." };
		}
		slot.booked = true;
		slot.leadName = input.leadName;
		this.setState({ ...this.state, slots });
		return { ok: true, slot };
	}

	private ensureSeeded() {
		if (!this.state.seeded || this.state.slots.length === 0) {
			this.setState({
				seeded: true,
				slots: generateSlots(),
			});
		}
	}
}
