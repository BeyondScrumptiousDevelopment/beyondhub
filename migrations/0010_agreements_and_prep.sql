-- Booking Agreements: generated from an accepted quote, signed online by the client.
-- The wording below is a starting point built from the quoting SOP; review it (and ideally have it
-- checked) under Settings → Booking agreement before relying on it.
ALTER TABLE settings ADD COLUMN terms_url TEXT NOT NULL DEFAULT 'https://www.beyondscrumptious.com/terms-and-conditions';
ALTER TABLE settings ADD COLUMN agreement_template TEXT NOT NULL DEFAULT '## The booking
{{business_name}} will provide the items and services listed in this agreement for {{client_name}}''s {{event_type}} on {{event_date}} at {{venue}}, as set out in quote {{quote_reference}}.

## Payment
{{payment_schedule}}

Your booking is confirmed once this agreement is signed and the deposit (or full payment, where no deposit applies) has been received. Please use the invoice number as your payment reference.

## Changes
Changes to guest numbers, quantities or services must be agreed with us in writing and may change the price. For live stations, changes requested within 14 days of the event cannot be guaranteed. Where a final quantity is required, it must be confirmed at least 14 days before the event; after that date, reductions do not reduce the agreed price.

## Venue and setup
You agree to arrange suitable access for loading and unloading, enough working space, and a power supply where needed (for live stations, a 6ft table and power within about 5 metres). For outdoor events, you agree to provide shelter from rain, heat, direct sunlight and strong wind. Setup and pack-down time are separate from the service period. Extra serving time requested on the day depends on staff availability and may be charged.

## Allergies and dietary needs
Please tell us about any allergies or dietary requirements in writing before the event. We cannot guarantee allergen-free food or a separate cooking surface unless we have agreed this with you in writing.

## Cancellations
Cancellations and refunds are handled under our Terms & Conditions: {{terms_url}}

## Our terms
This agreement should be read together with our Terms & Conditions ({{terms_url}}), quote {{quote_reference}} and your invoices.';

CREATE TABLE agreements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number TEXT NOT NULL UNIQUE,               -- BA-0001
  quote_id INTEGER NOT NULL REFERENCES quotes(id),
  status TEXT NOT NULL DEFAULT 'sent',       -- 'sent' (awaiting signature) | 'signed' | 'void'
  content TEXT NOT NULL,                     -- JSON: the agreement exactly as the client sees it
  content_hash TEXT NOT NULL,                -- SHA-256 of content, recorded with the signature
  token_hash TEXT NOT NULL UNIQUE,           -- SHA-256 of the private signing link; the link itself isn't stored
  expires_at TEXT NOT NULL,
  signed_name TEXT NOT NULL DEFAULT '',
  signed_at TEXT NOT NULL DEFAULT '',
  signed_ip TEXT NOT NULL DEFAULT '',
  signed_user_agent TEXT NOT NULL DEFAULT '',
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX agreements_quote ON agreements(quote_id);

-- Event prep sheets: one per quote, edited by staff, partly filled by Claude from the chat.
CREATE TABLE prep_sheets (
  quote_id INTEGER PRIMARY KEY REFERENCES quotes(id),
  data TEXT NOT NULL DEFAULT '{}',
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
