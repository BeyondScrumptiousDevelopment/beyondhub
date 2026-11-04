import type { QuoteRow } from './db';
import type { LineItem } from './pricing';
import { computeTotals } from './pricing';
import { UserError } from './security';

export const INVOICE_KINDS = ['deposit', 'balance', 'full'] as const;
export type InvoiceKind = (typeof INVOICE_KINDS)[number];

/** What an invoice shows about its quote, frozen when the invoice is issued. */
export interface InvoiceSnapshot {
  quote_reference: string;
  client_name: string;
  client_address: string;
  client_email: string;
  client_phone: string;
  event_type: string;
  event_date: string;
  event_time: string;
  venue: string;
  guests: number | null;
  line_items: LineItem[];
  discount_pence: number;
  vat_rate_percent: number;
  subtotal_pence: number;
  vat_pence: number;
  total_pence: number;
  deposit_pence: number;
  client_notes: string;
}

export interface InvoiceRow {
  id: number;
  number: string;
  quote_id: number;
  kind: InvoiceKind;
  status: 'issued' | 'paid' | 'void';
  issued_on: string;
  due_on: string;
  paid_on: string;
  total_pence: number;
  deposit_paid_pence: number;
  deposit_paid_on: string;
  amount_due_pence: number;
  snapshot: string;
  freeagent_status: string | null;
  freeagent_url: string | null;
  freeagent_sent_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_by: string | null;
  updated_at: string;
}

export function snapshotQuote(q: QuoteRow): InvoiceSnapshot {
  const items = JSON.parse(q.line_items) as LineItem[];
  const t = computeTotals(items, q.discount_pence, q.vat_rate_percent, q.deposit_percent, q.deposit_fixed_pence);
  return {
    quote_reference: q.reference,
    client_name: q.client_name,
    client_address: q.client_address,
    client_email: q.client_email,
    client_phone: q.client_phone,
    event_type: q.event_type,
    event_date: q.event_date,
    event_time: q.event_time,
    venue: q.venue,
    guests: q.guests,
    line_items: items,
    discount_pence: q.discount_pence,
    vat_rate_percent: q.vat_rate_percent,
    subtotal_pence: t.subtotal_pence,
    vat_pence: t.vat_pence,
    total_pence: t.total_pence,
    deposit_pence: t.deposit_pence,
    client_notes: q.client_notes,
  };
}

async function nextInvoiceNumber(db: D1Database): Promise<string> {
  const row = await db
    .prepare("SELECT MAX(CAST(substr(number, 5) AS INTEGER)) AS n FROM invoices WHERE number LIKE 'INV-%'")
    .first<{ n: number | null }>();
  return `INV-${String((row?.n ?? 0) + 1).padStart(4, '0')}`;
}

export interface NewInvoice {
  kind: InvoiceKind;
  issued_on: string;
  due_on: string;
  /** Balance invoices only: what was already paid, and when. */
  deposit_paid_pence?: number;
  deposit_paid_on?: string;
}

/** Works out what a balance invoice should deduct: a paid deposit invoice for the same quote, if there is one. */
export async function paidDeposit(db: D1Database, quoteId: number) {
  return db
    .prepare(
      `SELECT amount_due_pence, paid_on, number FROM invoices
       WHERE quote_id = ? AND kind = 'deposit' AND status = 'paid' ORDER BY id DESC LIMIT 1`,
    )
    .bind(quoteId)
    .first<{ amount_due_pence: number; paid_on: string; number: string }>();
}

export async function createInvoice(db: D1Database, quote: QuoteRow, input: NewInvoice, by: string): Promise<number> {
  if (quote.status !== 'accepted') throw new UserError('Only accepted quotes can be invoiced. Set the quote to accepted first.', 409);
  const snapshot = snapshotQuote(quote);
  if (!snapshot.line_items.length || snapshot.total_pence <= 0) throw new UserError('This quote has nothing to invoice yet.');
  if (!snapshot.client_name.trim()) throw new UserError("Add the client's name to the quote first.");
  if (input.due_on < input.issued_on) throw new UserError("The due date can't be before the invoice date.");

  // One deposit and one balance invoice per quote, or a single full invoice (void ones don't count).
  const { results: existing } = await db
    .prepare("SELECT kind FROM invoices WHERE quote_id = ? AND status <> 'void'")
    .bind(quote.id)
    .all<{ kind: InvoiceKind }>();
  const kinds = new Set(existing.map((r) => r.kind));
  if (kinds.has('full') || kinds.has(input.kind) || (input.kind === 'full' && kinds.size > 0)) {
    throw new UserError('This quote already has that invoice. Void the old one first if it needs reissuing.', 409);
  }

  let amountDue: number;
  let depositPaid = 0;
  let depositPaidOn = '';
  if (input.kind === 'deposit') {
    if (snapshot.deposit_pence <= 0 || snapshot.deposit_pence >= snapshot.total_pence) {
      throw new UserError('This quote has no separate deposit. Issue a full invoice instead.');
    }
    amountDue = snapshot.deposit_pence;
  } else if (input.kind === 'balance') {
    depositPaid = Math.max(0, Math.round(input.deposit_paid_pence ?? 0));
    depositPaidOn = input.deposit_paid_on ?? '';
    if (depositPaid <= 0) throw new UserError('Enter the deposit that was paid, or issue a full invoice instead.');
    if (depositPaid >= snapshot.total_pence) throw new UserError('The deposit paid covers the whole total, so there is no balance to invoice.');
    amountDue = snapshot.total_pence - depositPaid;
  } else {
    amountDue = snapshot.total_pence;
  }

  // Retry on the rare clash when two invoices are issued at the same moment.
  for (let attempt = 0; ; attempt++) {
    const number = await nextInvoiceNumber(db);
    try {
      const row = await db
        .prepare(
          `INSERT INTO invoices (number, quote_id, kind, issued_on, due_on, total_pence, deposit_paid_pence, deposit_paid_on,
             amount_due_pence, snapshot, created_by, updated_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
        )
        .bind(
          number, quote.id, input.kind, input.issued_on, input.due_on, snapshot.total_pence, depositPaid, depositPaidOn,
          amountDue, JSON.stringify(snapshot), by, by,
        )
        .first<{ id: number }>();
      return row!.id;
    } catch (err) {
      if (attempt >= 3 || !String(err).includes('UNIQUE')) throw err;
    }
  }
}

export function invoiceToJson(row: InvoiceRow) {
  return { ...row, snapshot: JSON.parse(row.snapshot) as InvoiceSnapshot };
}
