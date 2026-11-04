-- Invoice numbering: prefix + zero-padded number, e.g. INV-0046. When FreeAgent is connected the
-- app follows FreeAgent's own sequence, so the PDF and FreeAgent always show the same number.
ALTER TABLE settings ADD COLUMN invoice_prefix TEXT NOT NULL DEFAULT 'INV-';
ALTER TABLE settings ADD COLUMN invoice_next_number INTEGER NOT NULL DEFAULT 1;
ALTER TABLE settings ADD COLUMN invoice_number_width INTEGER NOT NULL DEFAULT 4;
UPDATE settings SET invoice_next_number =
  COALESCE((SELECT MAX(CAST(substr(number, 5) AS INTEGER)) FROM invoices WHERE number LIKE 'INV-%'), 0) + 1;
