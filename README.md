# FreshQA v2

One AI support agent per company, answering customers in Freshchat from that company's own knowledge, with people able to take over any chat at any time.

- **Multi-company**: a user account can own or belong to several companies; each company has its own Freshchat connection, knowledge, and agent.
- **Roles**: owner, admin, member, viewer (`shared/rbac.ts`). Invite by email.
- **Knowledge**: versioned documents, chunked and embedded, hybrid retrieval, golden tests before going live.
- **Reliable replies**: one Durable Object per conversation serializes turns and debounces bursts; every decision is idempotent and logged.
- **Freshchat**: replies as a named agent; ingest via the account webhook or the sidebar app's product events; sidebar shows who owns the chat with Take over / Hand back.

Stack: Cloudflare Workers + D1 + Durable Objects, Hono, React (Vite), OpenAI. No other services.

Start with [docs/SETUP-FRESHCHAT.md](docs/SETUP-FRESHCHAT.md); the design is in [docs/HOW-IT-WORKS.md](docs/HOW-IT-WORKS.md).

```bash
npm install
cp .dev.vars.example .dev.vars   # add OPENAI_API_KEY
npm run db:migrate
npm run build && npx wrangler dev --port 8787
npm test                          # unit tests
npm run typecheck
```
