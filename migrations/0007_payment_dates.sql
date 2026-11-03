-- When the final payment is due, and the rule it came from ('pancake', 'cake', 'custom' or 'none';
-- empty until someone picks one).
ALTER TABLE quotes ADD COLUMN final_payment_due TEXT NOT NULL DEFAULT '';
ALTER TABLE quotes ADD COLUMN payment_rule TEXT;

-- Owner answer (3 Nov 2026): the pancake station balance is due 1 month before the event.
-- REPLACE keeps any other edits made to the SOP in the app.
UPDATE sop SET
  content = REPLACE(
    REPLACE(content,
      '- **Live Mini Pancake Station:** 25% deposit to secure the date. Set the deposit to 25% and state the amount in the reply.',
      '- **Live Mini Pancake Station:** 25% deposit to secure the date. Set the deposit to 25% and state the amount in the reply. The balance is due **1 month before the event date**; state that date in the reply.'),
    'Additional: [Travel / approved premium extras / customisation, where applicable]
Deposit: £[25% of total] to secure the date',
    'Additional: [Travel / approved premium extras / customisation, where applicable]
Deposit: £[25% of total] to secure the date
Balance: £[remaining 75%] due by [date one month before the event]'),
  updated_by = 'owner answer 3 Nov 2026',
  updated_at = datetime('now')
WHERE id = 1;
INSERT INTO sop_history (content, updated_by) SELECT content, updated_by FROM sop WHERE id = 1;
