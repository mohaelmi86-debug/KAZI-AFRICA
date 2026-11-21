ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS event_key text;

CREATE UNIQUE INDEX IF NOT EXISTS notifications_event_key_unique_idx
  ON notifications(event_key);
