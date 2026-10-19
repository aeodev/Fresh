-- A chat can send only after someone explicitly turns it on in the Freshchat sidebar.
-- Existing conversations deliberately remain unapproved.
ALTER TABLE conversations ADD COLUMN sidebar_enabled_at TEXT;
