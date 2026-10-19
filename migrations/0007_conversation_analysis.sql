-- Dashboard-only QA. No historical conversations are queued by this migration.
CREATE TABLE analysis_settings (
 company_id TEXT PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
 enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
 daily_limit INTEGER NOT NULL DEFAULT 20 CHECK(daily_limit BETWEEN 1 AND 100)
);
CREATE TABLE analysis_jobs (
 company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 conversation_id TEXT NOT NULL,
 due_at TEXT NOT NULL,
 lease_until TEXT,
 attempts INTEGER NOT NULL DEFAULT 0,
 error TEXT,
 PRIMARY KEY(company_id, conversation_id),
 FOREIGN KEY(company_id, conversation_id) REFERENCES conversations(company_id,id) ON DELETE CASCADE
);
CREATE INDEX analysis_jobs_due ON analysis_jobs(due_at);
CREATE TABLE conversation_analyses (
 id TEXT PRIMARY KEY,
 company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 conversation_id TEXT NOT NULL,
 fingerprint TEXT NOT NULL,
 result_json TEXT NOT NULL,
 model TEXT NOT NULL,
 tokens INTEGER NOT NULL,
 review_status TEXT NOT NULL DEFAULT 'pending' CHECK(review_status IN ('pending','approved','rejected')),
 reviewer_id TEXT,
 review_note TEXT NOT NULL DEFAULT '',
 reviewed_at TEXT,
 created_at TEXT NOT NULL,
 UNIQUE(company_id,conversation_id,fingerprint),
 FOREIGN KEY(company_id,conversation_id) REFERENCES conversations(company_id,id) ON DELETE CASCADE
);
CREATE INDEX conversation_analyses_company ON conversation_analyses(company_id,created_at DESC);
CREATE TABLE analysis_usage (
 company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 day TEXT NOT NULL,
 requests INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(company_id,day)
);
CREATE TRIGGER analysis_new_message AFTER INSERT ON messages
WHEN NEW.message_type='normal' AND NEW.actor_type IN ('user','agent','bot') AND length(trim(NEW.text))>0
 AND EXISTS(SELECT 1 FROM analysis_settings WHERE company_id=NEW.company_id AND enabled=1)
BEGIN
 INSERT INTO analysis_jobs(company_id,conversation_id,due_at)
 VALUES(NEW.company_id,NEW.conversation_id,strftime('%Y-%m-%dT%H:%M:%fZ','now','+15 minutes'))
 ON CONFLICT(company_id,conversation_id) DO UPDATE SET due_at=excluded.due_at, attempts=0,error=NULL;
END;
CREATE TRIGGER analysis_edited_message AFTER UPDATE OF text ON messages
WHEN NEW.text!=OLD.text AND NEW.message_type='normal' AND NEW.actor_type IN ('user','agent','bot')
 AND EXISTS(SELECT 1 FROM analysis_settings WHERE company_id=NEW.company_id AND enabled=1)
BEGIN
 INSERT INTO analysis_jobs(company_id,conversation_id,due_at)
 VALUES(NEW.company_id,NEW.conversation_id,strftime('%Y-%m-%dT%H:%M:%fZ','now','+15 minutes'))
 ON CONFLICT(company_id,conversation_id) DO UPDATE SET due_at=excluded.due_at,attempts=0,error=NULL;
END;
CREATE TRIGGER analysis_resolved AFTER UPDATE OF freshchat_status ON conversations
WHEN NEW.freshchat_status='resolved' AND COALESCE(OLD.freshchat_status,'')!='resolved'
 AND EXISTS(SELECT 1 FROM analysis_settings WHERE company_id=NEW.company_id AND enabled=1)
BEGIN
 INSERT INTO analysis_jobs(company_id,conversation_id,due_at) VALUES(NEW.company_id,NEW.id,strftime('%Y-%m-%dT%H:%M:%fZ','now','+1 minute'))
 ON CONFLICT(company_id,conversation_id) DO UPDATE SET due_at=excluded.due_at,attempts=0,error=NULL;
END;
