-- Owner answer (3 Nov 2026): croffle bookings take a 25% deposit, like pancakes.
-- Uses REPLACE so any other edits made to the SOP in the app are kept.
UPDATE sop SET
  content = REPLACE(
    REPLACE(content,
      '- **Live Croffle Station:** no deposit rule has been set. Set no deposit, and flag it for the owner in internal notes.',
      '- **Live Croffle Station:** 25% deposit to secure the date. Set the deposit to 25% and state the amount in the reply.'),
    'Total quotation: £[total]
```',
    'Total quotation: £[total]
Deposit: £[25% of total] to secure the date
```'),
  updated_by = 'owner answer 3 Nov 2026',
  updated_at = datetime('now')
WHERE id = 1;
INSERT INTO sop_history (content, updated_by) SELECT content, updated_by FROM sop WHERE id = 1;
