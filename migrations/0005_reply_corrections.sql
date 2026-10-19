CREATE TABLE reply_corrections (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  source_version_id TEXT NOT NULL,
  doc_id TEXT,
  title TEXT NOT NULL,
  before_text TEXT NOT NULL,
  after_text TEXT NOT NULL,
  question TEXT NOT NULL,
  original_answer TEXT NOT NULL,
  corrected_answer TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_by TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'published')),
  published_version_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Checked inside the publication transaction, before changing the active version.
CREATE TRIGGER correction_source_is_current BEFORE UPDATE OF status ON reply_corrections
WHEN NEW.status = 'published' AND OLD.status = 'proposed'
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM knowledge_versions
    WHERE id = NEW.source_version_id AND company_id = NEW.company_id AND status = 'active'
  ) THEN RAISE(ABORT, 'Knowledge changed. Preview the correction again.') END;
END;
