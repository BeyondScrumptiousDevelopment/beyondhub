import type { Env } from './env';
import type { QuoteRow } from './db';
import type { LineItem } from './pricing';

const DEFAULT_API_BASE = 'https://api.freeagent.com/v2';

interface Connection {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  company_subdomain: string;
  connected_by: string;
}

export function apiBase(env: Env): string {
  return (env.FREEAGENT_API_BASE || DEFAULT_API_BASE).replace(/\/$/, '');
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
  if (!res.ok) throw new Error(`FreeAgent sign-in failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
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
    throw new Error('That FreeAgent sign-in link has expired. Click Connect FreeAgent again.');
  }
  const tokens = await tokenRequest(env, { grant_type: 'authorization_code', code, redirect_uri: redirectUri });
  if (!tokens.refresh_token) throw new Error('FreeAgent did not return a refresh token.');
  const company = await fetchJson<{ company: { subdomain?: string } }>(env, tokens.access_token, 'GET', '/company');
  await env.DB.prepare(
    `UPDATE integrations SET access_token = ?, refresh_token = ?, expires_at = ?, company_subdomain = ?,
       connected_by = ?, connected_at = datetime('now'), pending_state = NULL, pending_state_expires_at = NULL
     WHERE id = 'freeagent'`,
  )
    .bind(
      tokens.access_token, tokens.refresh_token, Date.now() + tokens.expires_in * 1000,
      company.company.subdomain ?? '', by,
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
  if (!row) throw new Error('FreeAgent is not connected. Connect it under Settings first.');
  if (Date.now() < row.expires_at - 60_000) return row;

  const tokens = await tokenRequest(env, { grant_type: 'refresh_token', refresh_token: row.refresh_token });
  const updated = {
    ...row,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token || row.refresh_token,
    expires_at: Date.now() + tokens.expires_in * 1000,
  };
  await env.DB.prepare(
    "UPDATE integrations SET access_token = ?, refresh_token = ?, expires_at = ? WHERE id = 'freeagent'",
  )
    .bind(updated.access_token, updated.refresh_token, updated.expires_at)
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
  if (!res.ok) throw new Error(`FreeAgent said no (${res.status} on ${method} ${path}): ${text.slice(0, 400)}`);
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

const digits = (s: string | undefined) => (s ?? '').replace(/\D/g, '').replace(/^44/, '0');

/** Finds the client among existing FreeAgent contacts by email, then phone, then name; creates them otherwise. */
async function findOrCreateContact(env: Env, token: string, q: QuoteRow): Promise<string> {
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
  if (!parts.length) throw new Error('Add the client\'s name to the quote before sending it to FreeAgent.');
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
  const id = path.split('/').pop();
  const sent = {
    api_url: estimate.url,
    web_url: conn.company_subdomain ? `https://${conn.company_subdomain}.freeagent.com/estimates/${id}` : '',
  };
  await onCreated(sent);

  try {
    // Marked as sent first, as when done by hand. These are status changes only: nothing is emailed.
    await fetchJson(env, token, 'PUT', `${path}/transitions/mark_as_sent`, {});
    await fetchJson(env, token, 'PUT', `${path}/transitions/mark_as_approved`, {});
  } catch (err) {
    throw new Error(
      `The quote is in FreeAgent, but it couldn't be marked as approved. Open it in FreeAgent and approve it there. (${err instanceof Error ? err.message : err})`,
    );
  }
  return sent;
}
