import { useMemo, useState } from "react";
import { useAgent } from "agents/react";
import type { CalendarState, LeadStatus } from "../shared/types";
import { formatAustinRange } from "./format";

const SESSION_KEY = "northside-lead-session";

function stampClass(status: LeadStatus): string {
	if (status === "unqualified") return "no";
	if (status === "intake") return "hold";
	return "ok";
}

export function Desk() {
	const [calendar, setCalendar] = useState<CalendarState>({
		seeded: false,
		slots: [],
		leads: [],
	});

	useAgent<CalendarState>({
		agent: "OfficeCalendar",
		name: "northside",
		onStateUpdate: (state) =>
			setCalendar({
				seeded: state.seeded,
				slots: state.slots ?? [],
				leads: state.leads ?? [],
			}),
	});

	const leads = useMemo(
		() => [...(calendar.leads ?? [])].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
		[calendar.leads],
	);

	const held = calendar.slots.filter((slot) => slot.booked);

	function openTicket(id: string) {
		sessionStorage.setItem(SESSION_KEY, id);
		window.location.assign("/");
	}

	return (
		<div className="pipeline">
			<section className="panel">
				<p className="eyebrow">Inquiries</p>
				{leads.length === 0 ? (
					<p className="lede">No tickets yet. Walk-ins land here as Maya writes the file.</p>
				) : (
					<table className="pipe">
						<thead>
							<tr>
								<th>Name</th>
								<th>Status</th>
								<th>Intent</th>
								<th>Area</th>
								<th>Hold</th>
								<th></th>
							</tr>
						</thead>
						<tbody>
							{leads.map((lead) => (
								<tr key={lead.id}>
									<td>{lead.name ?? "Walk-in"}</td>
									<td>
										<span className={`pill ${stampClass(lead.status)}`}>{lead.status}</span>
									</td>
									<td>{lead.intent ?? "—"}</td>
									<td>{lead.neighborhood ?? "—"}</td>
									<td>
										{lead.booking
											? formatAustinRange(lead.booking.startsAt, lead.booking.endsAt)
											: lead.unqualifiedReason ?? "—"}
									</td>
									<td>
										<button type="button" className="ghost" onClick={() => openTicket(lead.id)}>
											Open
										</button>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				)}
			</section>
			<section className="panel">
				<p className="eyebrow">Held on the board</p>
				<ul className="held">
					{held.map((slot) => (
						<li key={slot.id}>
							<span>{formatAustinRange(slot.startsAt, slot.endsAt)}</span>
							<span>{slot.leadName ?? "Hold"}</span>
						</li>
					))}
				</ul>
			</section>
		</div>
	);
}
