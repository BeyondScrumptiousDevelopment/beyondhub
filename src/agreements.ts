import type { QuoteRow, Settings } from './db';
import type { LineItem } from './pricing';
import { computeTotals } from './pricing';
import { UserError } from './security';
import type { PrepData } from './prep';

export type AgreementBlock =
  | { type: 'p'; text: string }
  | { type: 'fields'; rows: [string, string][] }
  | { type: 'list'; items: string[] }
  | { type: 'payments'; rows: [string, string, string][]; total: string };

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
  service_name: string;
  sections: { number: string; heading: string; blocks: AgreementBlock[] }[];
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

const TBC = 'To be confirmed';
const orTbc = (v: unknown) => (String(v ?? '').trim() ? String(v).trim() : TBC);

function serviceFor(items: LineItem[], eventType: string) {
  const text = items.map((i) => i.description).join(' | ');
  if (/pancake station/i.test(text)) return { name: 'Live Mini Pancake Station', food: 'mini pancakes cooked fresh on-site', product: 'pancake' };
  if (/croffle/i.test(text)) return { name: 'Live Croffle Station', food: 'croffles prepared fresh on-site', product: 'croffle' };
  if (/\bcake\b/i.test(text)) return { name: 'celebration cake order', food: 'a handmade cake prepared', product: 'cake' };
  return { name: eventType || 'booking', food: 'the agreed items prepared', product: 'other' };
}

/** "6pm–8pm" or "18:00 - 20:00" into start and finish. */
function splitTimes(value: string): [string, string] {
  const parts = value.split(/\s*(?:–|—|-|to)\s*/i).map((p) => p.trim()).filter(Boolean);
  return parts.length >= 2 ? [parts[0], parts[1]] : [value.trim(), ''];
}

/** Separates a phone number from "Raj (venue manager) 07700 900456". */
function splitContact(value: string): [string, string] {
  const phone = /(\+?\d[\d\s]{8,}\d)/.exec(value);
  if (!phone) return [value.trim(), ''];
  return [value.replace(phone[1], '').replace(/\s{2,}/g, ' ').replace(/[,;–-]\s*$/, '').trim(), phone[1].trim()];
}

function pickLine(text: string, label: RegExp): string {
  const line = text.split('\n').find((l) => label.test(l));
  return line ? line.replace(label, '').replace(/^[\s:–-]+/, '').trim() : '';
}

export interface AgreementInputs {
  prep: PrepData;
  /** The deposit invoice's number, used as the payment reference when there is one. */
  paymentReference: string;
}

/**
 * Fills the template's {{placeholders}} from the quote and the event prep sheet, and turns it into
 * numbered sections of paragraphs, fields ("| Label | value"), bullets ("- ") and the payment table.
 */
export function buildContent(
  quote: QuoteRow,
  settings: Settings & { agreement_template: string; terms_url: string },
  number: string,
  inputs: AgreementInputs,
): AgreementContent {
  const items = JSON.parse(quote.line_items) as LineItem[];
  const t = computeTotals(items, quote.discount_pence, quote.vat_rate_percent, quote.deposit_percent, quote.deposit_fixed_pence);
  const deposit = t.deposit_pence > 0 && t.deposit_pence < t.total_pence ? t.deposit_pence : 0;
  const prep = inputs.prep;
  const service = serviceFor(items, quote.event_type);
  const [contactName, contactPhone] = splitContact(prep.contact_on_day);
  const [start, finish] = splitTimes(prep.service_time || quote.event_time);
  const guests = quote.guests ?? 0;
  const mainLine = items.find((i) => /station\s*–/i.test(i.description)) ?? null;
  const pkg = (/\b(Classic|Deluxe|Signature)\b/.exec(items.map((i) => i.description).join(' ')) || [])[1] || '';
  const plural = (n: number, unit: string) => (n !== 1 && unit && !unit.endsWith('s') ? `${unit}s` : unit);
  const extras = items.filter((i) => i !== mainLine).map((i) => (i.quantity !== 1 ? `${i.description} (${i.quantity} ${plural(i.quantity, i.unit)})` : i.description));
  const duration = service.product === 'pancake' && guests
    ? guests <= 150 ? '2 hours' : guests <= 300 ? '2.5 hours' : 'Bespoke, to be agreed'
    : '';
  const percent = (part: number) => (t.total_pence ? `${Math.round((part / t.total_pence) * 100)}%` : '');
  const paymentRows: [string, string, string][] = deposit
    ? [
      [`Booking deposit (${percent(deposit)})`, pounds(deposit), 'Upon booking confirmation'],
      [`Remaining balance (${percent(t.total_pence - deposit)})`, pounds(t.total_pence - deposit), longDate(quote.final_payment_due) || TBC],
    ]
    : [['Full payment', pounds(t.total_pence), longDate(quote.final_payment_due) || 'Upon booking confirmation']];

  const values: Record<string, string> = {
    business_name: settings.business_name,
    quote_reference: quote.reference,
    agreement_number: number,
    agreement_date: longDate(new Date().toISOString().slice(0, 10)),
    service_name: service.name,
    service_name_lower: service.name.replace(/^Live /, 'live ').replace('Mini Pancake Station', 'mini pancake station').replace('Croffle Station', 'croffle station'),
    service_food: service.food,
    client_name: orTbc(quote.client_name),
    client_phone: orTbc(quote.client_phone),
    client_email: orTbc(quote.client_email),
    client_address: orTbc(quote.client_address.replace(/\s*\n\s*/g, ', ')),
    event_type: orTbc(quote.event_type),
    event_date: orTbc(longDate(quote.event_date)),
    venue: orTbc(quote.venue),
    venue_address: orTbc(prep.venue_address || quote.venue),
    guests: orTbc(quote.guests ? String(quote.guests) : ''),
    contact_name: orTbc(contactName),
    contact_phone: orTbc(contactPhone),
    package: orTbc(pkg),
    toppings: orTbc(pickLine(prep.selections, /^\s*toppings?\b/i)),
    sauces: orTbc(pickLine(prep.selections, /^\s*sauces?\b/i)),
    extras: extras.length ? extras.join('; ') : 'None',
    serving_duration: orTbc(duration),
    serving_start: orTbc(start),
    serving_finish: orTbc(finish),
    arrival_time: orTbc(prep.arrival_time),
    total: pounds(t.total_pence),
    deposit_due: deposit ? 'Upon booking confirmation' : 'Not applicable',
    balance_due_date: orTbc(longDate(quote.final_payment_due)),
    payment_reference: inputs.paymentReference || 'Your invoice number',
    table_provided_by: /table/i.test(prep.power_setup) ? prep.power_setup : TBC,
    power_confirmed: prep.power_setup.trim() ? `Yes: ${prep.power_setup.trim()}` : TBC,
    parking: orTbc(prep.access_parking),
    other_venue: 'None noted',
    allergies: prep.allergies.trim() || 'None disclosed',
    allergy_arrangements: prep.allergies.trim() ? TBC : 'Not applicable',
    terms_url: settings.terms_url,
  };
  const fill = (text: string) => text.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_, key: string) => values[key] ?? '');

  const sections: AgreementContent['sections'] = [{ number: '', heading: '', blocks: [] }];
  const current = () => sections[sections.length - 1];
  const push = (block: AgreementBlock) => {
    const blocks = current().blocks;
    const last = blocks[blocks.length - 1];
    if (block.type === 'fields' && last?.type === 'fields') last.rows.push(...block.rows);
    else if (block.type === 'list' && last?.type === 'list') last.items.push(...block.items);
    else blocks.push(block);
  };
  let paragraph: string[] = [];
  const flush = () => { if (paragraph.length) { push({ type: 'p', text: fill(paragraph.join(' ')) }); paragraph = []; } };

  for (const raw of settings.agreement_template.replace(/\r/g, '').split('\n')) {
    const line = raw.trim();
    if (!line) { flush(); continue; }
    const heading = /^##\s+(?:(\d+)[.)]?\s+)?(.*)$/.exec(line);
    if (heading) { flush(); sections.push({ number: heading[1] ?? '', heading: fill(heading[2]), blocks: [] }); continue; }
    if (line.startsWith('|')) {
      flush();
      const [label, ...rest] = line.replace(/^\|\s*/, '').split('|');
      push({ type: 'fields', rows: [[fill(label.trim()), fill(rest.join('|').trim()) || TBC]] });
      continue;
    }
    if (/^[-•]\s+/.test(line)) { flush(); push({ type: 'list', items: [fill(line.replace(/^[-•]\s+/, ''))] }); continue; }
    if (line === '{{payment_table}}') { flush(); push({ type: 'payments', rows: paymentRows, total: pounds(t.total_pence) }); continue; }
    paragraph.push(line);
  }
  flush();

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
    deposit_pence: deposit,
    balance_pence: deposit ? t.total_pence - deposit : 0,
    balance_due: quote.final_payment_due,
    service_name: service.name,
    sections: sections.filter((sec) => sec.heading || sec.blocks.length),
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
  inputs: AgreementInputs,
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
    const content = JSON.stringify(buildContent(quote, settings, number, inputs));
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
