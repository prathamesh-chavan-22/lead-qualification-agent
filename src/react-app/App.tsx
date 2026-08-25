import { useEffect, useMemo, useRef, useState } from "react";
import { useAgent } from "agents/react";
import { useAgentChat } from "@cloudflare/ai-chat/react";
import { isToolUIPart, type UIMessage } from "ai";
import Markdown from "react-markdown";
import { emptyLeadState, type CalendarState, type LeadState } from "../shared/types";
import { confirmationCopy, consultIcs, formatAustinRange, formatUsd } from "./format";
import { stripToolLeakage } from "../shared/sanitize";
import { Desk } from "./Desk";
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
	const raw = message.parts
		.filter((part) => part.type === "text")
		.map((part) => ("text" in part ? part.text : ""))
		.join("");
	return message.role === "assistant" ? stripToolLeakage(raw) : raw;
}

function stabilizeMarkdown(text: string): string {
	let next = text;
	if ((next.match(/```/g) ?? []).length % 2 === 1) next += "\n```";
	const withoutFences = next.replace(/```[\s\S]*?```/g, "");
	if ((withoutFences.match(/\*\*/g) ?? []).length % 2 === 1) next += "**";
	return next;
}

function TicketValue({ value }: { value: string }) {
	const filled = value !== "—";
	return (
		<dd key={value} className={filled ? "inked" : "blank"}>
			{value}
		</dd>
	);
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
	cancelConsult: "Releasing the hold",
	rescheduleConsult: "Moving the hold",
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

function useDeskPath() {
	const [desk, setDesk] = useState(() => window.location.hash === "#desk");
	useEffect(() => {
		const sync = () => setDesk(window.location.hash === "#desk");
		window.addEventListener("hashchange", sync);
		return () => window.removeEventListener("hashchange", sync);
	}, []);
	function go(path: "/" | "/desk") {
		window.location.assign(path === "/desk" ? "/#desk" : "/");
		setDesk(path === "/desk");
	}
	return { desk, go };
}

function downloadIcs(ics: string, slotId: string) {
	const blob = new Blob([ics], { type: "text/calendar" });
	const url = URL.createObjectURL(blob);
	const link = document.createElement("a");
	link.href = url;
	link.download = `northside-${slotId}.ics`;
	link.click();
	URL.revokeObjectURL(url);
}

function Intake() {
	const [name] = useState(() => sessionId());
	const [lead, setLead] = useState<LeadState>(emptyLeadState);
	const [form, setForm] = useState<FormState>(emptyForm);
	const [formOpen, setFormOpen] = useState(true);
	const [draft, setDraft] = useState("");
	const [copied, setCopied] = useState(false);
	const [calendar, setCalendar] = useState<CalendarState>({ seeded: false, slots: [], leads: [] });
	const scroller = useRef<HTMLDivElement>(null);
	const seedRef = useRef<Record<string, unknown> | null>(null);

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

	const { messages, sendMessage, status, clearHistory } = useAgentChat({
		agent,
		body: () => (seedRef.current ? { seedProfile: seedRef.current } : {}),
	});

	useEffect(() => {
		const node = scroller.current;
		if (!node) return;
		node.scrollTop = node.scrollHeight;
	}, [messages, status]);

	function profileFromForm() {
		return {
			name: form.name.trim() || undefined,
			email: form.email.trim() || undefined,
			phone: form.phone.trim() || undefined,
			intent: form.intent || undefined,
			neighborhood: form.neighborhood.trim() || undefined,
			notes: form.notes.trim() || undefined,
		};
	}

	function buildFormMessage(): string {
		const who = form.name.trim() || "there";
		const intent =
			form.intent === "buy"
				? "looking to buy"
				: form.intent === "sell"
					? "thinking about selling"
					: "reaching out";
		const area = form.neighborhood.trim()
			? ` around ${form.neighborhood.trim()}`
			: "";
		const extra = form.notes.trim() ? ` ${form.notes.trim()}` : "";
		return `Hi Maya — I'm ${who}, ${intent}${area}.${extra}`;
	}

	async function onSubmitForm(event: React.FormEvent) {
		event.preventDefault();
		const seed = profileFromForm();
		seedRef.current = seed;
		setFormOpen(false);
		await agent.call("applySeed", [seed]);
		await sendMessage({ text: buildFormMessage() });
		seedRef.current = null;
	}

	async function onSendChat(event: React.FormEvent) {
		event.preventDefault();
		const text = draft.trim();
		if (!text) return;
		setDraft("");
		setFormOpen(false);
		await sendMessage({ text });
	}

	async function onClearChat() {
		await agent.call("resetIntake");
		await clearHistory();
		setForm(emptyForm());
		setFormOpen(true);
	}

	async function onPickSlot(slotId: string) {
		if (lead.status === "booked") {
			await agent.call("rescheduleFromUi", [slotId]);
			return;
		}
		await agent.call("bookFromUi", [slotId]);
	}

	const openSlots = useMemo(
		() => calendar.slots.filter((slot) => !slot.booked).slice(0, 6),
		[calendar.slots],
	);

	const bookingLabel =
		lead.booking && formatAustinRange(lead.booking.startsAt, lead.booking.endsAt);

	return (
		<main className="layout">
			<section className="panel intake" aria-label="Inquiry form">
				{formOpen ? (
					<form onSubmit={onSubmitForm}>
						<p className="lede">
							Leave what you already know. Maya will pick up in chat — one question at a
							time — and the ticket on the right fills as you talk.
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
				{lead.idleNudge && (
					<p className="nudge" role="status">
						{lead.idleNudge}
					</p>
				)}
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
							.filter((tool): tool is string => Boolean(tool));
						if (!text && tools.length === 0) return null;
						return (
							<article key={message.id} className={`bubble ${message.role}`}>
								<p className="who">{message.role === "user" ? "You" : "Maya"}</p>
								{tools.length > 0 && (
									<ul className="tools">
										{[...new Set(tools)].map((tool) => (
											<li key={tool}>{TOOL_COPY[tool] ?? tool}</li>
										))}
									</ul>
								)}
								{text && message.role === "assistant" ? (
									<div className="md">
										<Markdown>
											{stabilizeMarkdown(text)}
										</Markdown>
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
				<button type="button" className="text-link" onClick={() => void onClearChat()}>
					Clear chat and ticket
				</button>
			</section>

			<aside className="ticket" aria-label="Showing ticket">
				<div className="punch" aria-hidden="true" />
				<p className="eyebrow">Showing ticket</p>
				<p className={`stamp ${lead.status}`}>{lead.status}</p>
				<dl>
					<div>
						<dt>Name</dt>
						<TicketValue value={lead.profile.name ?? "—"} />
					</div>
					<div>
						<dt>Reach</dt>
						<TicketValue value={lead.profile.email || lead.profile.phone || "—"} />
					</div>
					<div>
						<dt>Intent</dt>
						<TicketValue value={lead.profile.intent ?? "—"} />
					</div>
					<div>
						<dt>Area</dt>
						<TicketValue value={lead.profile.neighborhood ?? "—"} />
					</div>
					<div>
						<dt>Timeline</dt>
						<TicketValue
							value={
								lead.profile.timelineMonths !== undefined
									? `${lead.profile.timelineMonths} mo`
									: "—"
							}
						/>
					</div>
					<div>
						<dt>Budget / list</dt>
						<TicketValue value={formatUsd(lead.profile.budgetUsd)} />
					</div>
					<div>
						<dt>Financing</dt>
						<TicketValue value={lead.profile.financing ?? "—"} />
					</div>
					{(lead.profile.intent === "sell" || lead.profile.ownsProperty !== undefined) && (
						<div>
							<dt>Owns the home</dt>
							<TicketValue
								value={
									lead.profile.ownsProperty === undefined
										? "—"
										: lead.profile.ownsProperty
											? "Yes"
											: "No"
								}
							/>
						</div>
					)}
				</dl>
				{lead.status === "booked" && lead.booking && bookingLabel && (
					<div className="confirm">
						<p>Locked: {bookingLabel}</p>
						<div className="actions">
							<button
								type="button"
								className="ghost"
								onClick={() => {
									const text = confirmationCopy(bookingLabel, lead.profile.name);
									void navigator.clipboard.writeText(text).then(() => {
										setCopied(true);
										window.setTimeout(() => setCopied(false), 2000);
									});
								}}
							>
								{copied ? "Copied" : "Copy confirmation"}
							</button>
							<button
								type="button"
								className="ghost"
								onClick={() =>
									downloadIcs(
										consultIcs({
											...lead.booking!,
											name: lead.profile.name,
										}),
										lead.booking!.slotId,
									)
								}
							>
								Download .ics
							</button>
							<button type="button" className="ghost" onClick={() => void agent.call("cancelBooking")}>
								Cancel hold
							</button>
						</div>
					</div>
				)}
				{lead.status === "unqualified" && (
					<p className="decline">{lead.unqualifiedReason ?? "Not a fit for this desk."}</p>
				)}
				{lead.lastCalendarError && (
					<p className="decline">{lead.lastCalendarError}</p>
				)}
				<div className="board">
					<p className="eyebrow">
						{lead.status === "qualified"
							? "Click a time to hold it"
							: lead.status === "booked"
								? "Click another time to move it"
								: "Open on the board"}
					</p>
					<ul>
						{openSlots.map((slot) => {
							const canPick = lead.status === "qualified" || lead.status === "booked";
							const label = formatAustinRange(slot.startsAt, slot.endsAt);
							return (
								<li key={slot.id}>
									{canPick ? (
										<button
											type="button"
											className="slot"
											onClick={() => void onPickSlot(slot.id)}
										>
											{label}
										</button>
									) : (
										<span>{label}</span>
									)}
								</li>
							);
						})}
					</ul>
				</div>
			</aside>
		</main>
	);
}

export default function App() {
	const { desk, go } = useDeskPath();

	return (
		<div className="desk">
			<header className="mast">
				<div>
					<p className="eyebrow">Northside Realty · Austin desk</p>
					<h1>{desk ? "Pipeline" : "Walk-in intake"}</h1>
				</div>
				<div className="mast-actions">
					<button type="button" className="ghost" onClick={() => go(desk ? "/" : "/desk")}>
						{desk ? "Intake" : "Desk"}
					</button>
					{!desk && (
						<button
							type="button"
							className="ghost"
							onClick={() => {
								sessionStorage.removeItem(SESSION_KEY);
								window.location.href = "/";
							}}
						>
							New inquiry
						</button>
					)}
				</div>
			</header>
			{desk ? <Desk /> : <Intake />}
		</div>
	);
}
