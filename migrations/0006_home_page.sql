-- When each quote last changed status, so the home page can count e.g. "accepted this month".
ALTER TABLE quotes ADD COLUMN status_changed_at TEXT;
UPDATE quotes SET status_changed_at = updated_at;
