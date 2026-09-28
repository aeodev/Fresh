-- FreshQA v2 schema. Read top to bottom: people → companies → Freshchat → knowledge → conversations → events.
-- Timestamps are ISO-8601 UTC strings.

CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE sessions (
  id         TEXT PRIMARY KEY,                       -- sha256 of the cookie token
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX sessions_user ON sessions(user_id);

-- A company is one brand with one Freshchat account and one agent. A user can belong to many.
CREATE TABLE companies (
  id         TEXT PRIMARY KEY,
  slug       TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE memberships (
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL CHECK (role IN ('owner','admin','member','viewer')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (company_id, user_id)
);
CREATE INDEX memberships_user ON memberships(user_id);

CREATE TABLE invites (
  id          TEXT PRIMARY KEY,
  company_id  TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  email       TEXT NOT NULL,
  role        TEXT NOT NULL CHECK (role IN ('admin','member','viewer')),
  token_hash  TEXT NOT NULL UNIQUE,
  invited_by  TEXT NOT NULL REFERENCES users(id),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at  TEXT NOT NULL,
  accepted_at TEXT,
  accepted_by TEXT
);
CREATE INDEX invites_email ON invites(email);
CREATE INDEX invites_company ON invites(company_id);

-- Freshchat credentials for the company. The API key is encrypted with ENCRYPTION_KEY when set.
CREATE TABLE freshchat_connections (
  company_id         TEXT PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  api_base_url       TEXT NOT NULL,
  api_key_enc        TEXT NOT NULL,
  app_id             TEXT,
  reply_agent_id     TEXT,
  reply_agent_name   TEXT,
  webhook_secret     TEXT NOT NULL,                  -- path secret for the account-level webhook URL
  webhook_public_key TEXT,                           -- optional PEM from Freshchat webhook settings
  verified_at        TEXT,
  last_error         TEXT,
  updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Install token for the Freshchat sidebar app. One company can have several (rotate without downtime).
CREATE TABLE sidebar_tokens (
  token_hash   TEXT PRIMARY KEY,
  company_id   TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  label        TEXT NOT NULL DEFAULT 'Freshchat sidebar',
  created_by   TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_used_at TEXT,
  revoked_at   TEXT
);
CREATE INDEX sidebar_tokens_company ON sidebar_tokens(company_id);

CREATE TABLE agent_settings (
  company_id           TEXT PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  mode                 TEXT NOT NULL DEFAULT 'off' CHECK (mode IN ('off','shadow','live')),
  persona              TEXT NOT NULL DEFAULT '',
  confidence_threshold REAL NOT NULL DEFAULT 0.6,
  handoff_keywords     TEXT NOT NULL DEFAULT 'talk to a human, real person, speak to an agent, representative',
  handoff_message      TEXT NOT NULL DEFAULT '',
  debounce_seconds     INTEGER NOT NULL DEFAULT 3,
  updated_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Knowledge is versioned. Exactly one version per company is 'active'; the agent only reads that one.
CREATE TABLE knowledge_versions (
  id           TEXT PRIMARY KEY,
  company_id   TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  number       INTEGER NOT NULL,
  title        TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','archived')),
  chunk_count  INTEGER NOT NULL DEFAULT 0,
  created_by   TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  activated_at TEXT,
  UNIQUE (company_id, number)
);

CREATE TABLE knowledge_docs (
  id          TEXT PRIMARY KEY,
  version_id  TEXT NOT NULL REFERENCES knowledge_versions(id) ON DELETE CASCADE,
  company_id  TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'text',          -- text | file | url
  content     TEXT NOT NULL,
  char_count  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX knowledge_docs_version ON knowledge_docs(version_id);

CREATE TABLE knowledge_chunks (
  id         TEXT PRIMARY KEY,
  version_id TEXT NOT NULL REFERENCES knowledge_versions(id) ON DELETE CASCADE,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  doc_id     TEXT NOT NULL REFERENCES knowledge_docs(id) ON DELETE CASCADE,
  ordinal    INTEGER NOT NULL,
  heading    TEXT NOT NULL DEFAULT '',
  text       TEXT NOT NULL,
  embedding  BLOB,                                   -- Float32Array bytes, or NULL when embeddings are unavailable
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX knowledge_chunks_version ON knowledge_chunks(version_id);

-- Golden tests: questions with the expected answer. Run them against a version before going live.
CREATE TABLE golden_tests (
  id              TEXT PRIMARY KEY,
  company_id      TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  question        TEXT NOT NULL,
  expected        TEXT NOT NULL,
  created_by      TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_result     TEXT,                              -- pass | fail
  last_note       TEXT,
  last_answer     TEXT,
  last_run_at     TEXT,
  last_version_id TEXT
);
CREATE INDEX golden_tests_company ON golden_tests(company_id);

-- One row per Freshchat conversation the company has seen. `state` is the agent-or-human switch.
CREATE TABLE conversations (
  id                       TEXT NOT NULL,           -- Freshchat conversation id
  company_id               TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  state                    TEXT NOT NULL DEFAULT 'agent' CHECK (state IN ('agent','human','resolved')),
  state_reason             TEXT NOT NULL DEFAULT '',
  freshchat_status         TEXT,
  assigned_agent_id        TEXT,
  user_id                  TEXT,
  channel_id               TEXT,
  customer_name            TEXT,
  last_customer_message_at TEXT,
  last_agent_message_at    TEXT,
  last_message_preview     TEXT NOT NULL DEFAULT '',
  turn_count               INTEGER NOT NULL DEFAULT 0,
  needs_attention          INTEGER NOT NULL DEFAULT 0,
  created_at               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (company_id, id)
);
CREATE INDEX conversations_company_updated ON conversations(company_id, updated_at DESC);

CREATE TABLE messages (
  id              TEXT PRIMARY KEY,                 -- Freshchat message id
  company_id      TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL,
  actor_type      TEXT NOT NULL,                    -- user | agent | bot | system
  actor_id        TEXT,
  message_type    TEXT NOT NULL DEFAULT 'normal',   -- normal | private
  text            TEXT NOT NULL,
  created_time    TEXT NOT NULL,
  turn_id         TEXT                              -- set when this message was sent by the agent
);
CREATE INDEX messages_conversation ON messages(company_id, conversation_id, created_time);

-- Every time the agent considered answering. Unique per customer message so retries never double-send.
CREATE TABLE turns (
  id                   TEXT PRIMARY KEY,
  company_id           TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  conversation_id      TEXT NOT NULL,
  customer_message_id  TEXT NOT NULL,
  question             TEXT NOT NULL,
  answer               TEXT NOT NULL DEFAULT '',
  confidence           REAL NOT NULL DEFAULT 0,
  citations_json       TEXT NOT NULL DEFAULT '[]',
  decision             TEXT NOT NULL CHECK (decision IN ('sent','shadow','handoff','error')),
  reason               TEXT NOT NULL DEFAULT '',
  model                TEXT NOT NULL DEFAULT '',
  latency_ms           INTEGER NOT NULL DEFAULT 0,
  freshchat_message_id TEXT,
  knowledge_version_id TEXT,
  created_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (company_id, conversation_id, customer_message_id)
);
CREATE INDEX turns_conversation ON turns(company_id, conversation_id, created_at);

-- Append-only log. The Activity tab and the conversation timeline read from here.
CREATE TABLE events (
  id              TEXT PRIMARY KEY,
  company_id      TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  conversation_id TEXT,
  type            TEXT NOT NULL,
  detail_json     TEXT NOT NULL DEFAULT '{}',
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX events_company ON events(company_id, created_at DESC);
CREATE INDEX events_conversation ON events(company_id, conversation_id, created_at);

-- Daily AI spend guard per company.
CREATE TABLE ai_usage (
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  day        TEXT NOT NULL,
  requests   INTEGER NOT NULL DEFAULT 0,
  tokens     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (company_id, day)
);
