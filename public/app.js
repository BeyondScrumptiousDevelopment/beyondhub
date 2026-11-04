'use strict';

// ---------- helpers ----------

const app = document.getElementById('app');

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function money(pence) {
  return '£' + (Number(pence || 0) / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function toPence(pounds) {
  const n = Number(String(pounds).replace(/[£,\s]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

function toPounds(pence) {
  return (Number(pence || 0) / 100).toFixed(2);
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso.length === 10 ? iso + 'T00:00:00' : iso.replace(' ', 'T') + 'Z');
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function toast(message, isError = false) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.className = 'toast no-print' + (isError ? ' error' : '');
  el.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { el.hidden = true; }, isError ? 7000 : 2500);
}

async function api(path, options = {}) {
  // The server rejects changes without this header, which other websites can't add.
  const init = { ...options, headers: { 'X-Requested-With': 'beyondhub', ...(options.headers || {}) } };
  if (options.json !== undefined) {
    init.body = JSON.stringify(options.json);
    init.headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(path, init);
  const type = res.headers.get('Content-Type') || '';
  const data = type.includes('application/json') ? await res.json() : await res.text();
  if (!res.ok) {
    const err = new Error((data && data.error) || (typeof data === 'string' && data) || `Request failed (${res.status})`);
    err.data = data;
    throw err;
  }
  return data;
}

function badge(status) {
  return `<span class="badge ${esc(status)}">${esc(status)}</span>`;
}

// Computes the same totals as the server (src/pricing.ts) so the editor updates live.
function computeTotals(items, discountPence, vatRate, depositPercent, depositFixedPence = null) {
  const lines = items.reduce((sum, i) => sum + Math.round(Number(i.quantity || 0) * Number(i.unit_price_pence || 0)), 0);
  const subtotal = Math.max(0, lines - Math.max(0, discountPence || 0));
  const vat = Math.round((subtotal * (vatRate || 0)) / 100);
  const total = subtotal + vat;
  const deposit = depositFixedPence !== null && depositFixedPence !== undefined
    ? Math.min(depositFixedPence, total)
    : Math.round((total * (depositPercent || 0)) / 100);
  return { lines, subtotal, vat, total, deposit };
}

function depositLabel(t, depositPercent, fixed) {
  if (t.deposit >= t.total) return 'Full payment to confirm the order';
  return fixed !== null && fixed !== undefined ? 'Deposit to secure the date' : `Deposit to secure the date (${depositPercent}%)`;
}

// ---------- payment dates ----------

const PAYMENT_RULES = {
  none: 'No set rule',
  pancake: 'Pancake Station: 1 month before the event',
  cake: 'Cake: 1 week before collection',
  custom: 'Custom date',
};

function isoToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function parseIso(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  return m ? { y: Number(m[1]), m: Number(m[2]) - 1, d: Number(m[3]) } : null;
}

function toIso(y, m, d) {
  const date = new Date(Date.UTC(y, m, d));
  return date.toISOString().slice(0, 10);
}

/** Same day of the month, n months away; 31 March minus a month is 28/29 February, not 3 March. */
function addMonths(iso, n) {
  const p = parseIso(iso);
  if (!p) return '';
  const target = new Date(Date.UTC(p.y, p.m + n, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  return toIso(target.getUTCFullYear(), target.getUTCMonth(), Math.min(p.d, lastDay));
}

function addDays(iso, n) {
  const p = parseIso(iso);
  return p ? toIso(p.y, p.m, p.d + n) : '';
}

function daysBetween(fromIso, toIsoDate) {
  const a = parseIso(fromIso);
  const b = parseIso(toIsoDate);
  if (!a || !b) return null;
  return Math.round((Date.UTC(b.y, b.m, b.d) - Date.UTC(a.y, a.m, a.d)) / 86400000);
}

function detectPaymentRule(items) {
  const text = items.map((i) => i.description).join(' ');
  if (/pancake station/i.test(text)) return 'pancake';
  if (/\bcake\b/i.test(text)) return 'cake';
  return 'none';
}

function dueDateFromRule(rule, eventDate) {
  if (rule === 'pancake') return addMonths(eventDate, -1);
  if (rule === 'cake') return addDays(eventDate, -7);
  return '';
}

function longDate(iso) {
  const p = parseIso(iso);
  if (!p) return '';
  return new Date(Date.UTC(p.y, p.m, p.d)).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

// ---------- router ----------

const routes = {
  home: renderHome,
  quotes: renderQuotes,
  new: renderNewEnquiry,
  inbox: renderInbox,
  quote: renderQuote,
  invoices: renderInvoicesList,
  invoice: renderInvoice,
  enquiry: renderEnquiry,
  sop: renderSop,
  prices: renderPrices,
  settings: renderSettings,
};

let unsavedChanges = false;
let currentHash = location.hash;

async function route() {
  currentHash = location.hash;
  const [, name = 'home', id] = location.hash.split('?')[0].split('/');
  const section = { quote: 'quotes', invoice: 'invoices', enquiry: 'inbox' }[name] || name;
  document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.route === section));
  unsavedChanges = false;
  app.innerHTML = '<p class="muted">Loading…</p>';
  try {
    await (routes[name] || renderHome)(id);
  } catch (err) {
    app.innerHTML = `<div class="warn">${esc(err.message)}</div>`;
  }
}

window.addEventListener('hashchange', () => {
  if (unsavedChanges && !confirm('You have unsaved changes. Leave this page anyway?')) {
    history.replaceState(null, '', currentHash);
    return;
  }
  route();
});
window.addEventListener('beforeunload', (e) => { if (unsavedChanges) e.preventDefault(); });

const mePromise = api('/api/me').catch(() => ({ email: '' }));
mePromise.then((me) => {
  document.getElementById('me').textContent = me.email;
  // Hides admin-only buttons; the server refuses those actions for everyone else regardless.
  document.body.classList.toggle('not-admin', me.is_admin === false);
});
route();

// ---------- home ----------

function firstName(email) {
  const local = String(email || '').split('@')[0].split(/[._-]/)[0];
  return local ? local[0].toUpperCase() + local.slice(1) : '';
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

function shortDate(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

async function renderHome() {
  const [me, d] = await Promise.all([mePromise, api('/api/dashboard')]);
  const c = d.counts || {};
  const n = (v) => Number(v || 0);
  const name = firstName(me.email);
  const today = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  const tile = (href, label, value, sub) =>
    `<a class="tile" href="${href}"><div class="label">${label}</div><div class="value">${value}</div><div class="sub">${sub}</div></a>`;

  app.innerHTML = `
    <section class="hero">
      <p class="hello">${greeting()}${name ? `, <em>${esc(name)}</em>` : ''}</p>
      <p class="today">${esc(today)}</p>
      <label for="quick-text" class="muted">Paste a WhatsApp chat or enquiry to draft a quote</label>
      <textarea id="quick-text" placeholder="Paste the conversation here…"></textarea>
      <div class="row">
        <button id="quick-go" class="primary">Draft quote</button>
        <a class="button" href="#/new">Upload an export instead</a>
        <span id="quick-state" class="muted"></span>
      </div>
    </section>

    <div class="tiles">
      ${tile('#/quotes?status=draft', 'Needs checking', n(c.needs_checking), `${n(c.drafts)} draft${n(c.drafts) === 1 ? '' : 's'} in total`)}
      ${tile('#/quotes?status=sent', 'Awaiting reply', n(c.awaiting_reply), 'quotes sent to clients')}
      ${tile('#/quotes?status=accepted', 'Accepted this month', n(c.accepted_this_month), `${money(c.accepted_value_this_month)} booked`)}
      ${tile('#/quotes?status=accepted', 'Events coming up', n(c.events_next_30_days), 'in the next 30 days')}
      ${tile('#/invoices?status=issued', 'Unpaid invoices', n(c.unpaid_invoices), `${money(c.unpaid_value)} due${n(c.overdue_invoices) ? ` · ${n(c.overdue_invoices)} overdue` : ''}`)}
    </div>

    <div class="piping" aria-hidden="true"></div>

    <div class="home-cols">
      <section class="panel">
        <h2>Coming up</h2>
        ${d.upcoming.length ? d.upcoming.map((q) => `
          <a class="list-row" href="#/quote/${q.id}">
            <span class="when">${esc(shortDate(q.event_date))}</span>
            <span class="what"><div>${esc(q.client_name) || 'Client'} · ${esc(q.event_type) || 'Event'}</div>
              <div class="muted">${[q.event_time, q.venue, q.guests ? q.guests + ' guests' : ''].filter(Boolean).map(esc).join(' · ')}</div></span>
            <span class="amount">${money(q.total_pence)}</span>
          </a>`).join('') : '<p class="muted">No accepted bookings coming up yet.</p>'}
      </section>
      <section class="panel">
        <h2>Needs your attention</h2>
        ${(d.payments_due || []).map((q) => `
          <a class="list-row" href="#/quote/${q.id}">
            <span class="what"><div>${esc(q.client_name) || 'Client'} · ${esc(q.reference)}</div>
              <div class="muted">Final payment due ${esc(shortDate(q.final_payment_due))}</div></span>
            <span class="flag">Payment due</span>
          </a>`).join('')}
        ${d.failed.map((e) => `
          <a class="list-row" href="#/enquiry/${e.id}">
            <span class="what"><div>${esc(e.subject) || 'Enquiry'}</div><div class="muted">Couldn't draft: ${esc(e.error)}</div></span>
            <span class="flag">Retry</span>
          </a>`).join('')}
        ${d.attention.length ? d.attention.map((q) => `
          <a class="list-row" href="#/quote/${q.id}">
            <span class="what"><div>${esc(q.client_name) || 'Unknown client'} · ${esc(q.reference)}</div>
              <div class="muted">${q.status === 'sent' ? 'Sent, waiting for a reply' : 'Draft'}${q.event_date ? ' · ' + esc(shortDate(q.event_date)) : ''}</div></span>
            ${q.needs_checking ? '<span class="flag">Check prices</span>' : `<span class="amount">${money(q.total_pence)}</span>`}
          </a>`).join('') : (d.failed.length || (d.payments_due || []).length ? '' : '<p class="muted">All caught up.</p>')}
      </section>
    </div>`;

  document.getElementById('quick-go').addEventListener('click', async (e) => {
    const text = document.getElementById('quick-text').value.trim();
    if (!text) { toast('Paste a conversation first.', true); return; }
    const form = new FormData();
    form.set('text', text);
    e.target.disabled = true;
    document.getElementById('quick-state').textContent = 'Reading the chat and drafting your quote…';
    try {
      const res = await api('/api/enquiries', { method: 'POST', body: form });
      location.hash = `#/quote/${res.quote_id}`;
    } catch (err) {
      toast(err.message, true);
      if (err.data && err.data.enquiry_id) location.hash = `#/enquiry/${err.data.enquiry_id}`;
    } finally {
      e.target.disabled = false;
      const state = document.getElementById('quick-state');
      if (state) state.textContent = '';
    }
  });
}

// ---------- quotes list ----------

async function renderQuotes() {
  app.innerHTML = `
    <div class="row"><h1>Quotes</h1><span class="spacer"></span>
      <a class="button" href="#/new">New enquiry</a>
      <button id="blank">Blank quote</button></div>
    <div class="panel">
      <div class="row">
        <input id="search" placeholder="Search client, reference, venue…" style="flex:1;min-width:200px">
        <select id="status" style="width:auto">
          <option value="">All statuses</option><option>draft</option><option>sent</option><option>accepted</option><option>declined</option>
        </select>
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>Ref</th><th>Client</th><th>Event</th><th>Date</th><th class="num">Total</th><th>Status</th><th>Updated</th></tr></thead>
        <tbody id="rows"></tbody>
      </table></div>
    </div>`;
  const wantedStatus = new URLSearchParams(location.hash.split('?')[1] || '').get('status');
  if (wantedStatus) document.getElementById('status').value = wantedStatus;
  const load = async () => {
    const q = encodeURIComponent(document.getElementById('search').value);
    const status = encodeURIComponent(document.getElementById('status').value);
    const rows = await api(`/api/quotes?q=${q}&status=${status}`);
    document.getElementById('rows').innerHTML = rows.length
      ? rows.map((r) => `
        <tr class="clickable" data-id="${r.id}">
          <td>${esc(r.reference)}</td><td>${esc(r.client_name) || '<span class="muted">Unknown</span>'}</td>
          <td>${esc(r.event_type)}${r.guests ? ` · ${esc(r.guests)} guests` : ''}</td>
          <td>${esc(formatDate(r.event_date))}</td><td class="num">${money(r.total_pence)}</td>
          <td>${badge(r.status)}</td><td class="muted">${esc(formatDate(r.updated_at))}</td>
        </tr>`).join('')
      : '<tr><td colspan="7" class="muted">No quotes yet. Start with a new enquiry.</td></tr>';
  };
  let timer;
  document.getElementById('search').addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(load, 250); });
  document.getElementById('status').addEventListener('change', load);
  document.getElementById('rows').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-id]');
    if (tr) location.hash = `#/quote/${tr.dataset.id}`;
  });
  document.getElementById('blank').addEventListener('click', async () => {
    const { id } = await api('/api/quotes', { method: 'POST' });
    location.hash = `#/quote/${id}`;
  });
  await load();
}

// ---------- new enquiry ----------

async function renderNewEnquiry() {
  app.innerHTML = `
    <h1>New enquiry</h1>
    <div class="panel">
      <p class="muted">Paste the conversation, or upload a WhatsApp export (in the chat: ⋮ / contact name → Export chat → Without media).
      You can also email the export to your quotes address and it will appear in the Inbox.</p>
      <label>Label (optional)<input id="subject" placeholder="e.g. Sarah – 40th birthday"></label><br>
      <label>Conversation<textarea id="text" class="tall" placeholder="Paste the WhatsApp chat or email here"></textarea></label><br>
      <label>…or upload a WhatsApp export (.txt or .zip)<input id="file" type="file" accept=".txt,.zip,text/plain,application/zip"></label><br>
      <div class="row"><button id="go" class="primary">Draft quote</button><span id="state" class="muted"></span></div>
    </div>`;
  document.getElementById('go').addEventListener('click', async (e) => {
    const form = new FormData();
    form.set('subject', document.getElementById('subject').value);
    form.set('text', document.getElementById('text').value);
    const file = document.getElementById('file').files[0];
    if (file) form.set('file', file);
    e.target.disabled = true;
    document.getElementById('state').textContent = 'Reading the chat and drafting the quote. This usually takes under a minute…';
    try {
      const res = await api('/api/enquiries', { method: 'POST', body: form });
      location.hash = `#/quote/${res.quote_id}`;
    } catch (err) {
      toast(err.message, true);
      if (err.data && err.data.enquiry_id) location.hash = `#/enquiry/${err.data.enquiry_id}`;
    } finally {
      e.target.disabled = false;
      document.getElementById('state').textContent = '';
    }
  });
}

// ---------- inbox ----------

async function renderInbox() {
  const rows = await api('/api/enquiries');
  app.innerHTML = `
    <div class="row"><h1>Inbox</h1><span class="spacer"></span><button id="refresh">Refresh</button></div>
    <div class="panel"><div class="table-wrap"><table>
      <thead><tr><th>Received</th><th>From</th><th>Enquiry</th><th>Status</th><th></th></tr></thead>
      <tbody>${rows.length ? rows.map((r) => `
        <tr>
          <td class="muted">${esc(formatDate(r.received_at))}<br>${esc(r.source)}</td>
          <td>${esc(r.submitted_by)}</td>
          <td><a href="#/enquiry/${r.id}">${esc(r.subject) || 'Untitled'}</a><div class="muted">${esc(r.preview.slice(0, 140))}…</div>
            ${r.error ? `<div class="muted" style="color:var(--danger)">${esc(r.error)}</div>` : ''}</td>
          <td>${badge(r.status)}</td>
          <td class="num">${r.quote_id ? `<a class="button" href="#/quote/${r.quote_id}">Open quote</a>` : ''}</td>
        </tr>`).join('') : '<tr><td colspan="5" class="muted">Nothing here yet.</td></tr>'}</tbody>
    </table></div></div>`;
  document.getElementById('refresh').addEventListener('click', route);
}

async function renderEnquiry(id) {
  const e = await api(`/api/enquiries/${id}`);
  app.innerHTML = `
    <div class="row"><h1>${esc(e.subject) || 'Enquiry'}</h1><span class="spacer"></span>${badge(e.status)}</div>
    <div class="panel">
      <p class="muted">${esc(e.source)} · ${esc(e.submitted_by)} · ${esc(formatDate(e.received_at))}</p>
      ${e.error ? `<div class="warn">${esc(e.error)}</div><br>` : ''}
      <pre class="raw">${esc(e.raw_text)}</pre>
      <div class="row">
        <button id="draft" class="primary">${e.status === 'drafted' ? 'Draft another quote' : 'Draft quote'}</button>
        <button id="delete" class="danger admin-only">Delete enquiry</button>
        <span id="state" class="muted"></span>
      </div>
    </div>`;
  document.getElementById('draft').addEventListener('click', async (ev) => {
    ev.target.disabled = true;
    document.getElementById('state').textContent = 'Drafting…';
    try {
      const res = await api(`/api/enquiries/${id}/draft`, { method: 'POST' });
      location.hash = `#/quote/${res.quote_id}`;
    } catch (err) {
      toast(err.message, true);
      route();
    }
  });
  document.getElementById('delete').addEventListener('click', async () => {
    if (!confirm('Delete this enquiry? Any quotes made from it are kept.')) return;
    await api(`/api/enquiries/${id}`, { method: 'DELETE' });
    location.hash = '#/inbox';
  });
}

// ---------- quote editor ----------

async function renderQuote(id) {
  const [quote, prices, settings, fa] = await Promise.all([
    api(`/api/quotes/${id}`), api('/api/prices'), api('/api/settings'), api('/api/freeagent/status'),
  ]);
  const activePrices = prices.filter((p) => p.active);
  const q = quote;

  const field = (key, label, type = 'text') =>
    `<label>${label}<input data-field="${key}" type="${type}" value="${esc(q[key] ?? '')}"></label>`;

  app.innerHTML = `
    <div class="editor">
      <div class="row">
        <h1>${esc(q.reference)}</h1>
        <select data-field="status" style="width:auto">${['draft', 'sent', 'accepted', 'declined']
          .map((s) => `<option ${s === q.status ? 'selected' : ''}>${s}</option>`).join('')}</select>
        <span class="spacer"></span>
        ${q.enquiry_id ? `<a class="button" href="#/enquiry/${q.enquiry_id}">View enquiry</a>` : ''}
        ${/^https:\/\/[a-z0-9-]+\.freeagent\.com\//.test(q.freeagent_url || '') ? `<a class="button" href="${esc(q.freeagent_url)}" target="_blank" rel="noopener noreferrer">Open in FreeAgent</a>` : ''}
        ${fa.connected && !q.freeagent_status ? `<button id="freeagent" ${q.status === 'accepted' ? '' : 'disabled'} title="For accepted quotes">Send to FreeAgent</button>` : ''}
        <button id="pdf">Download PDF</button>
        <button id="duplicate">Duplicate</button>
        <button id="delete" class="danger admin-only">Delete</button>
        <button id="save" class="primary">Save</button>
      </div>
      <p class="muted">Created by ${esc(q.created_by)} · last saved ${esc(formatDate(q.updated_at))} by ${esc(q.updated_by)}
        ${q.freeagent_sent_at ? ` · sent to FreeAgent ${esc(formatDate(q.freeagent_sent_at))}. Later edits here don't update FreeAgent.` : ''}</p>

      <div id="review-warning"></div>

      <div class="panel">
        <h2 style="margin-top:0">Client and event</h2>
        <div class="grid">
          ${field('client_name', 'Client name')}${field('client_phone', 'Phone')}${field('client_email', 'Email', 'email')}
          ${field('event_type', 'Event type')}${field('event_date', 'Event date', 'date')}${field('event_time', 'Time')}
          ${field('venue', 'Venue')}${field('guests', 'Guests', 'number')}
          <label>Billing address<textarea data-field="client_address" rows="2" style="min-height:0">${esc(q.client_address ?? '')}</textarea></label>
        </div><br>
        <label>Summary<textarea data-field="summary">${esc(q.summary)}</textarea></label>
      </div>

      <div class="panel">
        <h2 style="margin-top:0">Line items</h2>
        <div class="table-wrap"><table>
          <thead><tr><th style="width:40%">Description</th><th class="num">Qty</th><th>Unit</th><th class="num">Unit price £</th><th class="num">Line total</th><th></th></tr></thead>
          <tbody id="lines"></tbody>
        </table></div><br>
        <div class="row">
          <select id="add-price" style="width:auto;max-width:100%">
            <option value="">Add from price list…</option>
            ${activePrices.map((p) => `<option value="${p.id}">${esc(p.category ? p.category + ' – ' : '')}${esc(p.name)} (${money(p.price_pence)} / ${esc(p.unit)})</option>`).join('')}
          </select>
          <button id="add-custom">Add custom line</button>
        </div>
        <br>
        <div class="row" style="align-items:flex-start">
          <div class="grid" style="flex:1;min-width:240px">
            <label>Discount £<input id="discount" type="number" step="0.01" min="0" value="${toPounds(q.discount_pence)}"></label>
            <label>VAT %<input id="vat" type="number" step="0.1" min="0" value="${esc(q.vat_rate_percent)}"></label>
            <label>Deposit %<input id="deposit" type="number" step="1" min="0" value="${esc(q.deposit_percent)}"></label>
            <label>…or fixed deposit £<input id="deposit-fixed" type="number" step="0.01" min="0" placeholder="Uses % if empty"
              value="${q.deposit_fixed_pence === null ? '' : toPounds(q.deposit_fixed_pence)}"></label>
          </div>
          <div class="totals" id="totals"></div>
        </div>
      </div>

      <div class="panel" id="invoices-panel">
        <h2 style="margin-top:0">Invoices</h2>
        <div id="invoice-list"></div>
        <div id="invoice-new"></div>
      </div>

      <div class="panel">
        <h2 style="margin-top:0">Payment dates</h2>
        <div class="grid">
          <label>Final payment rule<select id="pay-rule">${Object.entries(PAYMENT_RULES)
            .map(([value, label]) => `<option value="${value}">${esc(label)}</option>`).join('')}</select></label>
          <label>Final payment due<input id="pay-due" type="date"></label>
          <label>Invoice issue date<input id="pay-issue" type="date" value="${isoToday()}"></label>
        </div>
        <div id="pay-result" style="margin-top:12px"></div>
      </div>

      <div class="panel">
        <h2 style="margin-top:0">Still to ask the client</h2>
        <textarea id="questions" placeholder="One question per line">${esc((q.questions || []).join('\n'))}</textarea>
        <h2>Notes on the quote (client sees these)</h2>
        <textarea data-field="client_notes">${esc(q.client_notes)}</textarea>
        <h2>Internal notes (staff only)</h2>
        <textarea data-field="internal_notes">${esc(q.internal_notes)}</textarea>
      </div>

      <div class="panel">
        <div class="row"><h2 style="margin:0">WhatsApp reply</h2><span class="spacer"></span><button id="copy">Copy</button></div><br>
        <textarea data-field="reply_message" style="min-height:200px">${esc(q.reply_message)}</textarea>
      </div>
    </div>
`;

  const items = (q.line_items || []).map((i) => ({ ...i }));

  function renderLines() {
    document.getElementById('lines').innerHTML = items.length ? items.map((i, idx) => `
      <tr class="${i.needs_review ? 'review' : ''}" data-idx="${idx}">
        <td><input data-k="description" value="${esc(i.description)}">
          ${i.needs_review ? `<div class="muted">⚠ ${esc(i.review_reason || 'Check this line')} <button data-act="ok" style="padding:2px 8px">Checked</button></div>` : ''}
          ${i.price_item_id ? '<div class="muted">From price list</div>' : ''}</td>
        <td class="num"><input data-k="quantity" type="number" step="any" value="${esc(i.quantity)}" style="width:80px"></td>
        <td><input data-k="unit" value="${esc(i.unit)}" style="width:110px"></td>
        <td class="num"><input data-k="unit_price" type="number" step="0.01" value="${toPounds(i.unit_price_pence)}" style="width:100px"></td>
        <td class="num">${money(Math.round(Number(i.quantity || 0) * Number(i.unit_price_pence || 0)))}</td>
        <td class="num"><button data-act="up" title="Move up">↑</button> <button data-act="remove" class="danger" title="Remove">✕</button></td>
      </tr>`).join('') : '<tr><td colspan="6" class="muted">No lines yet.</td></tr>';
    renderTotals();
  }

  function fixedDeposit() {
    const v = document.getElementById('deposit-fixed').value.trim();
    return v === '' ? null : toPence(v);
  }

  const payRule = document.getElementById('pay-rule');
  const payDue = document.getElementById('pay-due');
  const payIssue = document.getElementById('pay-issue');
  const eventDateInput = app.querySelector('[data-field="event_date"]');
  // Until someone picks a rule, suggest one from what's on the quote.
  payRule.value = q.payment_rule || detectPaymentRule(items);
  payDue.value = q.final_payment_due || dueDateFromRule(payRule.value, q.event_date);

  function refreshDueDate() {
    if (payRule.value !== 'custom') payDue.value = dueDateFromRule(payRule.value, eventDateInput.value);
    renderTotals();
  }
  payRule.addEventListener('change', () => { unsavedChanges = true; refreshDueDate(); });
  eventDateInput.addEventListener('change', refreshDueDate);
  payDue.addEventListener('input', () => { unsavedChanges = true; payRule.value = 'custom'; renderTotals(); });
  payIssue.addEventListener('input', () => renderTotals());

  function renderPayment(t) {
    const out = document.getElementById('pay-result');
    const due = payDue.value;
    if (!due) {
      out.innerHTML = `<p class="muted">${payRule.value !== 'none' && !eventDateInput.value ? 'Add the event date to work out the final payment date.' : 'Choose a rule, or set the final payment date yourself.'}</p>`;
      return;
    }
    const balance = t.total - (t.deposit < t.total ? t.deposit : 0);
    const days = daysBetween(payIssue.value, due);
    const terms = days === null ? null : Math.max(0, days);
    out.innerHTML = `
      <div class="row" style="align-items:center">
        <div><div class="muted">Payment terms to enter in FreeAgent</div>
          <div style="font: 400 30px/1.1 var(--font-head)">${terms === null ? '–' : `${terms} day${terms === 1 ? '' : 's'}`}</div></div>
        ${terms === null ? '' : '<button id="copy-terms">Copy</button>'}
      </div>
      <p style="margin:8px 0 0">${t.deposit && t.deposit < t.total ? 'Balance' : 'Payment'} of <strong>${money(balance)}</strong> due on <strong>${esc(longDate(due))}</strong>,
        counted from an invoice issued on ${esc(longDate(payIssue.value))}.</p>
      ${days !== null && days < 0 ? '<div class="warn" style="margin-top:8px">That due date is before the invoice date, so enter 0 days (due on receipt).</div>' : ''}`;
    const copy = document.getElementById('copy-terms');
    if (copy) copy.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(String(terms)); toast(`Copied ${terms}`); } catch { toast('Copy failed: type it in instead', true); }
    });
  }

  function renderTotals() {
    const t = computeTotals(items, toPence(document.getElementById('discount').value),
      Number(document.getElementById('vat').value), Number(document.getElementById('deposit').value), fixedDeposit());
    document.getElementById('totals').innerHTML = `
      <div><span>Items</span><span>${money(t.lines)}</span></div>
      ${t.lines !== t.subtotal ? `<div><span>Discount</span><span>−${money(t.lines - t.subtotal)}</span></div>` : ''}
      <div><span>Subtotal</span><span>${money(t.subtotal)}</span></div>
      ${t.vat ? `<div><span>VAT</span><span>${money(t.vat)}</span></div>` : ''}
      <div class="grand"><span>Total</span><span>${money(t.total)}</span></div>
      ${t.deposit ? `<div class="muted"><span>${esc(depositLabel(t, document.getElementById('deposit').value, fixedDeposit()))}</span><span>${money(t.deposit)}</span></div>` : ''}`;
    renderPayment(t);
    const flagged = items.filter((i) => i.needs_review).length;
    document.getElementById('review-warning').innerHTML = flagged
      ? `<div class="warn">${flagged} line${flagged > 1 ? 's need' : ' needs'} checking before this quote goes out (highlighted below).</div><br>`
      : '';
  }

  const lines = document.getElementById('lines');
  lines.addEventListener('input', (e) => {
    const tr = e.target.closest('tr[data-idx]');
    if (!tr) return;
    const item = items[Number(tr.dataset.idx)];
    const k = e.target.dataset.k;
    if (k === 'unit_price') {
      item.unit_price_pence = toPence(e.target.value);
      item.price_item_id = null; // a hand-set price is no longer the list price
    } else if (k === 'quantity') {
      item.quantity = Number(e.target.value);
    } else {
      item[k] = e.target.value;
    }
    unsavedChanges = true;
    tr.children[4].textContent = money(Math.round(Number(item.quantity || 0) * Number(item.unit_price_pence || 0)));
    renderTotals();
  });
  lines.addEventListener('click', (e) => {
    const act = e.target.dataset.act;
    const tr = e.target.closest('tr[data-idx]');
    if (!act || !tr) return;
    const idx = Number(tr.dataset.idx);
    if (act === 'remove') items.splice(idx, 1);
    if (act === 'up' && idx > 0) [items[idx - 1], items[idx]] = [items[idx], items[idx - 1]];
    if (act === 'ok') { items[idx].needs_review = false; items[idx].review_reason = ''; }
    unsavedChanges = true;
    renderLines();
  });
  document.getElementById('add-price').addEventListener('change', (e) => {
    const p = activePrices.find((x) => String(x.id) === e.target.value);
    if (!p) return;
    items.push({ description: p.name, quantity: 1, unit: p.unit, unit_price_pence: p.price_pence, price_item_id: p.id, needs_review: false, review_reason: '' });
    e.target.value = '';
    unsavedChanges = true;
    renderLines();
  });
  document.getElementById('add-custom').addEventListener('click', () => {
    items.push({ description: '', quantity: 1, unit: 'each', unit_price_pence: 0, price_item_id: null, needs_review: false, review_reason: '' });
    unsavedChanges = true;
    renderLines();
  });
  ['discount', 'vat', 'deposit', 'deposit-fixed'].forEach((id) => document.getElementById(id).addEventListener('input', () => { unsavedChanges = true; renderTotals(); }));
  app.querySelectorAll('[data-field], #questions').forEach((el) => el.addEventListener('input', () => { unsavedChanges = true; }));

  function collect() {
    const data = { ...q };
    app.querySelectorAll('[data-field]').forEach((el) => { data[el.dataset.field] = el.value; });
    data.guests = data.guests === '' ? null : Number(data.guests);
    data.line_items = items;
    data.discount_pence = toPence(document.getElementById('discount').value);
    data.vat_rate_percent = Number(document.getElementById('vat').value);
    data.deposit_percent = Number(document.getElementById('deposit').value);
    data.deposit_fixed_pence = fixedDeposit();
    data.payment_rule = payRule.value;
    data.final_payment_due = payDue.value;
    data.questions = document.getElementById('questions').value.split('\n').map((s) => s.trim()).filter(Boolean);
    return data;
  }

  async function save() {
    await api(`/api/quotes/${id}`, { method: 'PUT', json: collect() });
    unsavedChanges = false;
  }

  document.getElementById('save').addEventListener('click', async (e) => {
    e.target.disabled = true;
    try { await save(); toast('Saved'); } catch (err) { toast(err.message, true); } finally { e.target.disabled = false; }
  });
  document.getElementById('duplicate').addEventListener('click', async () => {
    if (unsavedChanges) await save();
    const res = await api(`/api/quotes/${id}/duplicate`, { method: 'POST' });
    location.hash = `#/quote/${res.id}`;
  });
  document.getElementById('delete').addEventListener('click', async () => {
    if (!confirm(`Delete quote ${q.reference}? This can't be undone.`)) return;
    await api(`/api/quotes/${id}`, { method: 'DELETE' });
    unsavedChanges = false;
    location.hash = '#/quotes';
  });
  document.getElementById('copy').addEventListener('click', async () => {
    const text = app.querySelector('[data-field="reply_message"]').value;
    try { await navigator.clipboard.writeText(text); toast('Copied – paste it into WhatsApp'); } catch { toast('Copy failed: select the text and copy it manually', true); }
  });
  const faButton = document.getElementById('freeagent');
  app.querySelector('[data-field="status"]').addEventListener('change', (e) => {
    if (faButton) faButton.disabled = e.target.value !== 'accepted';
  });
  if (faButton) faButton.addEventListener('click', async () => {
    if (unsavedChanges || collect().status !== q.status) await save();
    if (collect().status !== 'accepted') { toast('Set the status to accepted first.', true); return; }
    if (items.some((i) => i.needs_review)) { toast('Some lines still need checking. Mark them as checked first.', true); return; }
    if (!confirm(`Create ${q.reference} as an approved quote in FreeAgent? Nothing is emailed to the client.`)) return;
    faButton.disabled = true;
    faButton.textContent = 'Sending…';
    try {
      const res = await api(`/api/quotes/${id}/freeagent`, { method: 'POST' });
      toast('Created in FreeAgent');
      route();
      if (res.url) window.open(res.url, '_blank', 'noopener');
    } catch (err) {
      toast(err.message, true);
      route();
    }
  });
  document.getElementById('pdf').addEventListener('click', async (e) => {
    if (items.some((i) => i.needs_review) && !confirm('Some lines still need checking. Download anyway?')) return;
    e.target.disabled = true;
    try {
      await downloadQuoteDocument(collect(), settings);
    } catch (err) {
      toast(`Couldn't make the PDF: ${err.message}`, true);
    } finally {
      e.target.disabled = false;
    }
  });

  // ---- Invoices for this quote
  async function renderInvoices() {
    const { invoices, paid_deposit: paidDeposit } = await api(`/api/quotes/${id}/invoices`);
    const list = document.getElementById('invoice-list');
    const live = invoices.filter((i) => i.status !== 'void');
    list.innerHTML = invoices.length ? `<div class="table-wrap"><table>
      <thead><tr><th>Invoice</th><th>Type</th><th>Due</th><th class="num">Amount</th><th>Status</th><th></th></tr></thead>
      <tbody>${invoices.map((i) => `<tr>
        <td><a href="#/invoice/${i.id}">${esc(i.number)}</a></td><td>${esc(INVOICE_KIND_LABELS[i.kind])}</td>
        <td>${esc(formatDate(i.due_on))}</td><td class="num">${money(i.amount_due_pence)}</td><td>${badge(i.status)}</td>
        <td class="num"><button data-pdf="${i.id}">Download PDF</button></td></tr>`).join('')}</tbody></table></div>`
      : '<p class="muted">No invoices yet.</p>';
    list.querySelectorAll('[data-pdf]').forEach((b) => b.addEventListener('click', () => downloadInvoice(b.dataset.pdf, b)));

    const t = computeTotals(items, toPence(document.getElementById('discount').value),
      Number(document.getElementById('vat').value), Number(document.getElementById('deposit').value), fixedDeposit());
    const hasDeposit = t.deposit > 0 && t.deposit < t.total;
    const hasLive = (kind) => live.some((i) => i.kind === kind);
    // Suggest the next invoice: deposit first, then the balance once the deposit is paid.
    const suggested = !hasDeposit ? 'full' : !hasLive('deposit') ? 'deposit' : 'balance';
    const newBox = document.getElementById('invoice-new');
    if (collect().status !== 'accepted') {
      newBox.innerHTML = '<p class="muted">Set the quote to accepted to issue invoices.</p>';
      return;
    }
    if (live.some((i) => i.kind === 'full') || hasLive('balance')) {
      newBox.innerHTML = '<p class="muted">This booking has been fully invoiced.</p>';
      return;
    }
    newBox.innerHTML = `
      <div class="grid">
        <label>Invoice for<select id="inv-kind">
          ${hasDeposit && !hasLive('deposit') ? '<option value="deposit">Deposit</option>' : ''}
          ${hasDeposit ? '<option value="balance">Balance (after the deposit)</option>' : ''}
          ${!hasLive('deposit') ? '<option value="full">Full amount</option>' : ''}
        </select></label>
        <label>Invoice date<input id="inv-issued" type="date" value="${isoToday()}"></label>
        <label>Due<input id="inv-due" type="date"></label>
        <label class="inv-balance">Deposit paid £<input id="inv-dep" type="number" step="0.01" min="0"></label>
        <label class="inv-balance">Deposit paid on<input id="inv-dep-on" type="date"></label>
      </div>
      <p class="muted" id="inv-summary"></p>
      <button id="inv-create" class="primary">Issue invoice</button>`;
    const kindEl = document.getElementById('inv-kind');
    if ([...kindEl.options].some((o) => o.value === suggested)) kindEl.value = suggested;
    const dueEl = document.getElementById('inv-due');
    const depEl = document.getElementById('inv-dep');
    const depOnEl = document.getElementById('inv-dep-on');
    depEl.value = toPounds(paidDeposit ? paidDeposit.amount_due_pence : t.deposit);
    depOnEl.value = paidDeposit ? paidDeposit.paid_on : '';
    const refresh = () => {
      const kind = kindEl.value;
      app.querySelectorAll('.inv-balance').forEach((el) => { el.style.display = kind === 'balance' ? '' : 'none'; });
      // Deposits are due on receipt; balances and full payments by the final payment date.
      dueEl.value = kind === 'deposit' ? document.getElementById('inv-issued').value : (payDue.value || document.getElementById('inv-issued').value);
      const amount = kind === 'deposit' ? t.deposit : kind === 'balance' ? t.total - toPence(depEl.value) : t.total;
      document.getElementById('inv-summary').textContent = `Amount due: ${money(amount)}. The invoice is a copy of the quote as it is now, so save any changes first.`;
    };
    kindEl.addEventListener('change', refresh);
    depEl.addEventListener('input', refresh);
    document.getElementById('inv-issued').addEventListener('change', refresh);
    refresh();
    document.getElementById('inv-create').addEventListener('click', async (e) => {
      e.target.disabled = true;
      try {
        if (unsavedChanges) await save();
        const res = await api(`/api/quotes/${id}/invoices`, { method: 'POST', json: {
          kind: kindEl.value, issued_on: document.getElementById('inv-issued').value, due_on: dueEl.value,
          deposit_paid_pence: toPence(depEl.value), deposit_paid_on: depOnEl.value,
        } });
        if (res.warning) toast(res.warning, true); else toast(`Invoice ${res.number} issued`);
        location.hash = `#/invoice/${res.id}`;
      } catch (err) {
        toast(err.message, true);
        e.target.disabled = false;
      }
    });
  }
  app.querySelector('[data-field="status"]').addEventListener('change', () => renderInvoices().catch(() => {}));

  renderLines();
  renderInvoices().catch((err) => { document.getElementById('invoice-list').innerHTML = `<div class="warn">${esc(err.message)}</div>`; });
}

const INVOICE_KIND_LABELS = { deposit: 'Deposit', balance: 'Balance', full: 'Full amount' };

async function downloadInvoice(invoiceId, button) {
  if (button) button.disabled = true;
  try {
    const [inv, settings] = await Promise.all([api(`/api/invoices/${invoiceId}`), api('/api/settings')]);
    if (!settings.bank_account_number && !confirm('Your bank details are not set up in Settings yet, so the invoice will show blank payment details. Download anyway?')) return;
    await downloadInvoiceDocument(inv, settings);
  } catch (err) {
    toast(`Couldn't make the PDF: ${err.message}`, true);
  } finally {
    if (button) button.disabled = false;
  }
}

// ---------- invoices ----------

async function renderInvoicesList() {
  const wanted = new URLSearchParams(location.hash.split('?')[1] || '').get('status') || '';
  const rows = await api(`/api/invoices?status=${encodeURIComponent(wanted)}`);
  const today = isoToday();
  app.innerHTML = `
    <div class="row"><h1>Invoices</h1><span class="spacer"></span>
      <select id="inv-status" style="width:auto">
        <option value="">All</option><option value="issued">Unpaid</option><option value="paid">Paid</option><option value="void">Void</option>
      </select></div>
    <p class="muted">Issue invoices from an accepted quote's page. Each one is a frozen copy of its quote, so later edits to the quote don't change it.</p>
    <div class="panel"><div class="table-wrap"><table>
      <thead><tr><th>Invoice</th><th>Client</th><th>Type</th><th>Issued</th><th>Due</th><th class="num">Amount</th><th>Status</th></tr></thead>
      <tbody>${rows.length ? rows.map((i) => `
        <tr class="clickable" data-id="${i.id}">
          <td>${esc(i.number)}<div class="muted">${esc(i.quote_reference)}</div></td><td>${esc(i.client_name)}</td>
          <td>${esc(INVOICE_KIND_LABELS[i.kind])}</td><td>${esc(formatDate(i.issued_on))}</td>
          <td>${esc(formatDate(i.due_on))}${i.status === 'issued' && i.due_on < today ? ' <span class="flag">Overdue</span>' : ''}</td>
          <td class="num">${money(i.amount_due_pence)}</td><td>${badge(i.status === 'issued' ? 'unpaid' : i.status)}</td>
        </tr>`).join('') : '<tr><td colspan="7" class="muted">No invoices yet.</td></tr>'}</tbody>
    </table></div></div>`;
  const select = document.getElementById('inv-status');
  select.value = wanted;
  select.addEventListener('change', () => { location.hash = `#/invoices${select.value ? '?status=' + select.value : ''}`; });
  app.querySelector('tbody').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-id]');
    if (tr) location.hash = `#/invoice/${tr.dataset.id}`;
  });
}

async function renderInvoice(invoiceId) {
  const [inv, fa] = await Promise.all([api(`/api/invoices/${invoiceId}`), api('/api/freeagent/status')]);
  const s = inv.snapshot;
  const overdue = inv.status === 'issued' && inv.due_on < isoToday();
  app.innerHTML = `
    <div class="row">
      <h1>${esc(inv.number)}</h1>${badge(inv.status === 'issued' ? 'unpaid' : inv.status)}${overdue ? ' <span class="flag">Overdue</span>' : ''}
      <span class="spacer"></span>
      <a class="button" href="#/quote/${inv.quote_id}">View quote ${esc(s.quote_reference)}</a>
      ${/^https:\/\/[a-z0-9-]+\.freeagent\.com\//.test(inv.freeagent_url || '') ? `<a class="button" href="${esc(inv.freeagent_url)}" target="_blank" rel="noopener noreferrer">Open in FreeAgent</a>` : ''}
      ${fa.connected && !inv.freeagent_status && inv.status !== 'void' ? '<button id="inv-fa">Send to FreeAgent</button>' : ''}
      <button id="inv-pdf" class="primary">Download PDF</button>
    </div>
    <p class="muted">${esc(INVOICE_KIND_LABELS[inv.kind])} invoice · issued ${esc(formatDate(inv.issued_on))} by ${esc(inv.created_by)}${inv.freeagent_sent_at ? ` · in FreeAgent since ${esc(formatDate(inv.freeagent_sent_at))}` : ''}</p>
    <div class="panel">
      <div class="grid">
        <div><div class="muted">Billed to</div>${esc(s.client_name)}<div class="muted">${esc(s.client_email)}</div></div>
        <div><div class="muted">Event</div>${esc(s.event_type)}<div class="muted">${esc(formatDate(s.event_date))}</div></div>
        <div><div class="muted">Due</div>${esc(formatDate(inv.due_on))}</div>
        <div><div class="muted">${inv.kind === 'deposit' ? 'Deposit due' : inv.kind === 'balance' ? 'Balance due' : 'Amount due'}</div>
          <div style="font: 400 26px/1.2 var(--font-head)">${money(inv.amount_due_pence)}</div>
          ${inv.kind === 'balance' ? `<div class="muted">Total ${money(inv.total_pence)} less ${money(inv.deposit_paid_pence)} deposit paid</div>` : ''}</div>
      </div>
    </div>
    ${inv.status === 'void' ? '<div class="warn">This invoice is void. Its number won’t be reused.</div>' : `
    <div class="panel">
      <h2 style="margin-top:0">Payment</h2>
      ${inv.status === 'paid'
        ? `<p>Paid on <strong>${esc(formatDate(inv.paid_on))}</strong>.</p><button id="inv-unpaid">Mark as unpaid</button>`
        : `<div class="row"><label>Paid on<input id="inv-paid-on" type="date" value="${isoToday()}"></label>
            <button id="inv-paid" class="primary" style="align-self:flex-end">Mark as paid</button></div>`}
      ${inv.freeagent_status ? '<p class="muted">Record the payment in FreeAgent too (usually by matching the bank transaction).</p>' : ''}
      <hr style="border:0;border-top:1px solid var(--border);margin:16px 0">
      <button id="inv-void" class="danger admin-only">Void invoice</button>
      <span class="muted admin-only">Use this if it was issued by mistake.${inv.freeagent_status ? ' Cancel it in FreeAgent as well.' : ''}</span>
    </div>`}`;

  document.getElementById('inv-pdf').addEventListener('click', (e) => downloadInvoice(invoiceId, e.target));
  const setStatus = async (status, paidOn) => {
    try {
      await api(`/api/invoices/${invoiceId}/status`, { method: 'POST', json: { status, paid_on: paidOn } });
      toast(status === 'paid' ? 'Marked as paid' : 'Marked as unpaid');
      route();
    } catch (err) { toast(err.message, true); }
  };
  const paid = document.getElementById('inv-paid');
  if (paid) paid.addEventListener('click', () => setStatus('paid', document.getElementById('inv-paid-on').value));
  const unpaid = document.getElementById('inv-unpaid');
  if (unpaid) unpaid.addEventListener('click', () => setStatus('issued', ''));
  const voidBtn = document.getElementById('inv-void');
  if (voidBtn) voidBtn.addEventListener('click', async () => {
    if (!confirm(`Void ${inv.number}? It stays on record as void and the number isn't reused. This can't be undone.`)) return;
    try { await api(`/api/invoices/${invoiceId}/void`, { method: 'POST' }); toast('Invoice voided'); route(); } catch (err) { toast(err.message, true); }
  });
  const faBtn = document.getElementById('inv-fa');
  if (faBtn) faBtn.addEventListener('click', async () => {
    if (!confirm(`Create ${inv.number} in FreeAgent for your accounts? FreeAgent won't email the client.`)) return;
    faBtn.disabled = true;
    faBtn.textContent = 'Sending…';
    try {
      const res = await api(`/api/invoices/${invoiceId}/freeagent`, { method: 'POST' });
      toast('Created in FreeAgent');
      route();
      if (res.url) window.open(res.url, '_blank', 'noopener');
    } catch (err) { toast(err.message, true); route(); }
  });
}

// ---------- SOP ----------

async function renderSop() {
  const [sop, history] = await Promise.all([api('/api/sop'), api('/api/sop/history')]);
  app.innerHTML = `
    <div class="row"><h1>Quoting SOP</h1><span class="spacer"></span><button id="save" class="primary admin-only">Save SOP</button></div>
    <p class="admin-note">Only admins can change the SOP.</p>
    <p class="muted">Claude follows this when drafting every quote. Prices belong in the <a href="#/prices">Price list</a>.
      Last saved ${esc(formatDate(sop.updated_at))}${sop.updated_by ? ' by ' + esc(sop.updated_by) : ''}.</p>
    <div class="panel"><textarea id="content" class="tall" style="min-height:60vh">${esc(sop.content)}</textarea></div>
    <h2>Previous versions</h2>
    <div class="panel">${history.length ? `<table><tbody>${history.map((h) => `
      <tr><td>${esc(formatDate(h.updated_at))}</td><td>${esc(h.updated_by)}</td>
      <td class="num"><button data-id="${h.id}" class="admin-only">Load into editor</button></td></tr>`).join('')}</tbody></table>`
      : '<p class="muted">No earlier versions yet.</p>'}</div>`;
  const content = document.getElementById('content');
  content.addEventListener('input', () => { unsavedChanges = true; });
  document.getElementById('save').addEventListener('click', async () => {
    await api('/api/sop', { method: 'PUT', json: { content: content.value } });
    unsavedChanges = false;
    toast('SOP saved');
    route();
  });
  app.querySelectorAll('button[data-id]').forEach((b) => b.addEventListener('click', () => {
    const h = history.find((x) => String(x.id) === b.dataset.id);
    content.value = h.content;
    unsavedChanges = true;
    toast('Loaded. Save to make it the current SOP.');
    window.scrollTo(0, 0);
  }));
}

// ---------- price list ----------

async function renderPrices() {
  const prices = await api('/api/prices');
  const row = (p) => `
    <tr data-id="${p.id ?? ''}" ${p.active === 0 ? 'style="opacity:.55"' : ''}>
      <td><input data-k="category" value="${esc(p.category)}" placeholder="e.g. Canapés"></td>
      <td><input data-k="name" value="${esc(p.name)}" placeholder="Item name"></td>
      <td><input data-k="unit" value="${esc(p.unit)}" placeholder="per person" style="width:110px"></td>
      <td class="num"><input data-k="price" type="number" step="0.01" min="0" value="${toPounds(p.price_pence)}" style="width:100px"></td>
      <td><input data-k="notes" value="${esc(p.notes)}" placeholder="Rules, minimums…"></td>
      <td class="num" style="white-space:nowrap"><button data-act="save" class="admin-only">Save</button>
        ${p.id ? (p.active ? '<button data-act="archive" class="danger admin-only">Archive</button>' : '<button data-act="restore" class="admin-only">Restore</button>') : ''}</td>
    </tr>`;
  app.innerHTML = `
    <div class="row"><h1>Price list</h1><span class="spacer"></span><button id="add" class="primary admin-only">Add item</button></div>
    <p class="admin-note">Only admins can change prices.</p>
    <p class="muted">Claude can only quote prices from this list. Anything else is flagged for you to price. Archived items stay on old quotes but aren't offered again.</p>
    <div class="panel"><div class="table-wrap"><table>
      <thead><tr><th>Category</th><th>Item</th><th>Unit</th><th class="num">Price £</th><th>Notes</th><th></th></tr></thead>
      <tbody id="rows">${prices.map(row).join('') || ''}</tbody>
    </table></div></div>`;
  const rows = document.getElementById('rows');
  document.getElementById('add').addEventListener('click', () => {
    rows.insertAdjacentHTML('afterbegin', row({ category: '', name: '', unit: 'each', price_pence: 0, notes: '', active: 1 }));
    rows.querySelector('input[data-k="name"]').focus();
  });
  rows.addEventListener('click', async (e) => {
    const act = e.target.dataset.act;
    const tr = e.target.closest('tr');
    if (!act || !tr) return;
    const get = (k) => tr.querySelector(`[data-k="${k}"]`).value;
    const id = tr.dataset.id;
    const body = { category: get('category'), name: get('name'), unit: get('unit'), price_pence: toPence(get('price')), notes: get('notes'), active: act !== 'archive' };
    try {
      if (act === 'archive') await api(`/api/prices/${id}`, { method: 'DELETE' });
      else if (id) await api(`/api/prices/${id}`, { method: 'PUT', json: body });
      else await api('/api/prices', { method: 'POST', json: body });
      toast(act === 'archive' ? 'Archived' : 'Saved');
      route();
    } catch (err) { toast(err.message, true); }
  });
}

// ---------- settings ----------

async function renderSettings() {
  const [s, fa, numbering] = await Promise.all([api('/api/settings'), api('/api/freeagent/status'), api('/api/invoice-numbering')]);
  const faMessage = new URLSearchParams(location.hash.split('?')[1] || '').get('freeagent');
  app.innerHTML = `
    <h1>Settings</h1>
    <div class="panel">
      <div class="grid">
        <label>Business name<input id="business_name" value="${esc(s.business_name)}"></label>
        <label>VAT % (0 if not VAT registered)<input id="vat_rate_percent" type="number" step="0.1" min="0" value="${esc(s.vat_rate_percent)}"></label>
        <label>Default deposit % (when the SOP doesn't set one)<input id="deposit_percent" type="number" step="1" min="0" value="${esc(s.deposit_percent)}"></label>
        <label>Quote valid for (days)<input id="quote_valid_days" type="number" step="1" min="1" value="${esc(s.quote_valid_days)}"></label>
      </div><br>
      <label>Terms printed on every quote<textarea id="quote_terms" style="min-height:160px">${esc(s.quote_terms)}</textarea></label><br>
      <p class="muted">VAT and deposit changes apply to new quotes; existing quotes keep their own values.</p>
      <h2>On quotes and invoices</h2>
      <div class="grid">
        <label>Contact lines (top right, one per line)<textarea id="contact_lines" style="min-height:96px">${esc(s.contact_lines)}</textarea></label>
        <label>Footer line<input id="footer_tagline" value="${esc(s.footer_tagline)}"></label>
        <label>Email for questions<input id="questions_email" type="email" value="${esc(s.questions_email)}"></label>
      </div>
      <h2>Bank details for invoices</h2>
      <div class="grid">
        <label>Account name<input id="bank_account_name" value="${esc(s.bank_account_name)}" autocomplete="off"></label>
        <label>Sort code<input id="bank_sort_code" value="${esc(s.bank_sort_code)}" placeholder="00-00-00" autocomplete="off"></label>
        <label>Account number<input id="bank_account_number" value="${esc(s.bank_account_number)}" inputmode="numeric" autocomplete="off"></label>
      </div><br>
      <button id="save" class="primary admin-only">Save settings</button>
      <p class="admin-note">Only admins can change settings.</p>
    </div>
    <h2>Invoice numbers</h2>
    <div class="panel">
      <p class="muted">${fa.connected
        ? 'FreeAgent is connected, so each new invoice continues FreeAgent’s sequence and both show the same number.'
        : 'Connect FreeAgent below and new invoices will follow its numbering automatically.'}</p>
      <div class="grid">
        <label>Prefix<input id="num-prefix" value="${esc(numbering.prefix)}" placeholder="INV-"></label>
        <label>Next number<input id="num-next" type="number" min="1" step="1" value="${esc(numbering.next)}"></label>
        <label>Digits<input id="num-width" type="number" min="1" max="9" step="1" value="${esc(numbering.width)}"></label>
      </div>
      <p>Next invoice: <strong id="num-preview">${esc(numbering.next_reference)}</strong></p>
      <div class="row">
        <button id="num-save" class="admin-only">Save numbering</button>
        ${fa.connected ? '<button id="num-match" class="primary admin-only">Match FreeAgent</button>' : ''}
        <span id="num-state" class="muted"></span>
      </div>
    </div>
    <h2>FreeAgent</h2>
    <div class="panel">
      ${faMessage ? `<div class="warn">${faMessage === 'connected' ? 'FreeAgent is connected.' : 'FreeAgent: ' + esc(faMessage)}</div><br>` : ''}
      ${!fa.configured ? `<p class="muted">Not set up yet. The app can't see: <strong>${esc((fa.missing || []).join(', '))}</strong>.
            Add ${fa.missing && fa.missing.length > 1 ? 'them' : 'it'} in Cloudflare under Workers &amp; Pages → beyondhub-quotes → Settings → Variables and Secrets (not the Build settings), as type Secret.</p>`
        : fa.connected ? `<p>Connected by ${esc(fa.connected_by)} on ${esc(formatDate(fa.connected_at))}${fa.company_subdomain ? ` (${esc(fa.company_subdomain)}.freeagent.com)` : ''}.</p>
            <p class="muted">Accepted quotes show a "Send to FreeAgent" button.</p>
            <button id="fa-disconnect" class="danger admin-only">Disconnect</button>`
        : '<p class="muted">Click Connect, sign in to FreeAgent and click Allow. You only need to do this once.</p><a class="button primary admin-only" href="/api/freeagent/connect">Connect FreeAgent</a>'}
    </div>`;
  const numFields = ['num-prefix', 'num-next', 'num-width'].map((n) => document.getElementById(n));
  const preview = () => {
    const [prefix, next, width] = numFields.map((f) => f.value);
    document.getElementById('num-preview').textContent = `${prefix}${String(Math.max(1, Number(next) || 1)).padStart(Math.min(9, Math.max(1, Number(width) || 1)), '0')}`;
  };
  numFields.forEach((f) => f.addEventListener('input', preview));
  document.getElementById('num-save').addEventListener('click', async () => {
    try {
      const res = await api('/api/invoice-numbering', { method: 'PUT', json: { prefix: numFields[0].value, next: Number(numFields[1].value), width: Number(numFields[2].value) } });
      toast(`Next invoice will be ${res.next_reference}`);
    } catch (err) { toast(err.message, true); }
  });
  const match = document.getElementById('num-match');
  if (match) match.addEventListener('click', async () => {
    match.disabled = true;
    document.getElementById('num-state').textContent = 'Checking FreeAgent…';
    try {
      const res = await api('/api/invoice-numbering/match-freeagent', { method: 'POST' });
      numFields[0].value = res.prefix; numFields[1].value = res.next; numFields[2].value = res.width; preview();
      document.getElementById('num-state').textContent = `FreeAgent's latest is ${res.freeagent_latest}, so the next invoice will be ${res.next_reference}.`;
    } catch (err) {
      document.getElementById('num-state').textContent = '';
      toast(err.message, true);
    } finally { match.disabled = false; }
  });
  const disconnect = document.getElementById('fa-disconnect');
  if (disconnect) disconnect.addEventListener('click', async () => {
    if (!confirm('Disconnect FreeAgent? You can reconnect any time.')) return;
    await api('/api/freeagent/disconnect', { method: 'POST' });
    location.hash = '#/settings';
    route();
  });
  document.getElementById('save').addEventListener('click', async () => {
    const v = (id) => document.getElementById(id).value;
    await api('/api/settings', { method: 'PUT', json: {
      business_name: v('business_name'), vat_rate_percent: Number(v('vat_rate_percent')),
      deposit_percent: Number(v('deposit_percent')), quote_valid_days: Number(v('quote_valid_days')), quote_terms: v('quote_terms'),
      contact_lines: v('contact_lines'), footer_tagline: v('footer_tagline'), questions_email: v('questions_email'),
      bank_account_name: v('bank_account_name'), bank_sort_code: v('bank_sort_code'), bank_account_number: v('bank_account_number'),
    } });
    toast('Settings saved');
  });
}
