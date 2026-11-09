-- One invoice can carry a deposit and a balance ("scheduled"), and any invoice can be paid in parts.
ALTER TABLE invoices ADD COLUMN deposit_pence INTEGER NOT NULL DEFAULT 0;    -- scheduled invoices: the deposit part
ALTER TABLE invoices ADD COLUMN deposit_due_on TEXT NOT NULL DEFAULT '';     -- scheduled invoices: when the deposit is due
ALTER TABLE invoices ADD COLUMN paid_pence INTEGER NOT NULL DEFAULT 0;       -- sum of recorded payments
-- status is now 'issued' (nothing paid), 'part_paid', 'paid' or 'void'.

CREATE TABLE invoice_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id),
  amount_pence INTEGER NOT NULL,
  paid_on TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX invoice_payments_invoice ON invoice_payments(invoice_id);

-- Invoices already marked paid become one payment of their full amount.
INSERT INTO invoice_payments (invoice_id, amount_pence, paid_on, note)
  SELECT id, amount_due_pence, paid_on, 'Recorded as paid before part payments existed' FROM invoices WHERE status = 'paid';
UPDATE invoices SET paid_pence = amount_due_pence WHERE status = 'paid';
