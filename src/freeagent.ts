import type { Env } from './env';
import type { QuoteRow } from './db';
import type { LineItem } from './pricing';
import { parseReference, type InvoiceRow, type InvoiceSnapshot, type NumberSequence } from './invoices';
import { UserError } from './security';

const DEFAULT_API_BASE = 'https://api.freeagent.com/v2';

interface Connection {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  company_subdomain: string;
  connected_by: string;
}

// Only FreeAgent's own servers (or a local test server during development) ever receive the app's credentials.
const ALLOWED_API_BASES = new Set([DEFAULT_API_BASE, 'https://api.sandbox.freeagent.com/v2']);

export function apiBase(env: Env): string {
  const base = (env.FREEAGENT_API_BASE || DEFAULT_API_BASE).replace(/\/$/, '');
  if (ALLOWED_API_BASES.has(base) || (env.DEV_USER_EMAIL && base.startsWith('http://localhost'))) return base;
  throw new UserError('FREEAGENT_API_BASE must be a FreeAgent address.');
}

// --- Token storage --------------------------------------------------------------
// FreeAgent tokens are encrypted in the database (AES-GCM) with a key derived from the app's
// client secret, which lives only in Cloudflare's secret store. A copy of the database alone
// is useless; changing the secret means connecting FreeAgent again.

const ENCRYPTED_PREFIX = 'v1:';

async function tokenKey(env: Env): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(clientSecret(env)), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new TextEncoder().encode('beyondhub-freeagent-tokens'), info: new Uint8Array() },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromBase64 = (s: string) => Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0));

async function sealToken(env: Env, token: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await tokenKey(env), new TextEncoder().encode(token)));
  return `${ENCRYPTED_PREFIX}${toBase64(iv)}.${toBase64(sealed)}`;
}

async function openToken(env: Env, stored: string): Promise<string> {
  // Tokens saved before encryption was added are plain text; they're encrypted on the next refresh.
  if (!stored.startsWith(ENCRYPTED_PREFIX)) return stored;
  const [iv, sealed] = stored.slice(ENCRYPTED_PREFIX.length).split('.');
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(iv) }, await tokenKey(env), fromBase64(sealed));
    return new TextDecoder().decode(plain);
  } catch {
    throw new UserError('The FreeAgent connection needs renewing. Go to Settings, Disconnect, then Connect FreeAgent again.', 409);
  }
}

// Trimmed because values pasted into the Cloudflare dashboard easily pick up a stray space or line break.
const clientId = (env: Env) => (env.FREEAGENT_CLIENT_ID ?? '').trim();
const clientSecret = (env: Env) => (env.FREEAGENT_CLIENT_SECRET ?? '').trim();

export function isConfigured(env: Env): boolean {
  return Boolean(clientId(env) && clientSecret(env));
}

function basicAuth(env: Env): string {
  return `Basic ${btoa(`${clientId(env)}:${clientSecret(env)}`)}`;
}

async function tokenRequest(env: Env, params: Record<string, string>) {
  const res = await fetch(`${apiBase(env)}/token_endpoint`, {
    method: 'POST',
    headers: { Authorization: basicAuth(env), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });
  if (!res.ok) throw new UserError(`FreeAgent sign-in failed (${res.status}): ${(await res.text()).slice(0, 300)}`, 502);
  return (await res.json()) as { access_token: string; refresh_token?: string; expires_in: number };
}

// --- Connecting --------------------------------------------------------------

/** Starts the one-time "Allow" step on FreeAgent. The state value guards the callback. */
export async function authoriseUrl(env: Env, redirectUri: string): Promise<string> {
  const state = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO integrations (id, pending_state, pending_state_expires_at) VALUES ('freeagent', ?, ?)
     ON CONFLICT (id) DO UPDATE SET pending_state = excluded.pending_state,
       pending_state_expires_at = excluded.pending_state_expires_at`,
  )
    .bind(state, Date.now() + 10 * 60_000)
    .run();
  const url = new URL(`${apiBase(env)}/approve_app`);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', clientId(env));
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('state', state);
  return url.toString();
}

export async function completeConnection(
  env: Env,
  code: string,
  state: string,
  redirectUri: string,
  by: string,
): Promise<void> {
  const row = await env.DB.prepare(
    "SELECT pending_state, pending_state_expires_at FROM integrations WHERE id = 'freeagent'",
  ).first<{ pending_state: string | null; pending_state_expires_at: number | null }>();
  if (!row?.pending_state || row.pending_state !== state || Date.now() > (row.pending_state_expires_at ?? 0)) {
    throw new UserError('That FreeAgent sign-in link has expired. Click Connect FreeAgent again.');
  }
  const tokens = await tokenRequest(env, { grant_type: 'authorization_code', code, redirect_uri: redirectUri });
  if (!tokens.refresh_token) throw new UserError('FreeAgent did not return a refresh token.');
  const company = await fetchJson<{ company: { subdomain?: string } }>(env, tokens.access_token, 'GET', '/company');
  await env.DB.prepare(
    `UPDATE integrations SET access_token = ?, refresh_token = ?, expires_at = ?, company_subdomain = ?,
       connected_by = ?, connected_at = datetime('now'), pending_state = NULL, pending_state_expires_at = NULL
     WHERE id = 'freeagent'`,
  )
    .bind(
      await sealToken(env, tokens.access_token), await sealToken(env, tokens.refresh_token),
      Date.now() + tokens.expires_in * 1000, cleanSubdomain(company.company.subdomain), by,
    )
    .run();
}

export async function connectionStatus(env: Env) {
  const row = await env.DB.prepare(
    "SELECT connected_by, connected_at, company_subdomain FROM integrations WHERE id = 'freeagent' AND refresh_token IS NOT NULL",
  ).first<{ connected_by: string; connected_at: string; company_subdomain: string }>();
  const missing = [
    ...(clientId(env) ? [] : ['FREEAGENT_CLIENT_ID']),
    ...(clientSecret(env) ? [] : ['FREEAGENT_CLIENT_SECRET']),
  ];
  return { configured: isConfigured(env), missing, connected: Boolean(row), ...row };
}

export async function disconnect(env: Env): Promise<void> {
  await env.DB.prepare("DELETE FROM integrations WHERE id = 'freeagent'").run();
}

/** Returns a working access token, refreshing it (FreeAgent tokens last about an hour) when needed. */
async function accessToken(env: Env): Promise<Connection> {
  const row = await env.DB.prepare(
    `SELECT access_token, refresh_token, expires_at, company_subdomain, connected_by FROM integrations
     WHERE id = 'freeagent' AND refresh_token IS NOT NULL`,
  ).first<Connection>();
  if (!row) throw new UserError('FreeAgent is not connected. Connect it under Settings first.', 409);
  const current = {
    ...row,
    access_token: await openToken(env, row.access_token),
    refresh_token: await openToken(env, row.refresh_token),
  };
  if (Date.now() < row.expires_at - 60_000) return current;

  const tokens = await tokenRequest(env, { grant_type: 'refresh_token', refresh_token: current.refresh_token });
  const updated = {
    ...current,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token || current.refresh_token,
    expires_at: Date.now() + tokens.expires_in * 1000,
  };
  await env.DB.prepare(
    "UPDATE integrations SET access_token = ?, refresh_token = ?, expires_at = ? WHERE id = 'freeagent'",
  )
    .bind(await sealToken(env, updated.access_token), await sealToken(env, updated.refresh_token), updated.expires_at)
    .run();
  return updated;
}

async function fetchJson<T>(env: Env, token: string, method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${apiBase(env)}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'User-Agent': 'BeyondScrumptiousQuotes',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new UserError(`FreeAgent said no (${res.status} on ${method} ${path}): ${text.slice(0, 400)}`, 502);
  return (text ? JSON.parse(text) : {}) as T;
}

// --- Sending a quote ------------------------------------------------------------

interface FreeAgentContact {
  url: string;
  first_name?: string;
  last_name?: string;
  organisation_name?: string;
  email?: string;
  phone_number?: string;
  mobile?: string;
}

/** Company subdomains are letters, digits and hyphens; anything else is dropped rather than put in a link. */
function cleanSubdomain(value: string | undefined): string {
  return /^[a-z0-9-]{1,63}$/i.test(value ?? '') ? value!.toLowerCase() : '';
}

const digits = (s: string | undefined) => (s ?? '').replace(/\D/g, '').replace(/^44/, '0');

/** Finds the client among existing FreeAgent contacts by email, then phone, then name; creates them otherwise. */
type ClientDetails = Pick<QuoteRow, 'client_name' | 'client_email' | 'client_phone'>;

async function findOrCreateContact(env: Env, token: string, q: ClientDetails): Promise<string> {
  const email = q.client_email.trim().toLowerCase();
  const phone = digits(q.client_phone);
  const name = q.client_name.trim().toLowerCase();
  let byPhone: string | null = null;
  let byName: string | null = null;

  for (let page = 1; page <= 20; page++) {
    const { contacts } = await fetchJson<{ contacts: FreeAgentContact[] }>(
      env, token, 'GET', `/contacts?view=all&per_page=100&page=${page}`,
    );
    for (const c of contacts) {
      if (email && c.email?.toLowerCase() === email) return c.url;
      if (phone && !byPhone && [c.phone_number, c.mobile].some((p) => p && digits(p) === phone)) byPhone = c.url;
      const fullName = [c.first_name, c.last_name].filter(Boolean).join(' ').toLowerCase();
      if (name && !byName && (fullName === name || c.organisation_name?.toLowerCase() === name)) byName = c.url;
    }
    if (contacts.length < 100) break;
  }
  if (byPhone) return byPhone;
  if (byName) return byName;

  const parts = q.client_name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) throw new UserError('Add the client\'s name to the quote before sending it to FreeAgent.');
  // FreeAgent needs a first and last name, or an organisation name; a single name goes in as the latter.
  const contact: Record<string, string> =
    parts.length > 1
      ? { first_name: parts[0], last_name: parts.slice(1).join(' ') }
      : { organisation_name: parts[0] };
  if (q.client_email) contact.email = q.client_email.trim();
  if (q.client_phone) contact.mobile = q.client_phone.trim();
  const created = await fetchJson<{ contact: FreeAgentContact }>(env, token, 'POST', '/contacts', { contact });
  return created.contact.url;
}

function estimateComments(q: QuoteRow): string {
  const details = [
    q.event_type && `Event: ${q.event_type}`,
    q.event_date && `Date: ${q.event_date}`,
    q.event_time && `Time: ${q.event_time}`,
    q.venue && `Venue: ${q.venue}`,
    q.guests && `Guests: ${q.guests}`,
    q.final_payment_due && `Final payment due: ${q.final_payment_due}`,
  ].filter(Boolean);
  return [details.join('\n'), q.client_notes].filter((s) => s && String(s).trim()).join('\n\n');
}

export interface SentEstimate {
  api_url: string;
  web_url: string;
}

/** Creates the estimate in FreeAgent and marks it approved. Nothing is emailed to the client. */
export async function sendQuote(
  env: Env,
  q: QuoteRow,
  /** Called as soon as the estimate exists, so a later failure can't lead to a duplicate. */
  onCreated: (estimate: SentEstimate) => Promise<void>,
): Promise<SentEstimate> {
  const conn = await accessToken(env);
  const token = conn.access_token;
  const contact = await findOrCreateContact(env, token, q);

  const items = (JSON.parse(q.line_items) as LineItem[]).map((i) => ({
    item_type: 'Products',
    quantity: String(i.quantity),
    price: (i.unit_price_pence / 100).toFixed(2),
    description: i.unit && i.unit !== 'each' ? `${i.description} (${i.unit})` : i.description,
  }));
  if (q.discount_pence > 0) {
    items.push({ item_type: 'Products', quantity: '1', price: (-q.discount_pence / 100).toFixed(2), description: 'Discount' });
  }

  const { estimate } = await fetchJson<{ estimate: { url: string } }>(env, token, 'POST', '/estimates', {
    estimate: {
      contact,
      estimate_type: 'Quote',
      // FreeAgent requires a starting status; it's moved to Approved below.
      status: 'Draft',
      dated_on: new Date().toISOString().slice(0, 10),
      currency: 'GBP',
      reference: q.reference,
      comments: estimateComments(q),
      estimate_items: items,
    },
  });

  const path = new URL(estimate.url).pathname.replace(/^\/v2/, '');
  if (!/^\/estimates\/\d+$/.test(path)) throw new UserError('FreeAgent returned an unexpected estimate address.', 502);
  const id = path.split('/').pop();
  const sent = {
    api_url: estimate.url,
    web_url: cleanSubdomain(conn.company_subdomain) && /^\d+$/.test(id ?? '')
      ? `https://${cleanSubdomain(conn.company_subdomain)}.freeagent.com/estimates/${id}`
      : '',
  };
  await onCreated(sent);

  try {
    // Marked as sent first, as when done by hand. These are status changes only: nothing is emailed.
    await fetchJson(env, token, 'PUT', `${path}/transitions/mark_as_sent`, {});
    await fetchJson(env, token, 'PUT', `${path}/transitions/mark_as_approved`, {});
  } catch (err) {
    throw new UserError(
      `The quote is in FreeAgent, but it couldn't be marked as approved. Open it in FreeAgent and approve it there. (${err instanceof Error ? err.message : err})`,
    );
  }
  return sent;
}

// --- Sending an invoice (for the accounts) ------------------------------------------

function lineItemsFor(s: InvoiceSnapshot) {
  const items = s.line_items.map((i) => ({
    item_type: 'Products',
    quantity: String(i.quantity),
    price: (i.unit_price_pence / 100).toFixed(2),
    description: i.unit && i.unit !== 'each' ? `${i.description} (${i.unit})` : i.description,
  }));
  if (s.discount_pence > 0) {
    items.push({ item_type: 'Products', quantity: '1', price: (-s.discount_pence / 100).toFixed(2), description: 'Discount' });
  }
  return items;
}

function daysBetween(from: string, to: string): number {
  return Math.max(0, Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000));
}

/**
 * Creates the invoice in FreeAgent with the same number as the app's PDF, and marks it as sent
 * so it counts in the accounts. FreeAgent doesn't email the client; the PDF from the app is
 * what the client receives.
 */
export async function sendInvoice(
  env: Env,
  inv: InvoiceRow,
  onCreated: (webUrl: string) => Promise<void>,
): Promise<string> {
  const s = JSON.parse(inv.snapshot) as InvoiceSnapshot;
  const conn = await accessToken(env);
  const token = conn.access_token;
  const contact = await findOrCreateContact(env, token, s);

  let items: { item_type: string; quantity: string; price: string; description: string }[];
  if (inv.kind === 'deposit') {
    items = [{
      item_type: 'Products',
      quantity: '1',
      price: (inv.amount_due_pence / 100).toFixed(2),
      description: `Deposit to secure ${s.event_type || 'your booking'}${s.event_date ? ` on ${s.event_date}` : ''} (quote ${s.quote_reference})`,
    }];
  } else {
    items = lineItemsFor(s);
    if (inv.kind === 'balance' && inv.deposit_paid_pence > 0) {
      items.push({
        item_type: 'Products',
        quantity: '1',
        price: (-inv.deposit_paid_pence / 100).toFixed(2),
        description: `Less deposit paid${inv.deposit_paid_on ? ` on ${inv.deposit_paid_on}` : ''}`,
      });
    }
  }

  // FreeAgent has one due date per invoice, so a scheduled invoice is due on its final date and the
  // deposit date goes in the notes; part payments are matched in FreeAgent as they arrive.
  const gbp = (pence: number) => `£${(pence / 100).toFixed(2)}`;
  const comments = [
    inv.kind === 'scheduled'
      && `Payment schedule: deposit ${gbp(inv.deposit_pence)} due by ${inv.deposit_due_on}; balance ${gbp(inv.amount_due_pence - inv.deposit_pence)} due by ${inv.due_on}.`,
    s.event_type && `Event: ${s.event_type}`,
    s.event_date && `Date: ${s.event_date}`,
    s.venue && `Venue: ${s.venue}`,
    `Quote: ${s.quote_reference}`,
  ].filter(Boolean).join('\n');

  const { invoice } = await fetchJson<{ invoice: { url: string } }>(env, token, 'POST', '/invoices', {
    invoice: {
      contact,
      dated_on: inv.issued_on,
      payment_terms_in_days: daysBetween(inv.issued_on, inv.due_on),
      reference: inv.number,
      currency: 'GBP',
      comments,
      invoice_items: items,
    },
  });

  const path = new URL(invoice.url).pathname.replace(/^\/v2/, '');
  if (!/^\/invoices\/\d+$/.test(path)) throw new UserError('FreeAgent returned an unexpected invoice address.', 502);
  const id = path.split('/').pop();
  const subdomain = cleanSubdomain(conn.company_subdomain);
  const webUrl = subdomain ? `https://${subdomain}.freeagent.com/invoices/${id}` : '';
  await onCreated(webUrl);

  try {
    await fetchJson(env, token, 'PUT', `${path}/transitions/mark_as_sent`, {});
  } catch (err) {
    throw new UserError(
      `The invoice is in FreeAgent as a draft, but it couldn't be marked as sent. Open it in FreeAgent and mark it as sent there. (${err instanceof Error ? err.message : err})`,
      502,
    );
  }
  return webUrl;
}

// --- Following FreeAgent's invoice numbers ---------------------------------------------

/**
 * Reads existing FreeAgent invoices and returns the number that comes next in their sequence,
 * keeping FreeAgent's prefix and zero-padding (e.g. latest "INV-0045" gives "INV-" 46, width 4).
 * The prefix is taken from the most recent invoice, in case older ones used a different style.
 */
export async function nextFreeAgentInvoiceNumber(env: Env): Promise<{ next: NumberSequence; latest: string } | null> {
  const conn = await accessToken(env);
  const refs: { reference: string; dated_on: string; created_at: string }[] = [];
  for (let page = 1; page <= 30; page++) {
    const { invoices } = await fetchJson<{ invoices: { reference?: string; dated_on?: string; created_at?: string }[] }>(
      env, conn.access_token, 'GET', `/invoices?view=all&per_page=100&page=${page}`,
    );
    for (const inv of invoices) {
      if (inv.reference) refs.push({ reference: inv.reference, dated_on: inv.dated_on ?? '', created_at: inv.created_at ?? '' });
    }
    if (invoices.length < 100) break;
  }
  const parsed = refs
    .map((r) => ({ ...r, parts: parseReference(r.reference) }))
    .filter((r): r is typeof r & { parts: NonNullable<ReturnType<typeof parseReference>> } => r.parts !== null);
  if (!parsed.length) return null;
  const newest = [...parsed].sort((a, b) => (b.created_at || b.dated_on).localeCompare(a.created_at || a.dated_on))[0];
  const prefix = newest.parts.prefix;
  const best = parsed
    .filter((r) => r.parts.prefix === prefix)
    .reduce((a, b) => (b.parts.number > a.parts.number ? b : a));
  return {
    next: { prefix, next: best.parts.number + 1, width: best.parts.width },
    latest: best.reference,
  };
}
