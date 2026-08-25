import { AIChatAgent } from "@cloudflare/ai-chat";
import type { OnChatMessageOptions } from "@cloudflare/ai-chat";
import { callable, getAgentByName } from "agents";
import {
	convertToModelMessages,
	stepCountIs,
	streamText,
	tool,
} from "ai";
import { createWorkersAI } from "workers-ai-provider";
import { z } from "zod";
import { emptyLeadState, type LeadProfile, type LeadState } from "../shared/types";
import { evaluateQualification, nextAsk } from "./qualify";

const IDLE_NUDGE_SECONDS = 90;

const SYSTEM_PROMPT = `You are Maya, intake coordinator for Northside Realty in Austin. You talk like a person at a desk, not a web form.

Pacing is the product:
- Ask exactly ONE question per reply. Never two. Never a numbered list of questions.
- React to what they just said in one short beat, then ask the next thing.
- Keep the reply to 1–3 sentences plus that single question.
- Do not recap every field you already have unless they ask.
- Do not say "a few questions" or "quick checklist."

Workflow:
1. saveLeadProfile as soon as you learn a field.
2. evaluateQualification after each save.
3. Never invent calendar times. Only offer slots from listAvailableSlots.
4. Book only when evaluateQualification returns qualified.
5. If unqualified, call flagUnqualified and stop.
6. They can also lock a time from the showing ticket; if status is booked, just confirm.

Service area: Austin metro neighborhoods (East Austin, Hyde Park, Mueller, South Congress, Round Rock, Pflugerville, Cedar Park, and nearby). If the area is unfamiliar, ask whether it is Austin metro — do not guess out-of-area unless they name another city.
No rentals or commercial. Buyers: ≤6 months and ≥$250k. Sellers: own the home, in-area, ≤12 months.
Pre-approval is optional; cash is fine. Save financing when they mention it; unknown is allowed.

Markdown: **bold** names, areas, budgets, and booked times. Use a bullet list only for calendar slots. Never wrap the whole reply in a code fence. Finish every sentence.`;

const profilePatch = z.object({
	name: z.string().optional(),
	email: z.string().optional(),
	phone: z.string().optional(),
	intent: z.enum(["buy", "sell", "rent", "other"]).optional(),
	timelineMonths: z.number().optional(),
	neighborhood: z.string().optional(),
	budgetUsd: z.number().optional(),
	financing: z.enum(["preapproved", "cash", "unknown", "none"]).optional(),
	ownsProperty: z.boolean().optional(),
	inMetro: z.boolean().optional(),
	refusedContact: z.boolean().optional(),
	notes: z.string().optional(),
});

function compactProfile(profile: LeadProfile): string {
	const rows = [
		["name", profile.name],
		["email", profile.email],
		["phone", profile.phone],
		["intent", profile.intent],
		["neighborhood", profile.neighborhood],
		["inMetro", profile.inMetro === undefined ? undefined : String(profile.inMetro)],
		["timelineMonths", profile.timelineMonths?.toString()],
		["budgetUsd", profile.budgetUsd?.toString()],
		["financing", profile.financing],
		["ownsProperty", profile.ownsProperty === undefined ? undefined : String(profile.ownsProperty)],
	].filter(([, value]) => value);
	if (rows.length === 0) return "(empty — start with buy vs sell)";
	return rows.map(([key, value]) => `${key}: ${value}`).join("; ");
}

function logDesk(event: string, detail: Record<string, unknown>) {
	console.log(JSON.stringify({ desk: "northside", event, ...detail }));
}

export class LeadAgent extends AIChatAgent<Env, LeadState> {
	initialState: LeadState = emptyLeadState();

	private mergeProfile(patch: LeadProfile): LeadProfile {
		return {
			...this.state.profile,
			...Object.fromEntries(
				Object.entries(patch).filter(([, value]) => value !== undefined && value !== ""),
			),
		};
	}

	private async persist(next: LeadState) {
		this.setState(next);
		await this.syncDesk();
	}

	private async syncDesk() {
		try {
			const calendar = await getAgentByName(this.env.OfficeCalendar, "northside");
			await calendar.upsertLead({
				id: this.name,
				status: this.state.status,
				name: this.state.profile.name,
				intent: this.state.profile.intent,
				neighborhood: this.state.profile.neighborhood,
				booking: this.state.booking,
				unqualifiedReason: this.state.unqualifiedReason,
				updatedAt: new Date().toISOString(),
			});
		} catch (error) {
			logDesk("sync_desk_failed", { error: String(error) });
		}
	}

	private async cancelIdleNudge() {
		const schedules = await this.listSchedules();
		for (const item of schedules) {
			if (item.callback === "nudgeIfIdle") {
				await this.cancelSchedule(item.id);
			}
		}
	}

	private async armIdleNudge() {
		await this.cancelIdleNudge();
		if (this.state.status !== "intake" && this.state.status !== "qualified") return;
		await this.schedule(IDLE_NUDGE_SECONDS, "nudgeIfIdle", {});
	}

	async nudgeIfIdle() {
		if (this.state.status !== "intake" && this.state.status !== "qualified") return;
		await this.persist({
			...this.state,
			idleNudge: "Still at the desk if you want to finish this ticket.",
		});
		logDesk("idle_nudge", { lead: this.name, status: this.state.status });
	}

	private async writeProfile(profile: LeadProfile) {
		if (this.state.status === "booked") {
			await this.persist({ ...this.state, profile, idleNudge: undefined });
			return;
		}
		const verdict = evaluateQualification(profile);
		logDesk("qualify", {
			lead: this.name,
			status: verdict.status,
			missing: verdict.missing,
			reason: verdict.reason,
		});
		if (verdict.status === "qualified") {
			await this.persist({
				...this.state,
				profile,
				status: "qualified",
				missing: [],
				unqualifiedReason: undefined,
				idleNudge: undefined,
			});
			return;
		}
		if (verdict.status === "unqualified") {
			await this.persist({
				...this.state,
				profile,
				status: "unqualified",
				missing: [],
				unqualifiedReason: verdict.reason,
				idleNudge: undefined,
			});
			return;
		}
		await this.persist({
			...this.state,
			profile,
			status: "intake",
			missing: verdict.missing,
			unqualifiedReason: undefined,
			idleNudge: undefined,
		});
	}

	private async seedFromBody(body: Record<string, unknown> | undefined) {
		if (!body?.seedProfile || typeof body.seedProfile !== "object") return;
		const parsed = profilePatch.safeParse(body.seedProfile);
		if (!parsed.success) return;
		await this.writeProfile(this.mergeProfile(parsed.data));
	}

	private turnInstructions(): string {
		const ask = nextAsk(this.state.profile);
		if (this.state.status === "booked") {
			return "Ticket is booked. Confirm the time. Do not ask qualifying questions.";
		}
		if (this.state.status === "unqualified") {
			return "Lead is unqualified. Be kind, explain, do not book.";
		}
		if (this.state.idleNudge) {
			return "They went quiet. One short check-in, then ask only the next missing field.";
		}
		if (this.state.status === "qualified" || !ask) {
			return "File is complete. Offer 3–5 real slots from listAvailableSlots and book the one they pick. They may also click a time on the ticket.";
		}
		return `Ask ONLY this (paraphrase, do not add others): ${ask}`;
	}

	private async bookQualifiedSlot(slotId: string) {
		if (this.state.status === "booked" && this.state.booking) {
			if (this.state.booking.slotId === slotId) {
				return { ok: true as const, alreadyBooked: true, booking: this.state.booking };
			}
			return this.rescheduleQualifiedSlot(slotId);
		}
		if (this.state.status !== "qualified") {
			const reason = "Lead is not qualified yet.";
			await this.persist({ ...this.state, lastCalendarError: reason });
			return { ok: false as const, reason };
		}
		const name = this.state.profile.name ?? "Inbound lead";
		const calendar = await getAgentByName(this.env.OfficeCalendar, "northside");
		const booked = await calendar.bookSlot({ slotId, leadName: name });
		if (!booked.ok) {
			logDesk("book_failed", { lead: this.name, slotId, reason: booked.reason });
			await this.persist({ ...this.state, lastCalendarError: booked.reason });
			return booked;
		}
		await this.persist({
			...this.state,
			status: "booked",
			lastCalendarError: undefined,
			idleNudge: undefined,
			booking: {
				slotId: booked.slot.id,
				startsAt: booked.slot.startsAt,
				endsAt: booked.slot.endsAt,
			},
		});
		await this.cancelIdleNudge();
		logDesk("booked", { lead: this.name, slotId: booked.slot.id });
		return { ok: true as const, booking: this.state.booking };
	}

	private async rescheduleQualifiedSlot(slotId: string) {
		if (this.state.status !== "booked" || !this.state.booking) {
			return { ok: false as const, reason: "Nothing is on the calendar to move." };
		}
		const name = this.state.profile.name ?? "Inbound lead";
		const calendar = await getAgentByName(this.env.OfficeCalendar, "northside");
		const moved = await calendar.rescheduleSlot({
			fromSlotId: this.state.booking.slotId,
			toSlotId: slotId,
			leadName: name,
		});
		if (!moved.ok) {
			logDesk("reschedule_failed", { lead: this.name, slotId, reason: moved.reason });
			await this.persist({ ...this.state, lastCalendarError: moved.reason });
			return moved;
		}
		await this.persist({
			...this.state,
			lastCalendarError: undefined,
			booking: {
				slotId: moved.slot.id,
				startsAt: moved.slot.startsAt,
				endsAt: moved.slot.endsAt,
			},
		});
		logDesk("rescheduled", { lead: this.name, slotId: moved.slot.id });
		return { ok: true as const, booking: this.state.booking };
	}

	@callable()
	async applySeed(patch: LeadProfile) {
		const parsed = profilePatch.safeParse(patch);
		if (!parsed.success) return { ok: false as const, reason: "Invalid profile fields." };
		await this.writeProfile(this.mergeProfile(parsed.data));
		await this.armIdleNudge();
		return { ok: true as const, status: this.state.status, profile: this.state.profile };
	}

	@callable()
	async bookFromUi(slotId: string) {
		return this.bookQualifiedSlot(slotId);
	}

	@callable()
	async rescheduleFromUi(slotId: string) {
		return this.rescheduleQualifiedSlot(slotId);
	}

	@callable()
	async cancelBooking() {
		if (!this.state.booking) {
			return { ok: false as const, reason: "No consult is on hold." };
		}
		const calendar = await getAgentByName(this.env.OfficeCalendar, "northside");
		const released = await calendar.releaseSlot({ slotId: this.state.booking.slotId });
		if (!released.ok) {
			await this.persist({ ...this.state, lastCalendarError: released.reason });
			return released;
		}
		const profile = this.state.profile;
		const verdict = evaluateQualification(profile);
		await this.persist({
			...this.state,
			status: verdict.status === "qualified" ? "qualified" : "intake",
			booking: undefined,
			lastCalendarError: undefined,
			unqualifiedReason: undefined,
			missing: verdict.status === "needs_info" ? verdict.missing : [],
		});
		logDesk("cancelled", { lead: this.name });
		return { ok: true as const, status: this.state.status };
	}

	@callable()
	async resetIntake() {
		if (this.state.booking) {
			const calendar = await getAgentByName(this.env.OfficeCalendar, "northside");
			await calendar.releaseSlot({ slotId: this.state.booking.slotId });
		}
		await this.cancelIdleNudge();
		await this.persist(emptyLeadState());
		logDesk("reset", { lead: this.name });
		return { ok: true as const };
	}

	async onChatMessage(_onFinish?: unknown, options?: OnChatMessageOptions) {
		await this.seedFromBody(options?.body);
		await this.armIdleNudge();
		const workersai = createWorkersAI({ binding: this.env.AI });

		const result = streamText({
			model: workersai("@cf/ibm-granite/granite-4.0-h-micro"),
			maxOutputTokens: 1024,
			system: `${SYSTEM_PROMPT}

Ticket so far: ${compactProfile(this.state.profile)}
Status: ${this.state.status}
${this.state.lastCalendarError ? `Calendar: ${this.state.lastCalendarError}` : ""}
${this.turnInstructions()}`,
			messages: await convertToModelMessages(this.messages),
			stopWhen: stepCountIs(8),
			tools: {
				saveLeadProfile: tool({
					description: "Save or update structured fields collected from the inquiry.",
					inputSchema: profilePatch,
					execute: async (patch) => {
						const profile = this.mergeProfile(patch);
						await this.writeProfile(profile);
						return {
							ok: true,
							profile,
							nextAsk: nextAsk(this.state.profile),
							status: this.state.status,
						};
					},
				}),
				evaluateQualification: tool({
					description:
						"Run deterministic qualification rules. Call after saving new profile fields.",
					inputSchema: z.object({}),
					execute: async () => {
						await this.writeProfile(this.state.profile);
						const verdict = evaluateQualification(this.state.profile);
						return {
							...verdict,
							nextAsk: nextAsk(this.state.profile),
							note:
								this.state.status === "booked"
									? "Already booked."
									: nextAsk(this.state.profile)
										? "Still collecting. Ask only nextAsk."
										: undefined,
						};
					},
				}),
				listAvailableSlots: tool({
					description: "List open 45-minute consult slots on the office calendar.",
					inputSchema: z.object({}),
					execute: async () => {
						const calendar = await getAgentByName(this.env.OfficeCalendar, "northside");
						const slots = await calendar.listSlots();
						return slots.filter((slot) => !slot.booked).slice(0, 8);
					},
				}),
				bookConsult: tool({
					description: "Book a consult slot. Only works when the lead is qualified.",
					inputSchema: z.object({
						slotId: z.string(),
					}),
					execute: async ({ slotId }) => this.bookQualifiedSlot(slotId),
				}),
				cancelConsult: tool({
					description: "Release the held consult slot.",
					inputSchema: z.object({}),
					execute: async () => this.cancelBooking(),
				}),
				rescheduleConsult: tool({
					description: "Move the held consult to another open slot.",
					inputSchema: z.object({ slotId: z.string() }),
					execute: async ({ slotId }) => this.rescheduleQualifiedSlot(slotId),
				}),
				flagUnqualified: tool({
					description: "Mark the inquiry as unqualified and record the reason.",
					inputSchema: z.object({
						reason: z.string(),
					}),
					execute: async ({ reason }) => {
						if (this.state.status === "booked") {
							return { ok: false, reason: "This lead already has a booked consult." };
						}
						await this.persist({
							...this.state,
							status: "unqualified",
							unqualifiedReason: reason,
							missing: [],
							idleNudge: undefined,
						});
						await this.cancelIdleNudge();
						logDesk("unqualified", { lead: this.name, reason });
						return { ok: true, status: "unqualified", reason };
					},
				}),
			},
		});

		return result.toUIMessageStreamResponse();
	}
}
