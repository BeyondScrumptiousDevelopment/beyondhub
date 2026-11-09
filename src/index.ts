import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { HTTPException } from 'hono/http-exception';
import type { AppContext, Env } from './env';
import { isAllowedEmail, requireStaff } from './auth';
import { draftQuote, type QuoteDraft } from './claude';
import { chatTextFromAttachment, parseInboundEmail } from './email';
import {
  PAYMENT_RULES, QUOTE_STATUSES, createQuoteFromDraft, getPriceList, getSettings, getSop, updateQuote,
  type QuoteRow, type QuoteUpdate,
} from './db';
import { sanitiseLineItems } from './pricing';
import * as freeagent from './freeagent';
import { agreementToJson, createAgreement, findByToken, renewLink, type AgreementContent, type AgreementRow } from './agreements';
import { messagePage, signPage, signedPage } from './signpage';
import { emptyPrep, extractPrep, sanitisePrep, type PrepData } from './prep';
import {
  INVOICE_KINDS, createInvoice, formatReference, invoiceToJson, nextInvoiceSequence, paidDeposit, setNumbering,
  type InvoiceKind, type InvoiceRow, type NumberSequence,
} from './invoices';
import {
  UserError, checkDailyDraftCap, isAdmin, parseId, publicMessage, rateLimit, requireAdmin, securityHeaders,
} from './security';

const app = new Hono<AppContext>();
app.use('*', securityHeaders);

// The app moved from quotes.beyondscrumptious.com to hub.beyondscrumptious.com.
app.use('*', async (c, next) => {
  const url = new URL(c.req.url);
  if (url.hostname === 'quotes.beyondscrumptious.com') {
    url.hostname = 'hub.beyondscrumptious.com';
    return c.redirect(url.toString(), 301);
  }
  await next();
});

// The logo shown on the Cloudflare login page has to load before anyone signs in, so these
// files, and only these, are served without the sign-in check.
const PUBLIC_FILES = new Set(['/brand/wordmark-navy.png']);
app.get('/brand/*', async (c) => {
  const path = new URL(c.req.url).pathname;
  if (!PUBLIC_FILES.has(path)) return c.text('Not found', 404);
  return c.env.ASSETS.fetch(new URL(path, c.req.url));
});

// ---- Public: booking agreement signing --------------------------------------------------
// Clients sign at SIGNING_HOST (sign.beyondscrumptious.com/<private link>), which sits outside the
// staff login and serves nothing but these pages. Each page shows only the one agreement its link
// belongs to, and visitors are rate-limited.

const signing = new Hono<AppContext>();

signing.use('*', async (c, next) => {
  const limiter = c.env.API_LIMITER;
  if (limiter) {
    const { success } = await limiter.limit({ key: `public:${c.req.header('cf-connecting-ip') ?? 'unknown'}` });
    if (!success) return c.html(messagePage('Please wait a moment', 'Too many requests. Wait a minute and try again.'), 429);
  }
  await next();
  c.res.headers.set('Cache-Control', 'no-store');
  c.res.headers.set('X-Robots-Tag', 'noindex, nofollow');
});

function agreementStatePage(row: AgreementRow | null, token: string, error = '') {
  if (!row) return { status: 404 as const, html: messagePage('Link not recognised', "This link isn't valid. Please check you copied the whole link, or ask us for a new one.") };
  const content = JSON.parse(row.content) as AgreementContent;
  if (row.status === 'void') return { status: 410 as const, html: messagePage('Agreement withdrawn', 'This agreement has been withdrawn. Please get in touch with us.') };
  if (row.status === 'signed') return { status: 200 as const, html: signedPage(row, content) };
  if (row.expires_at < new Date().toISOString().replace('T', ' ').slice(0, 19)) {
    return { status: 410 as const, html: messagePage('Link expired', 'This link has expired. Please ask us for a new one.') };
  }
  return { status: 200 as const, html: signPage(row, content, token, error) };
}

signing.get('/brand/wordmark-navy.png', (c) => c.env.ASSETS.fetch(new URL('/brand/wordmark-navy.png', c.req.url)));

signing.get('/', (c) => c.html(messagePage('Booking agreements', 'Please open the signing link we sent you.')));

// The branded Terms & Conditions (August 2026), so clients can read them before signing.
const TERMS_PDF = '/legal/beyond-scrumptious-terms-and-conditions-2026-08.pdf';
signing.get('/terms', async (c) => {
  const res = await c.env.ASSETS.fetch(new URL(TERMS_PDF, c.req.url));
  const out = new Response(res.body, res);
  out.headers.set('Content-Disposition', 'inline; filename="Beyond Scrumptious Terms and Conditions (August 2026).pdf"');
  return out;
});

const onlineSigning = (env: Env) => env.ONLINE_SIGNING === 'true';
const signingOff = () => messagePage('Online signing is not in use', 'Please contact us and we will send your booking agreement directly.');

signing.get('/:token{[A-Za-z0-9_-]{20,64}}', async (c) => {
  if (!onlineSigning(c.env)) return c.html(signingOff(), 404);
  const token = c.req.param('token');
  const page = agreementStatePage(await findByToken(c.env.DB, token), token);
  return c.html(page.html, page.status);
});

signing.post('/:token{[A-Za-z0-9_-]{20,64}}', async (c) => {
  if (!onlineSigning(c.env)) return c.html(signingOff(), 404);
  const token = c.req.param('token');
  const row = await findByToken(c.env.DB, token);
  if (!row || row.status !== 'sent') {
    const page = agreementStatePage(row, token);
    return c.html(page.html, page.status);
  }
  if (Number(c.req.header('content-length') ?? 0) > 10_000) return c.html(messagePage('Something went wrong', 'That request was too large.'), 413);
  const form = await c.req.formData();
  const name = str(form.get('full_name'), 100).replace(/\s+/g, ' ').trim();
  if (name.length < 2 || form.get('agree') !== 'yes') {
    const page = agreementStatePage(row, token, 'Please type your full name and tick the box to agree.');
    return c.html(page.html, 400);
  }
  await c.env.DB.prepare(
    `UPDATE agreements SET status = 'signed', signed_name = ?, signed_at = datetime('now'), signed_ip = ?,
       signed_user_agent = ?, updated_at = datetime('now')
     WHERE id = ? AND status = 'sent' AND expires_at > datetime('now')`,
  )
    .bind(name, str(c.req.header('cf-connecting-ip'), 64), str(c.req.header('user-agent'), 300), row.id)
    .run();
  const page = agreementStatePage(await c.env.DB.prepare('SELECT * FROM agreements WHERE id = ?').bind(row.id).first<AgreementRow>(), token);
  return c.html(page.html, page.status);
});

signing.all('*', (c) => c.html(messagePage('Page not found', 'Please open the signing link we sent you.'), 404));
signing.onError((err, c) => {
  console.error(err);
  return c.html(messagePage('Something went wrong', 'Please try again in a moment.'), 500);
});

/** The signing address only ever reaches the signing pages above. */
app.use('*', async (c, next) => {
  if (new URL(c.req.url).hostname === (c.env.SIGNING_HOST || 'sign.beyondscrumptious.com')) {
    return signing.fetch(c.req.raw, c.env, c.executionCtx);
  }
  await next();
});

app.use('*', requireStaff);
app.use('*', async (c, next) => {
  c.set('isAdmin', isAdmin(c.env, c.get('userEmail')));
  await next();
});
app.use('/api/*', rateLimit('API_LIMITER', 'Too many requests. Wait a minute and try again.'));

// Requests bigger than this are refused before they're read: 1 MB for normal saves,
// 20 MB for chat uploads.
app.use('/api/*', async (c, next) => {
  const isUpload = c.req.method === 'POST' && new URL(c.req.url).pathname === '/api/enquiries';
  return bodyLimit({
    maxSize: (isUpload ? 20 : 1) * 1024 * 1024,
    onError: () => { throw new UserError('That is too large to upload.', 413); },
  })(c, next);
});

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
const idParam = parseId;
const isoDate = (v: unknown) => (/^\d{4}-\d{2}-\d{2}$/.test(str(v, 10)) ? str(v, 10) : '');
const draftLimit = rateLimit('DRAFT_LIMITER', 'Too many drafts in a short time. Wait a minute and try again.');

function emptyDraft(): QuoteDraft {
  return {
    client_name: '', client_phone: '', client_email: '', client_address: '', event_type: '', event_date: '', event_time: '',
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
  if (!enquiry) throw new UserError('Enquiry not found', 404);
  await env.DB.prepare("UPDATE enquiries SET status = 'drafting', error = NULL WHERE id = ?").bind(enquiryId).run();
  try {
    const [sop, priceList, settings] = await Promise.all([getSop(env.DB), getPriceList(env.DB), getSettings(env.DB)]);
    const draft = await draftQuote(env, settings.business_name, sop, priceList, enquiry.raw_text);
    const quoteId = await createQuoteFromDraft(env.DB, enquiryId, draft, by);
    await env.DB.prepare("UPDATE enquiries SET status = 'drafted' WHERE id = ?").bind(enquiryId).run();
    return quoteId;
  } catch (err) {
    console.error('Draft failed', err);
    await env.DB.prepare("UPDATE enquiries SET status = 'error', error = ? WHERE id = ?")
      .bind(publicMessage(err).slice(0, 1000), enquiryId)
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
  if (err instanceof UserError) return c.json({ error: err.message }, err.status);
  if (err instanceof HTTPException) return err.getResponse();
  if (err instanceof SyntaxError) return c.json({ error: "That request couldn't be read." }, 400);
  console.error(err);
  return c.json({ error: publicMessage(err) }, 500);
});

app.get('/api/me', (c) =>
  c.json({ email: c.get('userEmail'), domain: c.env.ALLOWED_DOMAIN, is_admin: c.get('isAdmin'), online_signing: onlineSigning(c.env) }),
);

// --- Home page ---------------------------------------------------------------

app.get('/api/dashboard', async (c) => {
  const db = c.env.DB;
  const [counts, upcoming, attention, failed, payments] = await db.batch([
    db.prepare(
      `SELECT
         SUM(status = 'draft' AND line_items LIKE '%"needs_review":true%') AS needs_checking,
         SUM(status = 'draft') AS drafts,
         SUM(status = 'sent') AS awaiting_reply,
         SUM(status = 'accepted' AND status_changed_at >= date('now', 'start of month')) AS accepted_this_month,
         COALESCE(SUM(CASE WHEN status = 'accepted' AND status_changed_at >= date('now', 'start of month') THEN total_pence END), 0) AS accepted_value_this_month,
         SUM(status = 'accepted' AND event_date BETWEEN date('now') AND date('now', '+30 days')) AS events_next_30_days,
         (SELECT COUNT(*) FROM invoices WHERE status = 'issued') AS unpaid_invoices,
         (SELECT COALESCE(SUM(amount_due_pence), 0) FROM invoices WHERE status = 'issued') AS unpaid_value,
         (SELECT COUNT(*) FROM invoices WHERE status = 'issued' AND due_on < date('now')) AS overdue_invoices
       FROM quotes`,
    ),
    db.prepare(
      `SELECT id, reference, client_name, event_type, event_date, event_time, venue, guests, total_pence
       FROM quotes WHERE status = 'accepted' AND event_date >= date('now') ORDER BY event_date LIMIT 6`,
    ),
    db.prepare(
      `SELECT id, reference, status, client_name, event_type, event_date, total_pence, updated_at,
         line_items LIKE '%"needs_review":true%' AS needs_checking
       FROM quotes WHERE status IN ('draft', 'sent') ORDER BY status = 'draft' DESC, updated_at DESC LIMIT 6`,
    ),
    db.prepare(
      "SELECT id, subject, error, received_at FROM enquiries WHERE status = 'error' ORDER BY id DESC LIMIT 3",
    ),
    db.prepare(
      `SELECT id, reference, client_name, final_payment_due, total_pence FROM quotes
       WHERE status = 'accepted' AND final_payment_due BETWEEN date('now') AND date('now', '+14 days')
       ORDER BY final_payment_due LIMIT 6`,
    ),
  ]);
  return c.json({
    counts: counts.results[0],
    upcoming: upcoming.results,
    attention: attention.results,
    failed: failed.results,
    payments_due: payments.results,
  });
});

// --- SOP -----------------------------------------------------------------

app.get('/api/sop', async (c) => {
  const row = await c.env.DB.prepare('SELECT content, updated_by, updated_at FROM sop WHERE id = 1').first();
  return c.json(row);
});

app.put('/api/sop', requireAdmin, async (c) => {
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

app.put('/api/settings', requireAdmin, async (c) => {
  const b = await c.req.json<Record<string, unknown>>();
  await c.env.DB.prepare(
    `UPDATE settings SET business_name = ?, vat_rate_percent = ?, deposit_percent = ?, quote_valid_days = ?,
      quote_terms = ?, contact_lines = ?, footer_tagline = ?, questions_email = ?, bank_account_name = ?,
      bank_sort_code = ?, bank_account_number = ?, terms_url = ?, agreement_template = ?, updated_at = datetime('now')
      WHERE id = 1`,
  )
    .bind(
      str(b.business_name, 200) || 'Beyond Scrumptious',
      Math.min(100, Math.max(0, num(b.vat_rate_percent))),
      Math.min(100, Math.max(0, num(b.deposit_percent))),
      Math.max(1, Math.round(num(b.quote_valid_days, 14))),
      str(b.quote_terms, 20_000),
      str(b.contact_lines, 500),
      str(b.footer_tagline, 200),
      str(b.questions_email, 200),
      str(b.bank_account_name, 100),
      str(b.bank_sort_code, 20),
      str(b.bank_account_number, 20),
      /^https:\/\/[^\s]+$/.test(str(b.terms_url, 300)) ? str(b.terms_url, 300) : 'https://www.beyondscrumptious.com/terms-and-conditions',
      str(b.agreement_template, 30_000),
    )
    .run();
  return c.json({ ok: true });
});

// --- Price list --------------------------------------------------------------

function priceFields(b: Record<string, unknown>) {
  const name = str(b.name, 200).trim();
  if (!name) throw new UserError('A price list item needs a name');
  return [
    name,
    str(b.category, 100),
    str(b.unit, 50) || 'each',
    Math.min(100_000_000, Math.max(0, Math.round(num(b.price_pence)))),
    str(b.notes, 1000),
    b.active === false || b.active === 0 ? 0 : 1,
  ] as const;
}

app.get('/api/prices', async (c) => c.json(await getPriceList(c.env.DB, true)));

app.post('/api/prices', requireAdmin, async (c) => {
  const row = await c.env.DB.prepare(
    'INSERT INTO price_items (name, category, unit, price_pence, notes, active) VALUES (?, ?, ?, ?, ?, ?) RETURNING id',
  )
    .bind(...priceFields(await c.req.json()))
    .first<{ id: number }>();
  return c.json(row, 201);
});

app.put('/api/prices/:id', requireAdmin, async (c) => {
  await c.env.DB.prepare(
    "UPDATE price_items SET name = ?, category = ?, unit = ?, price_pence = ?, notes = ?, active = ?, updated_at = datetime('now') WHERE id = ?",
  )
    .bind(...priceFields(await c.req.json()), idParam(c.req.param('id')))
    .run();
  return c.json({ ok: true });
});

// Items are archived rather than deleted so old quotes still make sense.
app.delete('/api/prices/:id', requireAdmin, async (c) => {
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
app.post('/api/enquiries', draftLimit, async (c) => {
  const form = await c.req.formData();
  const parts: string[] = [];
  const pasted = str(form.get('text'), MAX_TEXT).trim();
  if (pasted) parts.push(pasted);
  const file = form.get('file');
  if (file && typeof file !== 'string') {
    const chat = chatTextFromAttachment(str(file.name, 300), str(file.type, 100), new Uint8Array(await file.arrayBuffer()));
    if (!chat) return c.json({ error: 'Upload a WhatsApp export (.txt or .zip).' }, 400);
    parts.push(chat);
  }
  if (!parts.length) return c.json({ error: 'Paste a chat or choose a file.' }, 400);
  await checkDailyDraftCap(c.env);

  const by = c.get('userEmail');
  const enquiryId = await saveEnquiry(c.env, 'paste', by, str(form.get('subject'), 300), parts.join('\n\n'));
  try {
    const quoteId = await processEnquiry(c.env, enquiryId, by);
    return c.json({ enquiry_id: enquiryId, quote_id: quoteId }, 201);
  } catch (err) {
    return c.json({ enquiry_id: enquiryId, error: publicMessage(err) }, 502);
  }
});

app.post('/api/enquiries/:id/draft', draftLimit, async (c) => {
  await checkDailyDraftCap(c.env);
  const quoteId = await processEnquiry(c.env, idParam(c.req.param('id')), c.get('userEmail'));
  return c.json({ quote_id: quoteId });
});

app.delete('/api/enquiries/:id', requireAdmin, async (c) => {
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
  const guests = b.guests === null || b.guests === '' ? null : Math.min(100_000, Math.max(0, Math.round(num(b.guests))));
  const update: QuoteUpdate = {
    status: (QUOTE_STATUSES as readonly string[]).includes(status) ? status : 'draft',
    client_name: str(b.client_name, 200),
    client_phone: str(b.client_phone, 50),
    client_email: str(b.client_email, 200),
    client_address: str(b.client_address, 500),
    event_type: str(b.event_type, 200),
    event_date: isoDate(b.event_date),
    event_time: str(b.event_time, 100),
    venue: str(b.venue, 500),
    guests,
    summary: str(b.summary),
    line_items: sanitiseLineItems(b.line_items),
    discount_pence: Math.min(100_000_000, Math.max(0, Math.round(num(b.discount_pence)))),
    vat_rate_percent: Math.min(100, Math.max(0, num(b.vat_rate_percent))),
    deposit_percent: Math.min(100, Math.max(0, num(b.deposit_percent))),
    deposit_fixed_pence:
      b.deposit_fixed_pence === null || b.deposit_fixed_pence === '' || b.deposit_fixed_pence === undefined
        ? null
        : Math.min(100_000_000, Math.max(0, Math.round(num(b.deposit_fixed_pence)))),
    client_notes: str(b.client_notes, 20_000),
    internal_notes: str(b.internal_notes, 20_000),
    questions: Array.isArray(b.questions) ? b.questions.slice(0, 50).map((q) => str(q, 500)) : [],
    reply_message: str(b.reply_message, 20_000),
    final_payment_due: isoDate(b.final_payment_due),
    payment_rule: (PAYMENT_RULES as readonly string[]).includes(str(b.payment_rule, 20)) ? str(b.payment_rule, 20) : '',
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
  await updateQuote(c.env.DB, id, { ...source, status: 'draft', payment_rule: source.payment_rule ?? '' }, by);
  return c.json({ id }, 201);
});

app.delete('/api/quotes/:id', requireAdmin, async (c) => {
  const id = idParam(c.req.param('id'));
  const invoiced = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM invoices WHERE quote_id = ?').bind(id).first<{ n: number }>();
  if (invoiced?.n) throw new UserError('This quote has invoices, so it can’t be deleted. Void the invoices instead.', 409);
  const agreed = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM agreements WHERE quote_id = ?').bind(id).first<{ n: number }>();
  if (agreed?.n) throw new UserError('This quote has a booking agreement, so it can’t be deleted. Void the agreement instead.', 409);
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM prep_sheets WHERE quote_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM quotes WHERE id = ?').bind(id),
  ]);
  return c.json({ ok: true });
});

// --- Invoices ------------------------------------------------------------------

const INVOICE_LIST_COLUMNS = `i.id, i.number, i.kind, i.status, i.issued_on, i.due_on, i.paid_on, i.amount_due_pence,
  i.total_pence, i.quote_id, i.freeagent_url, json_extract(i.snapshot, '$.client_name') AS client_name,
  json_extract(i.snapshot, '$.quote_reference') AS quote_reference, json_extract(i.snapshot, '$.event_date') AS event_date`;

app.get('/api/invoices', async (c) => {
  const status = str(c.req.query('status'), 20);
  const { results } = await c.env.DB.prepare(
    `SELECT ${INVOICE_LIST_COLUMNS} FROM invoices i WHERE (?1 = '' OR i.status = ?1) ORDER BY i.id DESC LIMIT 300`,
  )
    .bind(status)
    .all();
  return c.json(results);
});

app.get('/api/quotes/:id/invoices', async (c) => {
  const id = idParam(c.req.param('id'));
  const [{ results }, deposit] = await Promise.all([
    c.env.DB.prepare(`SELECT ${INVOICE_LIST_COLUMNS} FROM invoices i WHERE i.quote_id = ? ORDER BY i.id`).bind(id).all(),
    paidDeposit(c.env.DB, id),
  ]);
  return c.json({ invoices: results, paid_deposit: deposit });
});

app.post('/api/quotes/:id/invoices', async (c) => {
  const id = idParam(c.req.param('id'));
  const b = await c.req.json<Record<string, unknown>>();
  const kind = str(b.kind, 10) as InvoiceKind;
  if (!INVOICE_KINDS.includes(kind)) throw new UserError('Choose a deposit, balance or full invoice.');
  const issuedOn = isoDate(b.issued_on);
  const dueOn = isoDate(b.due_on);
  if (!issuedOn || !dueOn) throw new UserError('Enter the invoice date and the due date.');
  const quote = await c.env.DB.prepare('SELECT * FROM quotes WHERE id = ?').bind(id).first<QuoteRow>();
  if (!quote) throw new UserError('Not found', 404);
  // With FreeAgent connected, continue its invoice sequence so the numbers always match.
  let freeAgentNext: NumberSequence | null = null;
  let warning = '';
  if ((await freeagent.connectionStatus(c.env)).connected) {
    try {
      freeAgentNext = (await freeagent.nextFreeAgentInvoiceNumber(c.env))?.next ?? null;
    } catch (err) {
      console.error('Could not read FreeAgent invoice numbers', err);
      warning = "Couldn't check FreeAgent's latest invoice number, so the app's own sequence was used. Check it matches before sending.";
    }
  }
  const created = await createInvoice(c.env.DB, quote, {
    kind,
    issued_on: issuedOn,
    due_on: dueOn,
    deposit_paid_pence: Math.min(100_000_000, Math.max(0, Math.round(num(b.deposit_paid_pence)))),
    deposit_paid_on: isoDate(b.deposit_paid_on),
  }, c.get('userEmail'), freeAgentNext);
  return c.json({ ...created, warning }, 201);
});

/**
 * An invoice typed in by hand, for one-off jobs without a quote. It's stored as an accepted quote
 * marked "Manual invoice" so it shares numbering, the frozen copy, paid tracking and FreeAgent.
 */
app.post('/api/invoices/manual', async (c) => {
  const b = await c.req.json<Record<string, unknown>>();
  const issuedOn = isoDate(b.issued_on);
  const dueOn = isoDate(b.due_on);
  if (!issuedOn || !dueOn) throw new UserError('Enter the invoice date and the due date.');
  const items = sanitiseLineItems(b.line_items)
    .filter((i) => i.description.trim() && i.quantity !== 0)
    .map((i) => ({ ...i, needs_review: false, review_reason: '' }));
  if (!items.length) throw new UserError('Add at least one line.');
  const by = c.get('userEmail');
  const quoteId = await createQuoteFromDraft(c.env.DB, null, emptyDraft(), by);
  const settings = await getSettings(c.env.DB);
  await updateQuote(c.env.DB, quoteId, {
    status: 'accepted',
    client_name: str(b.client_name, 200),
    client_phone: str(b.client_phone, 50),
    client_email: str(b.client_email, 200),
    client_address: str(b.client_address, 500),
    event_type: str(b.event_type, 200),
    event_date: isoDate(b.event_date),
    event_time: '',
    venue: str(b.venue, 500),
    guests: null,
    summary: 'Manual invoice',
    line_items: items,
    discount_pence: Math.min(100_000_000, Math.max(0, Math.round(num(b.discount_pence)))),
    vat_rate_percent: settings.vat_rate_percent,
    deposit_percent: 0,
    deposit_fixed_pence: null,
    client_notes: str(b.client_notes, 20_000),
    internal_notes: 'Created as a manual invoice.',
    questions: [],
    reply_message: '',
    final_payment_due: dueOn,
    payment_rule: 'custom',
  }, by);
  const quote = await c.env.DB.prepare('SELECT * FROM quotes WHERE id = ?').bind(quoteId).first<QuoteRow>();
  let freeAgentNext: NumberSequence | null = null;
  let warning = '';
  if ((await freeagent.connectionStatus(c.env)).connected) {
    try {
      freeAgentNext = (await freeagent.nextFreeAgentInvoiceNumber(c.env))?.next ?? null;
    } catch (err) {
      console.error('Could not read FreeAgent invoice numbers', err);
      warning = "Couldn't check FreeAgent's latest invoice number, so the app's own sequence was used. Check it matches before sending.";
    }
  }
  try {
    const created = await createInvoice(c.env.DB, quote!, { kind: 'full', issued_on: issuedOn, due_on: dueOn }, by, freeAgentNext);
    return c.json({ ...created, quote_id: quoteId, warning }, 201);
  } catch (err) {
    // Don't leave a stray record behind if the invoice couldn't be issued.
    await c.env.DB.prepare('DELETE FROM quotes WHERE id = ?').bind(quoteId).run();
    throw err;
  }
});

app.get('/api/invoices/:id', async (c) => {
  const row = await c.env.DB.prepare('SELECT * FROM invoices WHERE id = ?').bind(idParam(c.req.param('id'))).first<InvoiceRow>();
  return row ? c.json(invoiceToJson(row)) : c.json({ error: 'Not found' }, 404);
});

// The "next" shown is what the next invoice will really get: never a number already used.
app.get('/api/invoice-numbering', async (c) => {
  const seq = await nextInvoiceSequence(c.env.DB, null);
  return c.json({ ...seq, next_reference: formatReference(seq) });
});

app.put('/api/invoice-numbering', requireAdmin, async (c) => {
  const b = await c.req.json<Record<string, unknown>>();
  const prefix = str(b.prefix, 12);
  if (!/^[A-Za-z0-9 \-_/.]*$/.test(prefix)) throw new UserError('The prefix can use letters, numbers, spaces and - _ / . only.');
  const seq = {
    prefix,
    next: Math.min(999_999_999, Math.max(1, Math.round(num(b.next, 1)))),
    width: Math.min(9, Math.max(1, Math.round(num(b.width, 4)))),
  };
  await setNumbering(c.env.DB, seq);
  const effective = await nextInvoiceSequence(c.env.DB, null);
  return c.json({ ...effective, next_reference: formatReference(effective) });
});

/** Sets the next app invoice number to follow FreeAgent's latest one. */
app.post('/api/invoice-numbering/match-freeagent', requireAdmin, async (c) => {
  const found = await freeagent.nextFreeAgentInvoiceNumber(c.env);
  if (!found) throw new UserError('FreeAgent has no invoices yet, so the app keeps its own numbering.', 404);
  const seq = await nextInvoiceSequence(c.env.DB, found.next);
  await setNumbering(c.env.DB, seq);
  return c.json({ ...seq, next_reference: formatReference(seq), freeagent_latest: found.latest });
});

// Paid / not paid. Voided invoices stay void.
app.post('/api/invoices/:id/status', async (c) => {
  const b = await c.req.json<Record<string, unknown>>();
  const paid = b.status === 'paid';
  const paidOn = paid ? isoDate(b.paid_on) : '';
  if (paid && !paidOn) throw new UserError('Enter the date it was paid.');
  const result = await c.env.DB.prepare(
    `UPDATE invoices SET status = ?, paid_on = ?, updated_by = ?, updated_at = datetime('now')
     WHERE id = ? AND status <> 'void'`,
  )
    .bind(paid ? 'paid' : 'issued', paidOn, c.get('userEmail'), idParam(c.req.param('id')))
    .run();
  if (!result.meta.changes) throw new UserError('That invoice is void, or doesn’t exist.', 409);
  return c.json({ ok: true });
});

// Invoices are never deleted, so their numbers are never reused.
app.post('/api/invoices/:id/void', requireAdmin, async (c) => {
  await c.env.DB.prepare(
    "UPDATE invoices SET status = 'void', updated_by = ?, updated_at = datetime('now') WHERE id = ?",
  )
    .bind(c.get('userEmail'), idParam(c.req.param('id')))
    .run();
  return c.json({ ok: true });
});

app.post('/api/invoices/:id/freeagent', async (c) => {
  const id = idParam(c.req.param('id'));
  const claim = await c.env.DB.prepare(
    "UPDATE invoices SET freeagent_status = 'sending' WHERE id = ? AND status <> 'void' AND freeagent_status IS NULL",
  )
    .bind(id)
    .run();
  if (!claim.meta.changes) throw new UserError('This invoice is void or already in FreeAgent.', 409);
  let created = false;
  try {
    const row = await c.env.DB.prepare('SELECT * FROM invoices WHERE id = ?').bind(id).first<InvoiceRow>();
    const url = await freeagent.sendInvoice(c.env, row!, async (webUrl) => {
      created = true;
      await c.env.DB.prepare(
        "UPDATE invoices SET freeagent_status = 'sent', freeagent_url = ?, freeagent_sent_at = datetime('now') WHERE id = ?",
      )
        .bind(webUrl, id)
        .run();
    });
    return c.json({ url });
  } catch (err) {
    // Only release it if nothing was created in FreeAgent, so retrying can't make a duplicate.
    if (!created) await c.env.DB.prepare('UPDATE invoices SET freeagent_status = NULL WHERE id = ?').bind(id).run();
    throw err;
  }
});

// --- Booking agreements (staff) -----------------------------------------------------

const signingLink = (c: { env: Env }, token: string) => `https://${c.env.SIGNING_HOST || 'sign.beyondscrumptious.com'}/${token}`;

app.get('/api/quotes/:id/agreements', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT id, number, status, expires_at, signed_name, signed_at, created_by, created_at FROM agreements
     WHERE quote_id = ? ORDER BY id`,
  )
    .bind(idParam(c.req.param('id')))
    .all();
  return c.json(results);
});

app.post('/api/quotes/:id/agreements', async (c) => {
  const quote = await c.env.DB.prepare('SELECT * FROM quotes WHERE id = ?').bind(idParam(c.req.param('id'))).first<QuoteRow>();
  if (!quote) throw new UserError('Not found', 404);
  // The agreement's blanks are filled from the quote and the event prep sheet.
  const deposit = await c.env.DB.prepare(
    "SELECT number FROM invoices WHERE quote_id = ? AND kind IN ('deposit', 'full') AND status <> 'void' ORDER BY id LIMIT 1",
  )
    .bind(quote.id)
    .first<{ number: string }>();
  const { id, token } = await createAgreement(c.env.DB, quote, await getSettings(c.env.DB), {
    prep: (await loadPrep(c.env.DB, quote.id)).data,
    paymentReference: deposit?.number ?? '',
  }, c.get('userEmail'));
  // With online signing off, the agreement is downloaded and sent by hand, so no link is given out.
  return c.json({ id, link: onlineSigning(c.env) ? signingLink(c, token) : '' }, 201);
});

app.get('/api/agreements/:id', async (c) => {
  const row = await c.env.DB.prepare('SELECT * FROM agreements WHERE id = ?').bind(idParam(c.req.param('id'))).first<AgreementRow>();
  return row ? c.json(agreementToJson(row)) : c.json({ error: 'Not found' }, 404);
});

/** A fresh signing link; the previous one stops working. */
app.post('/api/agreements/:id/link', async (c) => {
  const token = await renewLink(c.env.DB, idParam(c.req.param('id')));
  return c.json({ link: signingLink(c, token) });
});

/** Records a signed copy received back (on paper or as a signed PDF) when online signing isn't used. */
app.post('/api/agreements/:id/mark-signed', async (c) => {
  const b = await c.req.json<Record<string, unknown>>();
  const name = str(b.signed_name, 100).replace(/\s+/g, ' ').trim();
  const date = isoDate(b.signed_on);
  if (name.length < 2 || !date) throw new UserError('Enter the name of the person who signed and the date.');
  const result = await c.env.DB.prepare(
    `UPDATE agreements SET status = 'signed', signed_name = ?, signed_at = ?, signed_ip = '',
       signed_user_agent = ?, updated_at = datetime('now')
     WHERE id = ? AND status = 'sent'`,
  )
    .bind(name, `${date} 12:00:00`, `Signed copy received, recorded by ${c.get('userEmail')}`, idParam(c.req.param('id')))
    .run();
  if (!result.meta.changes) throw new UserError('Only agreements waiting for a signature can be marked as signed.', 409);
  return c.json({ ok: true });
});

app.post('/api/agreements/:id/void', requireAdmin, async (c) => {
  await c.env.DB.prepare("UPDATE agreements SET status = 'void', updated_at = datetime('now') WHERE id = ?")
    .bind(idParam(c.req.param('id')))
    .run();
  return c.json({ ok: true });
});

// --- Event prep sheets -------------------------------------------------------------

async function loadPrep(db: D1Database, quoteId: number): Promise<{ data: PrepData; updated_by: string | null; updated_at: string | null }> {
  const row = await db.prepare('SELECT data, updated_by, updated_at FROM prep_sheets WHERE quote_id = ?').bind(quoteId)
    .first<{ data: string; updated_by: string | null; updated_at: string }>();
  return row ? { data: sanitisePrep(JSON.parse(row.data)), updated_by: row.updated_by, updated_at: row.updated_at }
    : { data: emptyPrep(), updated_by: null, updated_at: null };
}

async function savePrep(db: D1Database, quoteId: number, data: PrepData, by: string) {
  await db.prepare(
    `INSERT INTO prep_sheets (quote_id, data, updated_by, updated_at) VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT (quote_id) DO UPDATE SET data = excluded.data, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
  )
    .bind(quoteId, JSON.stringify(data), by)
    .run();
}

app.get('/api/quotes/:id/prep', async (c) => {
  const id = idParam(c.req.param('id'));
  const quote = await c.env.DB.prepare('SELECT enquiry_id FROM quotes WHERE id = ?').bind(id).first<{ enquiry_id: number | null }>();
  if (!quote) throw new UserError('Not found', 404);
  return c.json({ ...(await loadPrep(c.env.DB, id)), has_chat: quote.enquiry_id !== null });
});

app.put('/api/quotes/:id/prep', async (c) => {
  const id = idParam(c.req.param('id'));
  const exists = await c.env.DB.prepare('SELECT 1 AS ok FROM quotes WHERE id = ?').bind(id).first();
  if (!exists) throw new UserError('Not found', 404);
  await savePrep(c.env.DB, id, sanitisePrep((await c.req.json<{ data?: unknown }>()).data), c.get('userEmail'));
  return c.json({ ok: true });
});

/** Fills empty prep fields from the original chat and the quote. Never overwrites what staff typed. */
app.post('/api/quotes/:id/prep/fill', draftLimit, async (c) => {
  const id = idParam(c.req.param('id'));
  const quote = await c.env.DB.prepare('SELECT * FROM quotes WHERE id = ?').bind(id).first<QuoteRow>();
  if (!quote) throw new UserError('Not found', 404);
  const enquiry = quote.enquiry_id
    ? await c.env.DB.prepare('SELECT raw_text FROM enquiries WHERE id = ?').bind(quote.enquiry_id).first<{ raw_text: string }>()
    : null;
  const found = await extractPrep(c.env, quote, enquiry?.raw_text ?? '');
  const { data } = await loadPrep(c.env.DB, id);
  const filled: string[] = [];
  for (const key of Object.keys(found) as (keyof PrepData)[]) {
    if (key === 'checklist' || key === 'filled_from_chat_at') continue;
    const value = String(found[key] ?? '').trim();
    if (value && !String(data[key] ?? '').trim()) { (data[key] as string) = value; filled.push(key); }
  }
  data.filled_from_chat_at = new Date().toISOString();
  await savePrep(c.env.DB, id, data, c.get('userEmail'));
  return c.json({ data, filled });
});

// --- FreeAgent ------------------------------------------------------------------

const freeagentCallback = (c: { req: { url: string } }) => `${new URL(c.req.url).origin}/api/freeagent/callback`;

app.get('/api/freeagent/status', async (c) => c.json(await freeagent.connectionStatus(c.env)));

// Plain links (not fetch calls): the browser goes to FreeAgent and comes back here.
app.get('/api/freeagent/connect', requireAdmin, async (c) => {
  if (!freeagent.isConfigured(c.env)) return c.text('Add the FreeAgent app ID and secret first (see README).', 400);
  return c.redirect(await freeagent.authoriseUrl(c.env, freeagentCallback(c)));
});

app.get('/api/freeagent/callback', requireAdmin, async (c) => {
  const error = c.req.query('error');
  const code = c.req.query('code');
  if (error || !code) return c.redirect(`/#/settings?freeagent=${encodeURIComponent(error || 'cancelled')}`);
  try {
    await freeagent.completeConnection(c.env, code, str(c.req.query('state'), 100), freeagentCallback(c), c.get('userEmail'));
    return c.redirect('/#/settings?freeagent=connected');
  } catch (err) {
    console.error(err);
    return c.redirect(`/#/settings?freeagent=${encodeURIComponent(publicMessage(err))}`);
  }
});

app.post('/api/freeagent/disconnect', requireAdmin, async (c) => {
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
        .bind(estimate.web_url, id)
        .run();
    });
    return c.json({ url: sent.web_url });
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
    const sender = message.from.toLowerCase();
    if (!isAllowedEmail(sender, env.ALLOWED_DOMAIN)) {
      message.setReject(`Only @${env.ALLOWED_DOMAIN} staff can send enquiries to this address.`);
      return;
    }
    if (message.rawSize > 25 * 1024 * 1024) {
      message.setReject('That email is too large. Export the chat without media.');
      return;
    }
    const recent = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM enquiries WHERE submitted_by = ? AND received_at >= datetime('now', '-1 hour')",
    )
      .bind(sender)
      .first<{ n: number }>();
    if ((recent?.n ?? 0) >= 30) {
      message.setReject('Too many enquiries from this address in the last hour. Try again later.');
      return;
    }
    let parsed;
    try {
      await checkDailyDraftCap(env);
      parsed = await parseInboundEmail(await new Response(message.raw).arrayBuffer());
    } catch (err) {
      console.error('Inbound email refused', err);
      message.setReject(publicMessage(err));
      return;
    }
    // The From header must match the sender and pass DMARC, so a forged staff address is refused.
    if (parsed.from.toLowerCase() !== sender || parsed.dmarcFailed) {
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
