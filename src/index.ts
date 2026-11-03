import { Hono } from 'hono';
import type { AppContext, Env } from './env';
import { isAllowedEmail, requireStaff } from './auth';
import { draftQuote, type QuoteDraft } from './claude';
import { chatTextFromAttachment, parseInboundEmail } from './email';
import {
  QUOTE_STATUSES, createQuoteFromDraft, getPriceList, getSettings, getSop, updateQuote,
  type QuoteRow, type QuoteUpdate,
} from './db';
import { sanitiseLineItems } from './pricing';
import * as freeagent from './freeagent';

const app = new Hono<AppContext>();
app.use('*', requireStaff);

// Changes must come from the app's own pages: browsers won't let another site add this header
// without a CORS preflight, which this Worker never approves.
app.use('/api/*', async (c, next) => {
  if (c.req.method !== 'GET' && c.req.header('X-Requested-With') !== 'beyondhub') {
    return c.json({ error: 'Missing request header' }, 403);
  }
  await next();
});

const MAX_TEXT = 200_000;
const str = (v: unknown, max = 5000) => String(v ?? '').slice(0, max);
const num = (v: unknown, fallback = 0) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
const idParam = (v: string) => (/^\d+$/.test(v) ? Number(v) : NaN);

function emptyDraft(): QuoteDraft {
  return {
    client_name: '', client_phone: '', client_email: '', event_type: '', event_date: '', event_time: '',
    venue: '', guests: null, summary: '', line_items: [], deposit_percent: null, deposit_fixed_pence: null,
    questions: [], client_notes: '', internal_notes: '', reply_message: '',
  };
}

function quoteToJson(row: QuoteRow) {
  return { ...row, line_items: JSON.parse(row.line_items), questions: JSON.parse(row.questions) };
}

/** Drafts a quote for a stored enquiry. Failures are recorded on the enquiry so staff can retry. */
async function processEnquiry(env: Env, enquiryId: number, by: string): Promise<number> {
  const enquiry = await env.DB.prepare('SELECT raw_text FROM enquiries WHERE id = ?')
    .bind(enquiryId)
    .first<{ raw_text: string }>();
  if (!enquiry) throw new Error('Enquiry not found');
  await env.DB.prepare("UPDATE enquiries SET status = 'drafting', error = NULL WHERE id = ?").bind(enquiryId).run();
  try {
    const [sop, priceList, settings] = await Promise.all([getSop(env.DB), getPriceList(env.DB), getSettings(env.DB)]);
    const draft = await draftQuote(env, settings.business_name, sop, priceList, enquiry.raw_text);
    const quoteId = await createQuoteFromDraft(env.DB, enquiryId, draft, by);
    await env.DB.prepare("UPDATE enquiries SET status = 'drafted' WHERE id = ?").bind(enquiryId).run();
    return quoteId;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await env.DB.prepare("UPDATE enquiries SET status = 'error', error = ? WHERE id = ?")
      .bind(message.slice(0, 1000), enquiryId)
      .run();
    throw err;
  }
}

async function saveEnquiry(env: Env, source: string, by: string, subject: string, text: string): Promise<number> {
  const row = await env.DB.prepare(
    'INSERT INTO enquiries (source, submitted_by, subject, raw_text) VALUES (?, ?, ?, ?) RETURNING id',
  )
    .bind(source, by, subject.slice(0, 300), text.slice(0, MAX_TEXT))
    .first<{ id: number }>();
  return row!.id;
}

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: err.message || 'Something went wrong' }, 500);
});

app.get('/api/me', (c) => c.json({ email: c.get('userEmail'), domain: c.env.ALLOWED_DOMAIN }));

// --- SOP -----------------------------------------------------------------

app.get('/api/sop', async (c) => {
  const row = await c.env.DB.prepare('SELECT content, updated_by, updated_at FROM sop WHERE id = 1').first();
  return c.json(row);
});

app.put('/api/sop', async (c) => {
  const body = await c.req.json<{ content?: string }>();
  const content = str(body.content, 100_000);
  const by = c.get('userEmail');
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE sop SET content = ?, updated_by = ?, updated_at = datetime('now') WHERE id = 1").bind(content, by),
    c.env.DB.prepare('INSERT INTO sop_history (content, updated_by) VALUES (?, ?)').bind(content, by),
  ]);
  return c.json({ ok: true });
});

app.get('/api/sop/history', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT id, content, updated_by, updated_at FROM sop_history ORDER BY id DESC LIMIT 50',
  ).all();
  return c.json(results);
});

// --- Settings --------------------------------------------------------------

app.get('/api/settings', async (c) => c.json(await getSettings(c.env.DB)));

app.put('/api/settings', async (c) => {
  const b = await c.req.json<Record<string, unknown>>();
  await c.env.DB.prepare(
    `UPDATE settings SET business_name = ?, vat_rate_percent = ?, deposit_percent = ?, quote_valid_days = ?,
      quote_terms = ?, updated_at = datetime('now') WHERE id = 1`,
  )
    .bind(
      str(b.business_name, 200) || 'Beyond Scrumptious',
      Math.min(100, Math.max(0, num(b.vat_rate_percent))),
      Math.min(100, Math.max(0, num(b.deposit_percent))),
      Math.max(1, Math.round(num(b.quote_valid_days, 14))),
      str(b.quote_terms, 20_000),
    )
    .run();
  return c.json({ ok: true });
});

// --- Price list --------------------------------------------------------------

function priceFields(b: Record<string, unknown>) {
  const name = str(b.name, 200).trim();
  if (!name) throw new Error('A price list item needs a name');
  return [
    name,
    str(b.category, 100),
    str(b.unit, 50) || 'each',
    Math.max(0, Math.round(num(b.price_pence))),
    str(b.notes, 1000),
    b.active === false || b.active === 0 ? 0 : 1,
  ] as const;
}

app.get('/api/prices', async (c) => c.json(await getPriceList(c.env.DB, true)));

app.post('/api/prices', async (c) => {
  const row = await c.env.DB.prepare(
    'INSERT INTO price_items (name, category, unit, price_pence, notes, active) VALUES (?, ?, ?, ?, ?, ?) RETURNING id',
  )
    .bind(...priceFields(await c.req.json()))
    .first<{ id: number }>();
  return c.json(row, 201);
});

app.put('/api/prices/:id', async (c) => {
  await c.env.DB.prepare(
    "UPDATE price_items SET name = ?, category = ?, unit = ?, price_pence = ?, notes = ?, active = ?, updated_at = datetime('now') WHERE id = ?",
  )
    .bind(...priceFields(await c.req.json()), idParam(c.req.param('id')))
    .run();
  return c.json({ ok: true });
});

// Items are archived rather than deleted so old quotes still make sense.
app.delete('/api/prices/:id', async (c) => {
  await c.env.DB.prepare('UPDATE price_items SET active = 0 WHERE id = ?').bind(idParam(c.req.param('id'))).run();
  return c.json({ ok: true });
});

// --- Enquiries ---------------------------------------------------------------

app.get('/api/enquiries', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT e.id, e.source, e.submitted_by, e.subject, e.status, e.error, e.received_at,
       substr(e.raw_text, 1, 300) AS preview,
       (SELECT q.id FROM quotes q WHERE q.enquiry_id = e.id ORDER BY q.id DESC LIMIT 1) AS quote_id
     FROM enquiries e ORDER BY e.id DESC LIMIT 100`,
  ).all();
  return c.json(results);
});

app.get('/api/enquiries/:id', async (c) => {
  const row = await c.env.DB.prepare('SELECT * FROM enquiries WHERE id = ?').bind(idParam(c.req.param('id'))).first();
  return row ? c.json(row) : c.json({ error: 'Not found' }, 404);
});

/** Paste a chat or upload a WhatsApp export (.txt or .zip) from inside the app. */
app.post('/api/enquiries', async (c) => {
  const form = await c.req.formData();
  const parts: string[] = [];
  const pasted = str(form.get('text'), MAX_TEXT).trim();
  if (pasted) parts.push(pasted);
  const file = form.get('file');
  if (file && typeof file !== 'string') {
    const chat = chatTextFromAttachment(file.name, file.type, new Uint8Array(await file.arrayBuffer()));
    if (!chat) return c.json({ error: 'Upload a WhatsApp export (.txt or .zip).' }, 400);
    parts.push(chat);
  }
  if (!parts.length) return c.json({ error: 'Paste a chat or choose a file.' }, 400);

  const by = c.get('userEmail');
  const enquiryId = await saveEnquiry(c.env, 'paste', by, str(form.get('subject'), 300), parts.join('\n\n'));
  try {
    const quoteId = await processEnquiry(c.env, enquiryId, by);
    return c.json({ enquiry_id: enquiryId, quote_id: quoteId }, 201);
  } catch (err) {
    return c.json({ enquiry_id: enquiryId, error: err instanceof Error ? err.message : String(err) }, 502);
  }
});

app.post('/api/enquiries/:id/draft', async (c) => {
  const quoteId = await processEnquiry(c.env, idParam(c.req.param('id')), c.get('userEmail'));
  return c.json({ quote_id: quoteId });
});

app.delete('/api/enquiries/:id', async (c) => {
  const id = idParam(c.req.param('id'));
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE quotes SET enquiry_id = NULL WHERE enquiry_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM enquiries WHERE id = ?').bind(id),
  ]);
  return c.json({ ok: true });
});

// --- Quotes ------------------------------------------------------------------

app.get('/api/quotes', async (c) => {
  const search = `%${str(c.req.query('q'), 100)}%`;
  const status = str(c.req.query('status'), 20);
  const { results } = await c.env.DB.prepare(
    `SELECT id, reference, status, client_name, event_type, event_date, venue, guests, total_pence, updated_at, updated_by
     FROM quotes
     WHERE (client_name LIKE ?1 OR reference LIKE ?1 OR venue LIKE ?1 OR event_type LIKE ?1 OR client_phone LIKE ?1)
       AND (?2 = '' OR status = ?2)
     ORDER BY updated_at DESC LIMIT 200`,
  )
    .bind(search, status)
    .all();
  return c.json(results);
});

app.post('/api/quotes', async (c) => {
  const id = await createQuoteFromDraft(c.env.DB, null, emptyDraft(), c.get('userEmail'));
  return c.json({ id }, 201);
});

app.get('/api/quotes/:id', async (c) => {
  const row = await c.env.DB.prepare('SELECT * FROM quotes WHERE id = ?').bind(idParam(c.req.param('id'))).first<QuoteRow>();
  return row ? c.json(quoteToJson(row)) : c.json({ error: 'Not found' }, 404);
});

app.put('/api/quotes/:id', async (c) => {
  const b = await c.req.json<Record<string, unknown>>();
  const status = str(b.status, 20);
  const guests = b.guests === null || b.guests === '' ? null : Math.round(num(b.guests));
  const update: QuoteUpdate = {
    status: (QUOTE_STATUSES as readonly string[]).includes(status) ? status : 'draft',
    client_name: str(b.client_name, 200),
    client_phone: str(b.client_phone, 50),
    client_email: str(b.client_email, 200),
    event_type: str(b.event_type, 200),
    event_date: str(b.event_date, 20),
    event_time: str(b.event_time, 100),
    venue: str(b.venue, 500),
    guests,
    summary: str(b.summary),
    line_items: sanitiseLineItems(b.line_items),
    discount_pence: Math.max(0, Math.round(num(b.discount_pence))),
    vat_rate_percent: Math.min(100, Math.max(0, num(b.vat_rate_percent))),
    deposit_percent: Math.min(100, Math.max(0, num(b.deposit_percent))),
    deposit_fixed_pence:
      b.deposit_fixed_pence === null || b.deposit_fixed_pence === '' || b.deposit_fixed_pence === undefined
        ? null
        : Math.max(0, Math.round(num(b.deposit_fixed_pence))),
    client_notes: str(b.client_notes, 20_000),
    internal_notes: str(b.internal_notes, 20_000),
    questions: Array.isArray(b.questions) ? b.questions.slice(0, 50).map((q) => str(q, 500)) : [],
    reply_message: str(b.reply_message, 20_000),
  };
  const ok = await updateQuote(c.env.DB, idParam(c.req.param('id')), update, c.get('userEmail'));
  return ok ? c.json({ ok: true }) : c.json({ error: 'Not found' }, 404);
});

app.post('/api/quotes/:id/duplicate', async (c) => {
  const row = await c.env.DB.prepare('SELECT * FROM quotes WHERE id = ?').bind(idParam(c.req.param('id'))).first<QuoteRow>();
  if (!row) return c.json({ error: 'Not found' }, 404);
  const by = c.get('userEmail');
  const source = quoteToJson(row);
  const id = await createQuoteFromDraft(c.env.DB, null, emptyDraft(), by);
  // Copy everything except the reference and status; prices are kept as they were on the original.
  await updateQuote(c.env.DB, id, { ...source, status: 'draft' }, by);
  return c.json({ id }, 201);
});

app.delete('/api/quotes/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM quotes WHERE id = ?').bind(idParam(c.req.param('id'))).run();
  return c.json({ ok: true });
});

// --- FreeAgent ------------------------------------------------------------------

const freeagentCallback = (c: { req: { url: string } }) => `${new URL(c.req.url).origin}/api/freeagent/callback`;

app.get('/api/freeagent/status', async (c) => c.json(await freeagent.connectionStatus(c.env)));

// Plain links (not fetch calls): the browser goes to FreeAgent and comes back here.
app.get('/api/freeagent/connect', async (c) => {
  if (!freeagent.isConfigured(c.env)) return c.text('Add the FreeAgent app ID and secret first (see README).', 400);
  return c.redirect(await freeagent.authoriseUrl(c.env, freeagentCallback(c)));
});

app.get('/api/freeagent/callback', async (c) => {
  const error = c.req.query('error');
  const code = c.req.query('code');
  if (error || !code) return c.redirect(`/#/settings?freeagent=${encodeURIComponent(error || 'cancelled')}`);
  try {
    await freeagent.completeConnection(c.env, code, str(c.req.query('state'), 100), freeagentCallback(c), c.get('userEmail'));
    return c.redirect('/#/settings?freeagent=connected');
  } catch (err) {
    console.error(err);
    return c.redirect(`/#/settings?freeagent=${encodeURIComponent(err instanceof Error ? err.message : 'failed')}`);
  }
});

app.post('/api/freeagent/disconnect', async (c) => {
  await freeagent.disconnect(c.env);
  return c.json({ ok: true });
});

app.post('/api/quotes/:id/freeagent', async (c) => {
  const id = idParam(c.req.param('id'));
  // Claim the quote first so a double click can't create two estimates.
  const claim = await c.env.DB.prepare(
    "UPDATE quotes SET freeagent_status = 'sending' WHERE id = ? AND status = 'accepted' AND freeagent_status IS NULL",
  )
    .bind(id)
    .run();
  if (!claim.meta.changes) {
    return c.json({ error: 'Only accepted quotes that haven\'t been sent to FreeAgent yet can be sent.' }, 409);
  }
  let created = false;
  try {
    const row = await c.env.DB.prepare('SELECT * FROM quotes WHERE id = ?').bind(id).first<QuoteRow>();
    const sent = await freeagent.sendQuote(c.env, row!, async (estimate) => {
      created = true;
      await c.env.DB.prepare(
        "UPDATE quotes SET freeagent_status = 'sent', freeagent_url = ?, freeagent_sent_at = datetime('now') WHERE id = ?",
      )
        .bind(estimate.web_url || estimate.api_url, id)
        .run();
    });
    return c.json({ url: sent.web_url || sent.api_url });
  } catch (err) {
    // Only release the quote if nothing was created in FreeAgent, so retrying can't make a duplicate.
    if (!created) await c.env.DB.prepare('UPDATE quotes SET freeagent_status = NULL WHERE id = ?').bind(id).run();
    throw err;
  }
});

app.all('/api/*', (c) => c.json({ error: 'Not found' }, 404));

// Everything else is the web app itself, served only after the sign-in check above.
app.get('*', (c) => c.env.ASSETS.fetch(c.req.raw));

export default {
  fetch: app.fetch,

  /** Cloudflare Email Routing delivers mail sent to the quotes address here. */
  async email(message: ForwardableEmailMessage, env: Env, ctx: ExecutionContext) {
    const raw = await new Response(message.raw).arrayBuffer();
    const parsed = await parseInboundEmail(raw);
    const sender = message.from.toLowerCase();
    if (
      !isAllowedEmail(sender, env.ALLOWED_DOMAIN) ||
      parsed.from.toLowerCase() !== sender ||
      parsed.dmarcFailed
    ) {
      message.setReject(`Only @${env.ALLOWED_DOMAIN} staff can send enquiries to this address.`);
      return;
    }
    if (!parsed.text.trim()) {
      message.setReject('No chat found. Attach a WhatsApp export or include the enquiry in the email.');
      return;
    }
    const enquiryId = await saveEnquiry(env, 'email', sender, parsed.subject, parsed.text);
    // Drafting can take a minute; the enquiry is already saved, and a failure shows in the inbox with a retry button.
    ctx.waitUntil(processEnquiry(env, enquiryId, sender).catch((err) => console.error('Draft failed', err)));
  },
} satisfies ExportedHandler<Env>;
