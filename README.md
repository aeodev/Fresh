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

## Isolated widget connection lab

Run `npm run lab`, then open **http://127.0.0.1:8790**. This creates an isolated
Fresh QA Worker on port 8788 and a mock Freshchat provider plus webapp on port 8790.
Both bind only to loopback. The Worker uses `lab/wrangler.jsonc`, all existing
D1 migrations and Durable Objects, with state under `lab/.state/runtime`. The
mock provider keeps its own messages and delivery queue in `lab/.state/provider.sqlite`.
It does not use the production database, Freshchat API keys, widget SDK or staff queue.

The bootstrap reads only the AI key/model settings from the local `.env`, or use
`FRESHQA_LAB_OPENAI_API_KEY` / `lab/.dev.vars`. Other environment values, including
production base URLs and encryption keys, are not copied. Lab credentials are
generated locally. The provider address is fixed to loopback and cannot be changed
through the webapp. Sample support knowledge is seeded through the actual knowledge
API, including embeddings, and is clearly marked as test data. The knowledge panel
can publish your pasted content into a new **lab-only** version.

Create a conversation, enable its Fresh QA companion, then type in the embedded
customer widget. The widget stores messages separately from notification delivery.
Product-event and account-webhook envelopes go through the actual ingest routes;
the actual Freshchat REST client re-reads the mock provider, drafts, gates, posts
a reply and echoes the agent event. The widget polls only the provider, so a draft
in the companion is not automatically a delivered customer message.

The inspector can delay, drop or duplicate notifications, inject 429/503 reads or
503 send failures, replay failed notifications, and invoke an explicit provider
recovery check. Optional recovery ticks use the current scheduled recovery code;
10-second mode is accelerated testing, not a claim about production recovery.
Human replies, private notes, shadow mode, resolution, reopening and widget
disconnection/reconnection are also available. Reload restores the selected
conversation. Export saves test messages, decisions and request traces as JSON.

Run `npm run lab:check` while the lab is running for integration checks.
Run `npm run lab:check:failures` for 429/503 failures and send-recovery checks. These use
real AI against the isolated database with instant pacing and zero debounce; they
restore normal pacing afterward. The app documents the simulated parts and links
to the official Freshworks widget, product-event and REST API documentation.
Passing this lab does not certify Freshworks-hosted SDK behavior, account
permissions or production event delivery. Never test on production without explicit
authorization for that specific live test.

### Dashboard conversation analysis

Branch implementation: `codex/conversation-analysis`. Apply migration
`0007_conversation_analysis.sql` before running this build. Analysis is off by
default per company and is configured in the dashboard **Analysis** tab by an
owner/admin. It has no widget UI, Freshchat sender, or bot activation path.

The implementation deliberately avoids a full-history scan:

- New/edited public messages queue one job per conversation. Duplicate message
  events do not queue another job. Resolution schedules a review after one
  minute; other activity waits for 15 quiet minutes. The existing ten-minute
  scheduled tick processes eligible jobs, so these are eligibility delays,
  not guaranteed completion times.
- A scheduled run handles at most five conversations. Manual runs process one
  conversation within the HTTP background-work window. The default company allowance is
  20 analysis attempts per UTC day, adjustable from 1 to 100, and calls also
  pass the existing overall AI request guard. Concurrency uses expiring leases;
  unchanged transcript fingerprints skip the model entirely.
- Backlog scanning is explicit: queue at most 50 conversations already stored
  locally from the last seven days, with attention cases first. This does not
  fetch historical Freshchat conversations. Failed jobs stop after three
  attempts and can be retried in the dashboard.
- Inputs contain only the latest 80 public customer/agent/bot messages, each
  capped at 1,500 characters and a combined 24,000 text characters. Private
  notes are excluded and common identifiers/links are redacted. This is not a
  complete personal-data anonymizer or a full-conversation guarantee.
- Reviews cover outcome, clarity, empathy, patient guidance, visible
  contradictions and handoff. Each finding must cite a message ID and an exact
  quotation validated against the supplied text. The evaluator has no product
  knowledge context; unsupported factual conclusions must remain uncertain.
- Dashboard readers can inspect results; knowledge editors can approve/reject
  reviews and save revised guidance. Approval records an assessment only. It
  does not train a model, rewrite knowledge, change persona, or affect customer
  replies. Publishing a knowledge correction remains a separate existing flow.

The dashboard shows the latest assessment for each of up to 100 conversations.
Historical assessments remain stored when a transcript changes. Model identity, token counts, reviewer,
review time and audit events are retained. Older approved reviews do not
silently become approval of a changed conversation.

Validation: `npm test`, `npm run typecheck`, `npm run build`. Analysis unit tests use
an isolated SQLite database and mocked model responses. Real-AI checks use five
synthetic conversations in the isolated local preview, with no Freshchat connection.
`node scripts/check-analysis-samples.mjs` verifies generated sample results,
short wording, exact source evidence, and expected support outcomes. Source
links open the dashboard conversation and highlight the referenced message.
Approve/Reject records a decision, hides the completed actions, and allows an
explicit change of decision.
