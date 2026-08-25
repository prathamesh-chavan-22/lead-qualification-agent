import { useEffect, useMemo, useRef, useState } from "react";
import { useAgent } from "agents/react";
import { useAgentChat } from "@cloudflare/ai-chat/react";
import { isToolUIPart, type UIMessage } from "ai";
import Markdown from "react-markdown";
import { emptyLeadState, type CalendarState, type LeadState } from "../shared/types";
import { formatAustinRange, formatUsd } from "./format";
import "./App.css";

const SESSION_KEY = "northside-lead-session";

function sessionId(): string {
	const existing = sessionStorage.getItem(SESSION_KEY);
	if (existing) return existing;
	const created = crypto.randomUUID();
	sessionStorage.setItem(SESSION_KEY, created);
	return created;
}

function messageText(message: UIMessage): string {
	return message.parts
		.filter((part) => part.type === "text")
		.map((part) => ("text" in part ? part.text : ""))
		.join("");
}

function toolName(part: UIMessage["parts"][number]): string | null {
	if (!isToolUIPart(part)) return null;
	return part.type.replace(/^tool-/, "");
}

const TOOL_COPY: Record<string, string> = {
	saveLeadProfile: "Updating the file",
	evaluateQualification: "Running the desk rules",
	listAvailableSlots: "Checking the showing board",
	bookConsult: "Writing the ticket",
	flagUnqualified: "Flagging the inquiry",
};

type FormState = {
	name: string;
	email: string;
	phone: string;
	intent: "buy" | "sell" | "";
	neighborhood: string;
	notes: string;
};

const emptyForm = (): FormState => ({
	name: "",
	email: "",
	phone: "",
	intent: "",
	neighborhood: "",
	notes: "",
});

export default function App() {
	const [name] = useState(() => sessionId());
	const [lead, setLead] = useState<LeadState>(emptyLeadState);
	const [form, setForm] = useState<FormState>(emptyForm);
	const [formOpen, setFormOpen] = useState(true);
	const [draft, setDraft] = useState("");
	const [calendar, setCalendar] = useState<CalendarState>({ seeded: false, slots: [] });
	const scroller = useRef<HTMLDivElement>(null);

	const agent = useAgent<LeadState>({
		agent: "LeadAgent",
		name,
		onStateUpdate: (state) => setLead(state),
	});

	useAgent<CalendarState>({
		agent: "OfficeCalendar",
		name: "northside",
		onStateUpdate: (state) => setCalendar(state),
	});

	const { messages, sendMessage, status, clearHistory } = useAgentChat({ agent });

	useEffect(() => {
		scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
	}, [messages, status]);

	function startNewInquiry() {
		sessionStorage.removeItem(SESSION_KEY);
		window.location.reload();
	}

	function buildFormMessage(): string {
		const lines = [
			"New website inquiry for Northside Realty.",
			form.name && `Name: ${form.name}`,
			form.email && `Email: ${form.email}`,
			form.phone && `Phone: ${form.phone}`,
			form.intent && `Looking to: ${form.intent}`,
			form.neighborhood && `Area: ${form.neighborhood}`,
			form.notes && `Notes: ${form.notes}`,
			"Please qualify me and book a consult if I fit.",
		].filter(Boolean);
		return lines.join("\n");
	}

	async function onSubmitForm(event: React.FormEvent) {
		event.preventDefault();
		setFormOpen(false);
		await sendMessage({ text: buildFormMessage() });
	}

	async function onSendChat(event: React.FormEvent) {
		event.preventDefault();
		const text = draft.trim();
		if (!text) return;
		setDraft("");
		setFormOpen(false);
		await sendMessage({ text });
	}

	const openSlots = useMemo(
		() => calendar.slots.filter((slot) => !slot.booked).slice(0, 6),
		[calendar.slots],
	);

	return (
		<div className="desk">
			<header className="mast">
				<div>
					<p className="eyebrow">Northside Realty · Austin desk</p>
					<h1>Walk-in intake</h1>
				</div>
				<button type="button" className="ghost" onClick={startNewInquiry}>
					New inquiry
				</button>
			</header>

			<main className="layout">
				<section className="panel intake" aria-label="Inquiry form">
					{formOpen ? (
						<form onSubmit={onSubmitForm}>
							<p className="lede">
								Tell Maya what you need. She will ask the rest, then pull a consult off the
								showing board—or mark the file if we cannot help.
							</p>
							<label>
								Name
								<input
									value={form.name}
									onChange={(e) => setForm({ ...form, name: e.target.value })}
									autoComplete="name"
								/>
							</label>
							<label>
								Email
								<input
									type="email"
									value={form.email}
									onChange={(e) => setForm({ ...form, email: e.target.value })}
									autoComplete="email"
								/>
							</label>
							<label>
								Phone
								<input
									value={form.phone}
									onChange={(e) => setForm({ ...form, phone: e.target.value })}
									autoComplete="tel"
								/>
							</label>
							<fieldset>
								<legend>Intent</legend>
								<label className="choice">
									<input
										type="radio"
										name="intent"
										checked={form.intent === "buy"}
										onChange={() => setForm({ ...form, intent: "buy" })}
									/>
									Buy
								</label>
								<label className="choice">
									<input
										type="radio"
										name="intent"
										checked={form.intent === "sell"}
										onChange={() => setForm({ ...form, intent: "sell" })}
									/>
									Sell
								</label>
							</fieldset>
							<label>
								Neighborhood
								<input
									value={form.neighborhood}
									onChange={(e) => setForm({ ...form, neighborhood: e.target.value })}
									placeholder="East Austin, Hyde Park…"
								/>
							</label>
							<label>
								Notes
								<textarea
									rows={3}
									value={form.notes}
									onChange={(e) => setForm({ ...form, notes: e.target.value })}
									placeholder="Timeline, budget, anything else"
								/>
							</label>
							<div className="actions">
								<button type="submit">Hand to Maya</button>
								<button
									type="button"
									className="ghost"
									onClick={() => setFormOpen(false)}
								>
									Skip to chat
								</button>
							</div>
						</form>
					) : (
						<div className="parked">
							<p className="eyebrow">Inquiry parked</p>
							<p>{form.name || "Walk-in"} · {form.intent || "chat"}</p>
							<button type="button" className="ghost" onClick={() => setFormOpen(true)}>
								Edit form
							</button>
						</div>
					)}
				</section>

				<section className="panel chat" aria-label="Chat with Maya">
					<div className="transcript" ref={scroller}>
						{messages.length === 0 && (
							<p className="empty">
								Maya is at the desk. Send a note, or start from the form. She will not invent
								times—only the board on the right is real.
							</p>
						)}
						{messages.map((message) => {
							const text = messageText(message);
							const tools = message.parts
								.map(toolName)
								.filter((name): name is string => Boolean(name));
							if (!text && tools.length === 0) return null;
							return (
								<article key={message.id} className={`bubble ${message.role}`}>
									<p className="who">{message.role === "user" ? "You" : "Maya"}</p>
									{tools.length > 0 && (
										<ul className="tools">
											{[...new Set(tools)].map((name) => (
												<li key={name}>{TOOL_COPY[name] ?? name}</li>
											))}
										</ul>
									)}
									{text && message.role === "assistant" ? (
										<div className="md">
											<Markdown>{text}</Markdown>
										</div>
									) : (
										text && <p className="plain">{text}</p>
									)}
								</article>
							);
						})}
						{status === "streaming" || status === "submitted" ? (
							<p className="typing">Maya is writing…</p>
						) : null}
					</div>
					<form className="composer" onSubmit={onSendChat}>
						<input
							value={draft}
							onChange={(e) => setDraft(e.target.value)}
							placeholder="Reply to Maya"
							disabled={status === "streaming" || status === "submitted"}
							aria-label="Chat message"
						/>
						<button type="submit" disabled={status === "streaming" || status === "submitted"}>
							Send
						</button>
					</form>
					<button type="button" className="text-link" onClick={() => void clearHistory()}>
						Clear chat
					</button>
				</section>

				<aside className="ticket" aria-label="Showing ticket">
					<div className="punch" aria-hidden="true" />
					<p className="eyebrow">Showing ticket</p>
					<p className={`stamp ${lead.status}`}>{lead.status}</p>
					<dl>
						<div>
							<dt>Name</dt>
							<dd>{lead.profile.name ?? "—"}</dd>
						</div>
						<div>
							<dt>Reach</dt>
							<dd>{lead.profile.email || lead.profile.phone || "—"}</dd>
						</div>
						<div>
							<dt>Intent</dt>
							<dd>{lead.profile.intent ?? "—"}</dd>
						</div>
						<div>
							<dt>Area</dt>
							<dd>{lead.profile.neighborhood ?? "—"}</dd>
						</div>
						<div>
							<dt>Timeline</dt>
							<dd>
								{lead.profile.timelineMonths !== undefined
									? `${lead.profile.timelineMonths} mo`
									: "—"}
							</dd>
						</div>
						<div>
							<dt>Budget / list</dt>
							<dd>{formatUsd(lead.profile.budgetUsd)}</dd>
						</div>
					</dl>
					{lead.status === "booked" && lead.booking && (
						<p className="confirm">
							Locked: {formatAustinRange(lead.booking.startsAt, lead.booking.endsAt)}
						</p>
					)}
					{lead.status === "unqualified" && (
						<p className="decline">{lead.unqualifiedReason ?? "Not a fit for this desk."}</p>
					)}
					{lead.status === "intake" && lead.missing.length > 0 && (
						<p className="gaps">Still need: {lead.missing.join(", ")}</p>
					)}
					<div className="board">
						<p className="eyebrow">Open on the board</p>
						<ul>
							{openSlots.map((slot) => (
								<li key={slot.id}>
									<span>{formatAustinRange(slot.startsAt, slot.endsAt)}</span>
								</li>
							))}
						</ul>
					</div>
				</aside>
			</main>
		</div>
	);
}
