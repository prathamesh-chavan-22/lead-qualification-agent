# Northside Realty lead-qualification agent

Austin residential intake desk. An inbound inquiry (website form or chat) is qualified by Maya, then either booked on a mock showing calendar or flagged as unqualified.

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). Workers AI is called remotely (`ai.remote` in `wrangler.json`), so you need a logged-in Wrangler session (`npx wrangler login`).

```bash
npm test
```

## Demo path

1. **Qualified book** — form: buy, East Austin, name + email. In chat, add a 3-month timeline and ~$500k budget. When the ticket says qualified, click a time on the board (or let Maya book). Copy the confirmation or download `.ics`.
2. **Unqualified** — chat: “I need a cheap rental in Houston.” Should be flagged; no booking.
3. **Double-book** — start a new inquiry and click the same slot; the ticket should show the calendar refusal.
4. **Desk** — open **Desk** in the header for the pipeline of inquiries and calendar holds.

Unknown areas (for example “Manor”) are not auto-rejected; Maya asks if it is Austin metro.

## Stack

React + Vite + Hono on Cloudflare Workers. `LeadAgent` (`AIChatAgent`) holds the conversation. `OfficeCalendar` is a shared Durable Object for 45-minute consults (weekdays, 9:00–16:00 CT) and the lead index.
