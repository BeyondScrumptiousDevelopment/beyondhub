import type { QuoteDraft } from './claude';
import type { LineItem, PriceItem } from './pricing';
import { applyPriceList, computeTotals } from './pricing';

export interface Settings {
  business_name: string;
  vat_rate_percent: number;
  deposit_percent: number;
  quote_valid_days: number;
  quote_terms: string;
}

export interface QuoteRow {
  id: number;
  reference: string;
  enquiry_id: number | null;
  status: string;
  client_name: string;
  client_phone: string;
  client_email: string;
  event_type: string;
  event_date: string;
  event_time: string;
  venue: string;
  guests: number | null;
  summary: string;
  line_items: string;
  discount_pence: number;
  vat_rate_percent: number;
  deposit_percent: number;
  deposit_fixed_pence: number | null;
  subtotal_pence: number;
  vat_pence: number;
  total_pence: number;
  client_notes: string;
  internal_notes: string;
  questions: string;
  reply_message: string;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export const QUOTE_STATUSES = ['draft', 'sent', 'accepted', 'declined'] as const;

export async function getSop(db: D1Database): Promise<string> {
  const row = await db.prepare('SELECT content FROM sop WHERE id = 1').first<{ content: string }>();
  return row?.content ?? '';
}

export async function getSettings(db: D1Database): Promise<Settings> {
  const row = await db
    .prepare('SELECT business_name, vat_rate_percent, deposit_percent, quote_valid_days, quote_terms FROM settings WHERE id = 1')
    .first<Settings>();
  if (!row) throw new Error('Settings row missing: run the database migrations.');
  return row;
}

export async function getPriceList(db: D1Database, includeInactive = false): Promise<PriceItem[]> {
  const sql = `SELECT id, name, category, unit, price_pence, notes, active FROM price_items
    ${includeInactive ? '' : 'WHERE active = 1'} ORDER BY category, name`;
  const { results } = await db.prepare(sql).all<PriceItem>();
  return results;
}

async function nextReference(db: D1Database): Promise<string> {
  const year = new Date().getUTCFullYear();
  const prefix = `Q-${year}-`;
  const row = await db
    .prepare('SELECT MAX(CAST(substr(reference, ?) AS INTEGER)) AS n FROM quotes WHERE reference LIKE ?')
    .bind(prefix.length + 1, `${prefix}%`)
    .first<{ n: number | null }>();
  return `${prefix}${String((row?.n ?? 0) + 1).padStart(4, '0')}`;
}

export async function createQuoteFromDraft(
  db: D1Database,
  enquiryId: number | null,
  draft: QuoteDraft,
  createdBy: string,
): Promise<number> {
  const [settings, priceList] = await Promise.all([getSettings(db), getPriceList(db)]);
  const items = applyPriceList(draft.line_items, priceList);
  // The SOP decides the deposit for each kind of order; fall back to the settings default.
  const depositPercent = draft.deposit_percent ?? settings.deposit_percent;
  const totals = computeTotals(items, 0, settings.vat_rate_percent, depositPercent, draft.deposit_fixed_pence);

  // Retry on the rare clash when two quotes are created at the same moment.
  for (let attempt = 0; ; attempt++) {
    const reference = await nextReference(db);
    try {
      const row = await db
        .prepare(
          `INSERT INTO quotes (reference, enquiry_id, client_name, client_phone, client_email, event_type,
            event_date, event_time, venue, guests, summary, line_items, vat_rate_percent, deposit_percent,
            deposit_fixed_pence, subtotal_pence, vat_pence, total_pence, client_notes, internal_notes, questions, reply_message,
            created_by, updated_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
        )
        .bind(
          reference, enquiryId, draft.client_name, draft.client_phone, draft.client_email, draft.event_type,
          draft.event_date, draft.event_time, draft.venue, draft.guests, draft.summary, JSON.stringify(items),
          settings.vat_rate_percent, depositPercent, draft.deposit_fixed_pence, totals.subtotal_pence, totals.vat_pence,
          totals.total_pence, draft.client_notes, draft.internal_notes, JSON.stringify(draft.questions),
          draft.reply_message, createdBy, createdBy,
        )
        .first<{ id: number }>();
      return row!.id;
    } catch (err) {
      if (attempt >= 3 || !String(err).includes('UNIQUE')) throw err;
    }
  }
}

export interface QuoteUpdate {
  status: string;
  client_name: string;
  client_phone: string;
  client_email: string;
  event_type: string;
  event_date: string;
  event_time: string;
  venue: string;
  guests: number | null;
  summary: string;
  line_items: LineItem[];
  discount_pence: number;
  vat_rate_percent: number;
  deposit_percent: number;
  deposit_fixed_pence: number | null;
  client_notes: string;
  internal_notes: string;
  questions: string[];
  reply_message: string;
}

export async function updateQuote(db: D1Database, id: number, q: QuoteUpdate, updatedBy: string): Promise<boolean> {
  const totals = computeTotals(q.line_items, q.discount_pence, q.vat_rate_percent, q.deposit_percent, q.deposit_fixed_pence);
  const result = await db
    .prepare(
      `UPDATE quotes SET status = ?, client_name = ?, client_phone = ?, client_email = ?, event_type = ?,
        event_date = ?, event_time = ?, venue = ?, guests = ?, summary = ?, line_items = ?, discount_pence = ?,
        vat_rate_percent = ?, deposit_percent = ?, deposit_fixed_pence = ?, subtotal_pence = ?, vat_pence = ?, total_pence = ?,
        client_notes = ?, internal_notes = ?, questions = ?, reply_message = ?, updated_by = ?,
        updated_at = datetime('now')
       WHERE id = ?`,
    )
    .bind(
      q.status, q.client_name, q.client_phone, q.client_email, q.event_type, q.event_date, q.event_time,
      q.venue, q.guests, q.summary, JSON.stringify(q.line_items), q.discount_pence, q.vat_rate_percent,
      q.deposit_percent, q.deposit_fixed_pence, totals.subtotal_pence, totals.vat_pence, totals.total_pence, q.client_notes,
      q.internal_notes, JSON.stringify(q.questions), q.reply_message, updatedBy, id,
    )
    .run();
  return result.meta.changes > 0;
}
