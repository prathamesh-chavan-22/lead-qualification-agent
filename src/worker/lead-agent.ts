import { AIChatAgent } from "@cloudflare/ai-chat";
import type { OnChatMessageOptions } from "@cloudflare/ai-chat";
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
import { evaluateQualification, nextAsk, SERVICE_NEIGHBORHOODS } from "./qualify";

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

Service area: ${SERVICE_NEIGHBORHOODS.slice(0, 8).join(", ")}, plus Round Rock, Pflugerville, Cedar Park.
No rentals or commercial. Buyers: ≤6 months and ≥$250k. Sellers: own the home, in-area, ≤12 months.
Pre-approval is optional; cash is fine.

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
		["timelineMonths", profile.timelineMonths?.toString()],
		["budgetUsd", profile.budgetUsd?.toString()],
		["financing", profile.financing],
		["ownsProperty", profile.ownsProperty === undefined ? undefined : String(profile.ownsProperty)],
	].filter(([, value]) => value);
	if (rows.length === 0) return "(empty — start with buy vs sell)";
	return rows.map(([key, value]) => `${key}: ${value}`).join("; ");
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

	private writeProfile(profile: LeadProfile) {
		if (this.state.status === "booked") {
			this.setState({ ...this.state, profile });
			return;
		}
		const verdict = evaluateQualification(profile);
		if (verdict.status === "qualified") {
			this.setState({
				...this.state,
				profile,
				status: "qualified",
				missing: [],
				unqualifiedReason: undefined,
			});
			return;
		}
		if (verdict.status === "unqualified") {
			this.setState({
				...this.state,
				profile,
				status: "unqualified",
				missing: [],
				unqualifiedReason: verdict.reason,
			});
			return;
		}
		this.setState({
			...this.state,
			profile,
			status: "intake",
			missing: verdict.missing,
			unqualifiedReason: undefined,
		});
	}

	private seedFromBody(body: Record<string, unknown> | undefined) {
		if (!body?.seedProfile || typeof body.seedProfile !== "object") return;
		const parsed = profilePatch.safeParse(body.seedProfile);
		if (!parsed.success) return;
		this.writeProfile(this.mergeProfile(parsed.data));
	}

	private turnInstructions(): string {
		const ask = nextAsk(this.state.profile);
		if (this.state.status === "booked") {
			return "Ticket is booked. Confirm the time. Do not ask qualifying questions.";
		}
		if (this.state.status === "unqualified") {
			return "Lead is unqualified. Be kind, explain, do not book.";
		}
		if (this.state.status === "qualified" || !ask) {
			return "File is complete. Offer 3–5 real slots from listAvailableSlots and book the one they pick.";
		}
		return `Ask ONLY this (paraphrase, do not add others): ${ask}`;
	}

	async onChatMessage(_onFinish?: unknown, options?: OnChatMessageOptions) {
		this.seedFromBody(options?.body);
		const workersai = createWorkersAI({ binding: this.env.AI });

		const result = streamText({
			model: workersai("@cf/ibm-granite/granite-4.0-h-micro"),
			maxOutputTokens: 1024,
			system: `${SYSTEM_PROMPT}

Ticket so far: ${compactProfile(this.state.profile)}
Status: ${this.state.status}
${this.turnInstructions()}`,
			messages: await convertToModelMessages(this.messages),
			stopWhen: stepCountIs(8),
			tools: {
				saveLeadProfile: tool({
					description: "Save or update structured fields collected from the inquiry.",
					inputSchema: profilePatch,
					execute: async (patch) => {
						const profile = this.mergeProfile(patch);
						this.writeProfile(profile);
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
						this.writeProfile(this.state.profile);
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
