import { AIChatAgent } from "@cloudflare/ai-chat";
import { getAgentByName } from "agents";
import {
	convertToModelMessages,
	stepCountIs,
	streamText,
	tool,
} from "ai";
import { createWorkersAI } from "workers-ai-provider";
import { z } from "zod";
import { emptyLeadState, type LeadProfile, type LeadState } from "../shared/types";
import { evaluateQualification, SERVICE_NEIGHBORHOODS } from "./qualify";

const SYSTEM_PROMPT = `You are Maya, intake coordinator for Northside Realty, a boutique residential brokerage in Austin, Texas.

Your job:
1. Qualify inbound inquiries for a 45-minute buyer or seller consult.
2. Ask one question at a time. Be warm, specific, and brief.
3. Call saveLeadProfile whenever you learn a field.
4. Call evaluateQualification after each meaningful update.
5. Never invent calendar times. Only offer slots returned by listAvailableSlots.
6. Book only after evaluateQualification returns status "qualified".
7. If status is "unqualified", call flagUnqualified and explain politely. Do not book.

Service area: Austin metro neighborhoods including ${SERVICE_NEIGHBORHOODS.slice(0, 8).join(", ")}, and nearby Round Rock / Pflugerville / Cedar Park.
We do not handle rentals or commercial deals.
Buyers need a timeline within 6 months and a budget of at least $250,000.
Sellers need to own the home, be in-area, and list within 12 months.
Collect name plus email or phone before booking.
Ask about pre-approval for buyers, but cash is fine.

If the first message is a form dump, acknowledge what you already have and only ask for gaps.`;

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
	refusedContact: z.boolean().optional(),
	notes: z.string().optional(),
});

export class LeadAgent extends AIChatAgent<Env, LeadState> {
	initialState: LeadState = emptyLeadState();

	private mergeProfile(patch: LeadProfile): LeadProfile {
		return {
			...this.state.profile,
			...Object.fromEntries(
				Object.entries(patch).filter(([, value]) => value !== undefined),
			),
		};
	}

	async onChatMessage() {
		const workersai = createWorkersAI({ binding: this.env.AI });

		const result = streamText({
			model: workersai("@cf/zai-org/glm-4.7-flash"),
			system: SYSTEM_PROMPT,
			messages: await convertToModelMessages(this.messages),
			stopWhen: stepCountIs(8),
			tools: {
				saveLeadProfile: tool({
					description: "Save or update structured fields collected from the inquiry.",
					inputSchema: profilePatch,
					execute: async (patch) => {
						const profile = this.mergeProfile(patch);
						this.setState({
							...this.state,
							profile,
						});
						return { ok: true, profile };
					},
				}),
				evaluateQualification: tool({
					description:
						"Run deterministic qualification rules. Call after saving new profile fields.",
					inputSchema: z.object({}),
					execute: async () => {
						const result = evaluateQualification(this.state.profile);
						if (this.state.status === "booked") {
							return { ...result, status: "booked", note: "Already booked." };
						}
						if (result.status === "qualified") {
							this.setState({
								...this.state,
								status: "qualified",
								missing: [],
								unqualifiedReason: undefined,
							});
						} else if (result.status === "unqualified") {
							this.setState({
								...this.state,
								status: "unqualified",
								missing: [],
								unqualifiedReason: result.reason,
							});
						} else {
							this.setState({
								...this.state,
								status: "intake",
								missing: result.missing,
							});
						}
						return result;
					},
				}),
				listAvailableSlots: tool({
					description: "List open 45-minute consult slots on the office calendar.",
					inputSchema: z.object({}),
					execute: async () => {
						const calendar = await getAgentByName(this.env.OfficeCalendar, "northside");
						const slots = await calendar.listSlots();
						return slots.filter((slot) => !slot.booked).slice(0, 12);
					},
				}),
				bookConsult: tool({
					description: "Book a consult slot. Only works when the lead is qualified.",
					inputSchema: z.object({
						slotId: z.string(),
					}),
					execute: async ({ slotId }) => {
						if (this.state.status === "booked" && this.state.booking) {
							return { ok: true, alreadyBooked: true, booking: this.state.booking };
						}
						if (this.state.status !== "qualified") {
							return {
								ok: false,
								reason: "Lead is not qualified yet. Call evaluateQualification first.",
							};
						}
						const name = this.state.profile.name ?? "Inbound lead";
						const calendar = await getAgentByName(this.env.OfficeCalendar, "northside");
						const booked = await calendar.bookSlot({ slotId, leadName: name });
						if (!booked.ok) return booked;
						this.setState({
							...this.state,
							status: "booked",
							booking: {
								slotId: booked.slot.id,
								startsAt: booked.slot.startsAt,
								endsAt: booked.slot.endsAt,
							},
						});
						return { ok: true, booking: this.state.booking };
					},
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
						this.setState({
							...this.state,
							status: "unqualified",
							unqualifiedReason: reason,
							missing: [],
						});
						return { ok: true, status: "unqualified", reason };
					},
				}),
			},
		});

		return result.toUIMessageStreamResponse();
	}
}
