export type LeadStatus = "intake" | "qualified" | "booked" | "unqualified";

export type LeadIntent = "buy" | "sell" | "rent" | "other";

export type Financing = "preapproved" | "cash" | "unknown" | "none";

export type LeadProfile = {
	name?: string;
	email?: string;
	phone?: string;
	intent?: LeadIntent;
	timelineMonths?: number;
	neighborhood?: string;
	budgetUsd?: number;
	financing?: Financing;
	ownsProperty?: boolean;
	refusedContact?: boolean;
	notes?: string;
};

export type Booking = {
	slotId: string;
	startsAt: string;
	endsAt: string;
};

export type LeadState = {
	status: LeadStatus;
	profile: LeadProfile;
	missing: string[];
	unqualifiedReason?: string;
	booking?: Booking;
};

export type CalendarSlot = {
	id: string;
	startsAt: string;
	endsAt: string;
	booked: boolean;
	leadName?: string;
};

export type CalendarState = {
	seeded: boolean;
	slots: CalendarSlot[];
};

export const emptyCalendarState = (): CalendarState => ({
	seeded: false,
	slots: [],
});

export const emptyLeadState = (): LeadState => ({
	status: "intake",
	profile: {},
	missing: [],
});
