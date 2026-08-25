# Northside Realty lead-qualification agent

Austin residential intake desk. An inbound inquiry (website form or chat) is qualified by Maya, then either booked on a mock showing calendar or flagged as unqualified.

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). Workers AI is called remotely (`ai.remote` in `wrangler.json`), so you need a logged-in Wrangler session (`npx wrangler login`).

## Demo path

1. **Qualified book** — form: buy, East Austin, name + email. In chat, add a 3-month timeline and ~$500k budget. Maya should list real slots and book one.
2. **Unqualified** — chat: “I need a cheap rental in Houston.” Should be flagged; no booking.
3. **Double-book** — start a new inquiry and ask for the same slot; the calendar should refuse.

## Stack

React + Vite + Hono on Cloudflare Workers. `LeadAgent` (`AIChatAgent`) holds the conversation. `OfficeCalendar` is a shared Durable Object for 45-minute consults (weekdays, 9:00–16:00 CT).
