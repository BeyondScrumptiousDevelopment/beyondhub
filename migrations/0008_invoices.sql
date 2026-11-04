-- Invoices are issued from the app on the Beyond Scrumptious template; FreeAgent is used for the accounts.

-- Details printed on quotes and invoices (bank details are editable by admins only).
ALTER TABLE settings ADD COLUMN contact_lines TEXT NOT NULL DEFAULT 'beyondscrumptious.com
hello@beyondscrumptious.com
WhatsApp 07933 903000
@beyond.scrumptious';
ALTER TABLE settings ADD COLUMN footer_tagline TEXT NOT NULL DEFAULT 'EGGLESS · VEGAN OPTIONS · ACROSS LONDON';
ALTER TABLE settings ADD COLUMN questions_email TEXT NOT NULL DEFAULT 'hello@beyondscrumptious.com';
ALTER TABLE settings ADD COLUMN bank_account_name TEXT NOT NULL DEFAULT '';
ALTER TABLE settings ADD COLUMN bank_sort_code TEXT NOT NULL DEFAULT '';
ALTER TABLE settings ADD COLUMN bank_account_number TEXT NOT NULL DEFAULT '';

ALTER TABLE quotes ADD COLUMN client_address TEXT NOT NULL DEFAULT '';

-- An invoice is a frozen copy of its quote at the moment it was issued, so later edits to the
-- quote never change an invoice that has gone out. Invoices are voided, never deleted, so
-- numbers are never reused.
CREATE TABLE invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number TEXT NOT NULL UNIQUE,                 -- INV-0001
  quote_id INTEGER NOT NULL REFERENCES quotes(id),
  kind TEXT NOT NULL,                          -- 'deposit' | 'balance' | 'full'
  status TEXT NOT NULL DEFAULT 'issued',       -- 'issued' | 'paid' | 'void'
  issued_on TEXT NOT NULL,
  due_on TEXT NOT NULL,
  paid_on TEXT NOT NULL DEFAULT '',
  total_pence INTEGER NOT NULL,                -- the quote total
  deposit_paid_pence INTEGER NOT NULL DEFAULT 0,
  deposit_paid_on TEXT NOT NULL DEFAULT '',
  amount_due_pence INTEGER NOT NULL,
  snapshot TEXT NOT NULL,                      -- JSON copy of the client, event and lines
  freeagent_status TEXT,                       -- 'sending' | 'sent'
  freeagent_url TEXT,
  freeagent_sent_at TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX invoices_quote ON invoices(quote_id);
