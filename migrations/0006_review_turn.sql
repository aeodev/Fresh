-- Uncertain replies stay available for review without transferring conversation ownership.
CREATE TABLE turns_next (
  id                   TEXT PRIMARY KEY,
  company_id           TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  conversation_id      TEXT NOT NULL,
  customer_message_id  TEXT NOT NULL,
  question             TEXT NOT NULL,
  answer               TEXT NOT NULL DEFAULT '',
  confidence           REAL NOT NULL DEFAULT 0,
  citations_json       TEXT NOT NULL DEFAULT '[]',
  decision             TEXT NOT NULL CHECK (decision IN ('sent','shadow','handoff','error','silent','review')),
  reason               TEXT NOT NULL DEFAULT '',
  model                TEXT NOT NULL DEFAULT '',
  latency_ms           INTEGER NOT NULL DEFAULT 0,
  freshchat_message_id TEXT,
  knowledge_version_id TEXT,
  created_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (company_id, conversation_id, customer_message_id)
);
INSERT INTO turns_next SELECT * FROM turns;
DROP TABLE turns;
ALTER TABLE turns_next RENAME TO turns;
CREATE INDEX turns_conversation ON turns(company_id, conversation_id, created_at);
