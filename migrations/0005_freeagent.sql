-- Connection to FreeAgent (one row). The refresh token is useless without the app's client secret,
-- which is stored as a Worker secret, not in the database.
CREATE TABLE integrations (
  id TEXT PRIMARY KEY,
  access_token TEXT,
  refresh_token TEXT,
  expires_at INTEGER,
  company_subdomain TEXT,
  connected_by TEXT,
  connected_at TEXT,
  pending_state TEXT,
  pending_state_expires_at INTEGER
);

-- 'sending' while a send is in progress, 'sent' once the estimate exists in FreeAgent.
ALTER TABLE quotes ADD COLUMN freeagent_status TEXT;
ALTER TABLE quotes ADD COLUMN freeagent_url TEXT;
ALTER TABLE quotes ADD COLUMN freeagent_sent_at TEXT;
