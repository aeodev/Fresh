-- Human-paced sending: 'instant' posts as soon as the draft is ready; 'natural' waits as long as a person
-- would take to read the question and type the answer (capped), so replies do not land in 2 seconds.
ALTER TABLE agent_settings ADD COLUMN typing_pace TEXT NOT NULL DEFAULT 'natural' CHECK (typing_pace IN ('instant','natural'));
