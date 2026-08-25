import { Agent, callable } from "agents";
import {
	emptyCalendarState,
	type CalendarSlot,
	type CalendarState,
	type LeadSummary,
} from "../shared/types";

const SLOT_MINUTES = 45;
const START_HOUR = 9;
const LAST_START_HOUR = 16;
const OFFICE_HOLDS = new Set(["Held for listing prep", "Walk-through (existing client)"]);

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

	return slots;
}

function applyOfficeHolds(slots: CalendarSlot[]): CalendarSlot[] {
	const next = slots.map((slot) => ({ ...slot }));
	const holds: Array<[number, string]> = [
		[0, "Held for listing prep"],
		[2, "Held for listing prep"],
		[11, "Walk-through (existing client)"],
	];
	for (const [index, leadName] of holds) {
		const slot = next[index];
		if (slot && !slot.booked) {
			slot.booked = true;
			slot.leadName = leadName;
		}
	}
	return next;
}

function mergeRolling(existing: CalendarSlot[], generated: CalendarSlot[]): CalendarSlot[] {
	const booked = new Map(existing.filter((slot) => slot.booked).map((slot) => [slot.id, slot]));
	return generated.map((slot) => {
		const held = booked.get(slot.id);
		return held ? { ...slot, booked: true, leadName: held.leadName } : slot;
	});
}

export class OfficeCalendar extends Agent<Env, CalendarState> {
	initialState: CalendarState = emptyCalendarState();

	override onStart() {
		this.rollForward();
	}

	@callable()
	async listSlots(): Promise<CalendarSlot[]> {
		this.rollForward();
		return this.state.slots;
	}

	@callable()
	async listLeads(): Promise<LeadSummary[]> {
		return [...this.state.leads].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
	}

	async upsertLead(lead: LeadSummary): Promise<{ ok: true }> {
		const others = this.state.leads.filter((item) => item.id !== lead.id);
		this.setState({
			...this.state,
			leads: [lead, ...others].slice(0, 50),
		});
		return { ok: true };
	}

	@callable()
	async bookSlot(input: {
		slotId: string;
		leadName: string;
	}): Promise<{ ok: true; slot: CalendarSlot } | { ok: false; reason: string }> {
		this.rollForward();
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

	@callable()
	async releaseSlot(input: {
		slotId: string;
	}): Promise<{ ok: true; slot: CalendarSlot } | { ok: false; reason: string }> {
		this.rollForward();
		const slots = this.state.slots.map((slot) => ({ ...slot }));
		const slot = slots.find((item) => item.id === input.slotId);
		if (!slot) {
			return { ok: false, reason: "That slot is not on the calendar." };
		}
		if (!slot.booked) {
			return { ok: false, reason: "That time is not held." };
		}
		if (slot.leadName && OFFICE_HOLDS.has(slot.leadName)) {
			return { ok: false, reason: "Office holds cannot be released from intake." };
		}
		slot.booked = false;
		slot.leadName = undefined;
		this.setState({ ...this.state, slots });
		return { ok: true, slot };
	}

	@callable()
	async rescheduleSlot(input: {
		fromSlotId: string;
		toSlotId: string;
		leadName: string;
	}): Promise<{ ok: true; slot: CalendarSlot } | { ok: false; reason: string }> {
		if (input.fromSlotId === input.toSlotId) {
			const existing = this.state.slots.find((slot) => slot.id === input.toSlotId);
			if (existing?.booked) return { ok: true, slot: existing };
			return { ok: false, reason: "That time is not held." };
		}
		const booked = await this.bookSlot({ slotId: input.toSlotId, leadName: input.leadName });
		if (!booked.ok) return booked;
		const released = await this.releaseSlot({ slotId: input.fromSlotId });
		if (!released.ok) {
			await this.releaseSlot({ slotId: input.toSlotId });
			return released;
		}
		return booked;
	}

	private rollForward() {
		const generated = generateSlots();
		const previous = this.state.slots;
		let slots = mergeRolling(previous, generated);
		const hasOfficeHold = slots.some((slot) => slot.leadName && OFFICE_HOLDS.has(slot.leadName));
		if (!this.state.seeded || previous.length === 0 || !hasOfficeHold) {
			slots = applyOfficeHolds(slots);
		}
		const unchanged =
			this.state.seeded &&
			previous.length === slots.length &&
			previous.every(
				(slot, index) =>
					slot.id === slots[index]?.id &&
					slot.booked === slots[index]?.booked &&
					slot.leadName === slots[index]?.leadName,
			);
		if (unchanged) return;
		this.setState({
			...this.state,
			seeded: true,
			slots,
			leads: this.state.leads ?? [],
		});
	}
}
