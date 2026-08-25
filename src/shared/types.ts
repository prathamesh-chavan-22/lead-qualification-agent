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
	inMetro?: boolean;
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
	lastCalendarError?: string;
	idleNudge?: string;
};

export type CalendarSlot = {
	id: string;
	startsAt: string;
	endsAt: string;
	booked: boolean;
	leadName?: string;
};

export type LeadSummary = {
	id: string;
	status: LeadStatus;
	name?: string;
	intent?: LeadIntent;
	neighborhood?: string;
	booking?: Booking;
	unqualifiedReason?: string;
	updatedAt: string;
};

export type CalendarState = {
	seeded: boolean;
	slots: CalendarSlot[];
	leads: LeadSummary[];
};

export const emptyCalendarState = (): CalendarState => ({
	seeded: false,
	slots: [],
	leads: [],
});

export const emptyLeadState = (): LeadState => ({
	status: "intake",
	profile: {},
	missing: [],
});
