import type { QuoteRow, Settings } from './db';
import type { LineItem } from './pricing';
import { computeTotals } from './pricing';
import { UserError } from './security';

/** The agreement exactly as the client sees and signs it, frozen when it is created. */
export interface AgreementContent {
  number: string;
  business_name: string;
  created_on: string;
  quote_reference: string;
  client_name: string;
  client_email: string;
  client_phone: string;
  client_address: string;
  event_type: string;
  event_date: string;
  event_time: string;
  venue: string;
  guests: number | null;
  items: { description: string; quantity: number; unit: string; amount_pence: number }[];
  total_pence: number;
  deposit_pence: number;
  balance_pence: number;
  balance_due: string;
  sections: { heading: string; paragraphs: string[] }[];
}

export interface AgreementRow {
  id: number;
  number: string;
  quote_id: number;
  status: 'sent' | 'signed' | 'void';
  content: string;
  content_hash: string;
  token_hash: string;
  expires_at: string;
  signed_name: string;
  signed_at: string;
  signed_ip: string;
  signed_user_agent: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

const LINK_DAYS = 60;

const pounds = (pence: number) =>
  `£${(pence / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function longDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  if (!m) return '';
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  });
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** A private, unguessable link token (192 bits). Only its hash is stored. */
function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export const tokenHash = sha256;

function paymentSchedule(total: number, deposit: number, balanceDue: string): string {
  const by = balanceDue ? `by ${longDate(balanceDue)}` : 'before the event';
  if (deposit > 0 && deposit < total) {
    return `The total is ${pounds(total)}. A deposit of ${pounds(deposit)} is due to secure your date, and the balance of ${pounds(total - deposit)} is due ${by}.`;
  }
  if (deposit >= total && total > 0) return `The total of ${pounds(total)} is due in full to confirm your order.`;
  return `The total is ${pounds(total)}, due ${by}.`;
}

/** Fills the template's {{placeholders}} and splits it into "## Heading" sections and paragraphs. */
export function buildContent(quote: QuoteRow, settings: Settings & { agreement_template: string; terms_url: string }, number: string): AgreementContent {
  const items = JSON.parse(quote.line_items) as LineItem[];
  const t = computeTotals(items, quote.discount_pence, quote.vat_rate_percent, quote.deposit_percent, quote.deposit_fixed_pence);
  const deposit = t.deposit_pence;
  const values: Record<string, string> = {
    business_name: settings.business_name,
    client_name: quote.client_name || 'the client',
    event_type: quote.event_type || 'event',
    event_date: longDate(quote.event_date) || 'the agreed date',
    event_time: quote.event_time,
    venue: quote.venue || 'the agreed venue',
    guests: quote.guests ? String(quote.guests) : '',
    quote_reference: quote.reference,
    total: pounds(t.total_pence),
    deposit: pounds(deposit),
    balance: pounds(Math.max(0, t.total_pence - deposit)),
    balance_due_date: longDate(quote.final_payment_due),
    terms_url: settings.terms_url,
    payment_schedule: paymentSchedule(t.total_pence, deposit, quote.final_payment_due),
  };
  const fill = (s: string) => s.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_, key: string) => values[key] ?? '');

  const sections: AgreementContent['sections'] = [];
  let current: AgreementContent['sections'][number] | null = null;
  for (const block of settings.agreement_template.replace(/\r/g, '').split(/\n\s*\n|\n(?=## )/)) {
    const text = block.trim();
    if (!text) continue;
    const heading = /^##\s+(.*)$/m.exec(text);
    if (heading && text.startsWith('##')) {
      current = { heading: fill(heading[1].trim()), paragraphs: [] };
      sections.push(current);
      const rest = text.slice(text.indexOf('\n') + 1).trim();
      if (text.includes('\n') && rest) current.paragraphs.push(fill(rest.replace(/\s*\n\s*/g, ' ')));
    } else {
      if (!current) { current = { heading: '', paragraphs: [] }; sections.push(current); }
      current.paragraphs.push(fill(text.replace(/\s*\n\s*/g, ' ')));
    }
  }

  return {
    number,
    business_name: settings.business_name,
    created_on: new Date().toISOString().slice(0, 10),
    quote_reference: quote.reference,
    client_name: quote.client_name,
    client_email: quote.client_email,
    client_phone: quote.client_phone,
    client_address: quote.client_address,
    event_type: quote.event_type,
    event_date: quote.event_date,
    event_time: quote.event_time,
    venue: quote.venue,
    guests: quote.guests,
    items: items.map((i) => ({
      description: i.description, quantity: i.quantity, unit: i.unit, amount_pence: Math.round(i.quantity * i.unit_price_pence),
    })),
    total_pence: t.total_pence,
    deposit_pence: deposit < t.total_pence ? deposit : 0,
    balance_pence: deposit < t.total_pence ? t.total_pence - deposit : 0,
    balance_due: quote.final_payment_due,
    sections,
  };
}

async function nextAgreementNumber(db: D1Database): Promise<string> {
  const row = await db
    .prepare("SELECT MAX(CAST(substr(number, 4) AS INTEGER)) AS n FROM agreements WHERE number LIKE 'BA-%'")
    .first<{ n: number | null }>();
  return `BA-${String((row?.n ?? 0) + 1).padStart(4, '0')}`;
}

/** Creates the agreement and returns its private signing link token (shown once; only its hash is kept). */
export async function createAgreement(
  db: D1Database,
  quote: QuoteRow,
  settings: Settings & { agreement_template: string; terms_url: string },
  by: string,
): Promise<{ id: number; token: string }> {
  if (quote.status !== 'accepted') throw new UserError('Set the quote to accepted before creating a booking agreement.', 409);
  if (!quote.client_name.trim()) throw new UserError("Add the client's name to the quote first.");
  if (!quote.event_date) throw new UserError('Add the event date to the quote first.');
  const open = await db
    .prepare("SELECT number FROM agreements WHERE quote_id = ? AND status IN ('sent', 'signed')")
    .bind(quote.id)
    .first<{ number: string }>();
  if (open) throw new UserError(`This booking already has agreement ${open.number}. Void it first to issue a new one.`, 409);

  for (let attempt = 0; ; attempt++) {
    const number = await nextAgreementNumber(db);
    const content = JSON.stringify(buildContent(quote, settings, number));
    const token = newToken();
    try {
      const row = await db
        .prepare(
          `INSERT INTO agreements (number, quote_id, content, content_hash, token_hash, expires_at, created_by)
           VALUES (?, ?, ?, ?, ?, datetime('now', ?), ?) RETURNING id`,
        )
        .bind(number, quote.id, content, await sha256(content), await sha256(token), `+${LINK_DAYS} days`, by)
        .first<{ id: number }>();
      return { id: row!.id, token };
    } catch (err) {
      if (attempt >= 3 || !String(err).includes('UNIQUE')) throw err;
    }
  }
}

/** Replaces the signing link (the old one stops working) and extends it by another LINK_DAYS days. */
export async function renewLink(db: D1Database, id: number): Promise<string> {
  const token = newToken();
  const result = await db
    .prepare(
      `UPDATE agreements SET token_hash = ?, expires_at = datetime('now', ?), updated_at = datetime('now')
       WHERE id = ? AND status = 'sent'`,
    )
    .bind(await sha256(token), `+${LINK_DAYS} days`, id)
    .run();
  if (!result.meta.changes) throw new UserError('Only agreements waiting for a signature have a link.', 409);
  return token;
}

export async function findByToken(db: D1Database, token: string): Promise<AgreementRow | null> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  return db.prepare('SELECT * FROM agreements WHERE token_hash = ?').bind(await sha256(token)).first<AgreementRow>();
}

export function agreementToJson(row: AgreementRow) {
  const { token_hash: _hidden, ...rest } = row;
  return { ...rest, content: JSON.parse(row.content) as AgreementContent };
}
