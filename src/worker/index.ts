import { getAgentByName } from "agents";
import { Hono } from "hono";
import { agentsMiddleware } from "hono-agents";
import { OfficeCalendar } from "./calendar";
import { LeadAgent } from "./lead-agent";

export { LeadAgent, OfficeCalendar };

const app = new Hono<{ Bindings: Env }>();

app.use("*", agentsMiddleware());

app.get("/api/calendar", async (c) => {
	const calendar = await getAgentByName(c.env.OfficeCalendar, "northside");
	const slots = await calendar.listSlots();
	return c.json({ slots });
});

export default app;
