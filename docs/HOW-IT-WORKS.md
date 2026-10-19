# How FreshQA v2 works

One sentence: **each company has one Freshchat account and one AI agent that answers customers from that company's knowledge; people take over a chat whenever they want.**

## The moving parts

```
 Customer ──▶ Freshchat widget ──▶ Freshchat
                                     │
                    ┌────────────────┴──────────────────┐
                    │ 1. account webhook (optional)      │ 2. sidebar app product events
                    ▼                                    ▼
        POST /api/ingest/freshchat/:company/:secret   POST /api/sidebar/events (Bearer token)
                    │                                    │
                    └──────────────┬─────────────────────┘
                                   ▼
                         worker/conversations/ingest.ts      ← records the event, wakes the object   (< 1 s)
                                   ▼
                    ConversationObject (Durable Object, one per chat)
                                   │  debounce 3 s, one turn at a time
                                   ▼
                          worker/agent/pipeline.ts  runTurn()
                          ├─ re-read conversation + messages from the Freshchat API
                          ├─ state machine: resolved / human / agent
                          ├─ open customer turn → retrieve → draft → gate
                          └─ send as the reply agent, or hand off, and record the turn
                                   ▼
                       Freshchat API  POST /v2/conversations/{id}/messages (actor_type=agent)
```

Two ways to hear about new messages exist because Freshchat allows **one** account-level webhook. If that slot is already used, install the sidebar app: its serverless handlers forward `onMessageCreate` and friends with the company's install token. Both paths end in the same `ingestEvent()`.

## The turn, step by step (`worker/agent/pipeline.ts`)

1. **Read** the conversation and its last 100 messages from the Freshchat API. The webhook payload is only a hint; the API is the truth, which is what makes missed or reordered events harmless.
2. **State**: `resolved` in Freshchat → stop. `human` (someone took over, or a teammate replied) → stop. `resolved` locally but the customer wrote again → back to `agent`.
3. **Teammate detection**: any *normal* message from an agent profile other than the configured reply agent, created after FreshQA first saw the conversation, means a person is handling it. State becomes `human`.
4. **Open turn** (`agent/turn.ts`): every consecutive customer message after the last agent reply, joined into one question. If a turn for that message already exists, stop (this is the idempotency key; retries never double-send).
5. **Retrieve** (`knowledge/retrieve.ts`): embed the question, score every chunk of the active knowledge version by `0.65 × cosine + 0.35 × keyword overlap`, keep the top 6.
6. **Draft** (`agent/prompt.ts`, `agent/openai.ts`): one structured call returning `{answer, confidence, citations, needs_human, reason}`. The instructions forbid inventing anything not in the excerpts.
7. **Gate** (`agent/gate.ts`), in order: explicit handoff phrase in Live mode → handoff; model needs review, empty answer, missing citations, or low confidence → hold this turn for review and keep the agent on; shadow mode → draft only; else send.
8. **Act**: send as the reply agent, hold a draft with `needs_attention` while preserving `agent` ownership, or hand over to `human` for an explicit customer request (optionally posting the configured handoff message). Record the turn, knowledge version, retrieved source scores, and decision.

Every skip, send, handoff, and error writes a row to `events`, which is what the Activity tab and the conversation timeline show.

## States

| state      | meaning                                              | leaves when                                                    |
|------------|------------------------------------------------------|----------------------------------------------------------------|
| `agent`    | the AI answers only with sidebar permission          | teammate replies, handoff, takeover, resolved                  |
| `human`    | a person owns it; the AI is silent                    | turn on in the Freshchat sidebar, or conversation resolved      |
| `resolved` | closed in Freshchat; sidebar permission is cleared   | reopen in Freshchat, then turn on in the sidebar again          |

Company-level **mode**: `off` (nothing runs), `shadow` (drafts recorded for opted-in chats, nothing sent), `live` (replies only in chats explicitly turned on in the Freshchat sidebar). Existing synced chats remain off until opted in. Turning the sidebar switch off or resolving a chat clears that permission. Reopening a chat never turns the agent on automatically.

## Data model (`migrations/0001_init.sql`)

`users`, `sessions` · `companies`, `memberships` (role), `invites` · `freshchat_connections`, `sidebar_tokens`, `agent_settings` · `knowledge_versions`, `knowledge_docs`, `knowledge_chunks` (text + embedding blob) · `golden_tests` · `conversations`, `messages`, `turns`, `events` · `ai_usage`.

Knowledge is versioned: you edit a **draft**, activate it, and the previous active version is archived and can be restored. The agent only ever reads the active version.

## Roles (`shared/rbac.ts`)

`owner` everything · `admin` members, connection, knowledge, agent settings and mode · `member` knowledge, conversations, take over · `viewer` read only. The creator of a company is its owner. Ownership can be transferred by an owner; a company always keeps at least one owner.

## Code map

```
worker/index.ts            every route mounted, plus the 10-minute reconcile cron
worker/auth/               password sessions
worker/companies/          companies, members, invites, RBAC middleware
worker/freshchat/          client.ts (API), events.ts (payload → event), signature.ts, routes (connection), ingest-routes
worker/knowledge/          chunk.ts, embed.ts, retrieve.ts, repo.ts, routes.ts
worker/agent/              openai.ts, prompt.ts, turn.ts, gate.ts, pipeline.ts, routes (settings, test chat, golden tests)
worker/conversations/      repo.ts, ingest.ts, object.ts (Durable Object), routes.ts
worker/sidebar/            token auth + endpoints the Freshchat app calls
shared/                    rbac.ts and the API types the UI and Worker share
ui/                        React SPA: pages/ one file per screen
sidebar-app/               the Freshchat FDK app
tests/                     unit tests for the pure logic
```

Rules the code follows: all Freshchat calls go through `freshchat/client.ts`; every agent decision writes an event; no file is meant to grow past ~300 lines.

## Guided support and reliability, 15 October 2026

D1 embedding BLOBs are decoded from byte arrays into float32 vectors. Incompatible vector dimensions fall back to keyword search. A development-team request not to reply, including punctuation after the introduction, stays silent for that message only. Held, silent, and failed turns are consumed so their text is not repeatedly joined into new questions.

Uncertain replies remain visible for review while the agent stays enabled. Only explicit customer requests for staff, actual teammate takeover, manual pause, and resolution transfer or stop automatic ownership. An uncertain send is flagged and is not replayed automatically; a new customer message is evaluated normally.

Guided support uses recent conversation context to retrieve the next relevant source for short replies such as “done” or “I don’t see it.” The agent uses everyday language, gives one or two supported actions and a concrete check-in, then waits for the customer. It keeps prices, policies, caveats, and source terminology accurate, and does not claim to be human. Test Chat shows the exact version and whether it is active or draft. Saving a draft does not publish it.
