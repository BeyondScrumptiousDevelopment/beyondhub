-- Single-row tables hold the quoting SOP and business settings; every edit is also kept in sop_history.
CREATE TABLE sop (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  content TEXT NOT NULL,
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE sop_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content TEXT NOT NULL,
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  business_name TEXT NOT NULL DEFAULT 'Beyond Scrumptious',
  vat_rate_percent REAL NOT NULL DEFAULT 0,
  deposit_percent REAL NOT NULL DEFAULT 25,
  quote_valid_days INTEGER NOT NULL DEFAULT 14,
  quote_terms TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Prices live here, not in the SOP text, so quoted prices always come from this table.
CREATE TABLE price_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT '',
  unit TEXT NOT NULL DEFAULT 'each',
  price_pence INTEGER NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE enquiries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,             -- 'email' | 'paste'
  submitted_by TEXT,                -- staff member who sent or pasted it
  subject TEXT NOT NULL DEFAULT '',
  raw_text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new', -- 'new' | 'drafting' | 'drafted' | 'error'
  error TEXT,
  received_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE quotes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reference TEXT NOT NULL UNIQUE,
  enquiry_id INTEGER REFERENCES enquiries(id),
  status TEXT NOT NULL DEFAULT 'draft', -- 'draft' | 'sent' | 'accepted' | 'declined'
  client_name TEXT NOT NULL DEFAULT '',
  client_phone TEXT NOT NULL DEFAULT '',
  client_email TEXT NOT NULL DEFAULT '',
  event_type TEXT NOT NULL DEFAULT '',
  event_date TEXT NOT NULL DEFAULT '',
  event_time TEXT NOT NULL DEFAULT '',
  venue TEXT NOT NULL DEFAULT '',
  guests INTEGER,
  summary TEXT NOT NULL DEFAULT '',
  line_items TEXT NOT NULL DEFAULT '[]',     -- JSON array of line items
  discount_pence INTEGER NOT NULL DEFAULT 0,
  vat_rate_percent REAL NOT NULL DEFAULT 0,
  deposit_percent REAL NOT NULL DEFAULT 0,
  subtotal_pence INTEGER NOT NULL DEFAULT 0,
  vat_pence INTEGER NOT NULL DEFAULT 0,
  total_pence INTEGER NOT NULL DEFAULT 0,
  client_notes TEXT NOT NULL DEFAULT '',
  internal_notes TEXT NOT NULL DEFAULT '',
  questions TEXT NOT NULL DEFAULT '[]',      -- JSON array of things still to ask the client
  reply_message TEXT NOT NULL DEFAULT '',
  created_by TEXT,
  updated_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX quotes_updated_at ON quotes(updated_at);
CREATE INDEX enquiries_received_at ON enquiries(received_at);

INSERT INTO settings (id) VALUES (1);
INSERT INTO sop (id, content) VALUES (1, '# Quoting SOP

Replace this with your quoting SOP. Write it the way you would explain it to a new member of staff:

- What you offer and which package suits which kind of event
- How to work out quantities (e.g. portions per guest, hours of service)
- Minimum spends, travel charges, surcharges (weekends, bank holidays, late finishes)
- Discounts and when they apply
- What to ask the client if information is missing
- The tone to use when replying

Prices go in the Price list tab, not here. The assistant can only use prices from that list; anything else is flagged for you to price.');
