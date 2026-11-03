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

// ---------- router ----------

const routes = {
  quotes: renderQuotes,
  new: renderNewEnquiry,
  inbox: renderInbox,
  quote: renderQuote,
  enquiry: renderEnquiry,
  sop: renderSop,
  prices: renderPrices,
  settings: renderSettings,
};

let unsavedChanges = false;
let currentHash = location.hash;

async function route() {
  currentHash = location.hash;
  const [, name = 'quotes', id] = location.hash.split('?')[0].split('/');
  document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.route === name));
  unsavedChanges = false;
  app.innerHTML = '<p class="muted">Loading…</p>';
  try {
    await (routes[name] || renderQuotes)(id);
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

api('/api/me').then((me) => { document.getElementById('me').textContent = me.email; }).catch(() => {});
route();

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
  const load = async () => {
    const q = encodeURIComponent(document.getElementById('search').value);
    const status = encodeURIComponent(document.getElementById('status').value);
    const rows = await api(`/api/quotes?q=${q}&status=${status}`);
    document.getElementById('rows').innerHTML = rows.length
      ? rows.map((r) => `
        <tr class="clickable" data-id="${r.id}">
          <td>${esc(r.reference)}</td><td>${esc(r.client_name) || '<span class="muted">Unknown</span>'}</td>
          <td>${esc(r.event_type)}${r.guests ? ` · ${r.guests} guests` : ''}</td>
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
        <button id="delete" class="danger">Delete enquiry</button>
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
        ${q.freeagent_url ? `<a class="button" href="${esc(q.freeagent_url)}" target="_blank" rel="noopener">Open in FreeAgent</a>` : ''}
        ${fa.connected && !q.freeagent_status ? `<button id="freeagent" ${q.status === 'accepted' ? '' : 'disabled'} title="For accepted quotes">Send to FreeAgent</button>` : ''}
        <button id="print">Print / PDF</button>
        <button id="duplicate">Duplicate</button>
        <button id="delete" class="danger">Delete</button>
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
    <div class="print-only doc" id="doc"></div>`;

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
  document.getElementById('print').addEventListener('click', () => {
    const data = collect();
    if (items.some((i) => i.needs_review) && !confirm('Some lines still need checking. Print anyway?')) return;
    document.getElementById('doc').innerHTML = printableQuote(data, settings);
    window.print();
  });

  renderLines();
}

function printableQuote(q, settings) {
  const t = computeTotals(q.line_items, q.discount_pence, q.vat_rate_percent, q.deposit_percent, q.deposit_fixed_pence);
  const created = new Date();
  const validUntil = new Date(created.getTime() + settings.quote_valid_days * 86400000);
  const meta = [
    ['Client', q.client_name], ['Phone', q.client_phone], ['Email', q.client_email], ['Event', q.event_type],
    ['Date', formatDate(q.event_date)], ['Time', q.event_time], ['Venue', q.venue], ['Guests', q.guests ?? ''],
  ].filter(([, v]) => v !== '' && v !== null);
  return `
    <h1>${esc(settings.business_name)}</h1>
    <div class="row"><strong>Quote ${esc(q.reference)}</strong><span class="spacer"></span>
      <span>Issued ${esc(created.toLocaleDateString('en-GB'))} · valid until ${esc(validUntil.toLocaleDateString('en-GB'))}</span></div>
    <div class="meta">${meta.map(([k, v]) => `<div><strong>${k}:</strong> ${esc(v)}</div>`).join('')}</div>
    <table>
      <thead><tr><th>Item</th><th class="num">Qty</th><th class="num">Unit price</th><th class="num">Total</th></tr></thead>
      <tbody>${q.line_items.map((i) => `<tr><td>${esc(i.description)}</td><td class="num">${esc(i.quantity)} ${esc(i.unit)}</td>
        <td class="num">${money(i.unit_price_pence)}</td><td class="num">${money(Math.round(i.quantity * i.unit_price_pence))}</td></tr>`).join('')}</tbody>
    </table>
    <div class="totals" style="margin-top:12px;max-width:320px">
      ${t.lines !== t.subtotal ? `<div><span>Discount</span><span>−${money(t.lines - t.subtotal)}</span></div>` : ''}
      <div><span>Subtotal</span><span>${money(t.subtotal)}</span></div>
      ${t.vat ? `<div><span>VAT (${esc(q.vat_rate_percent)}%)</span><span>${money(t.vat)}</span></div>` : ''}
      <div class="grand"><span>Total</span><span>${money(t.total)}</span></div>
      ${t.deposit ? `<div><span>${esc(depositLabel(t, q.deposit_percent, q.deposit_fixed_pence))}</span><span>${money(t.deposit)}</span></div>` : ''}
    </div>
    ${q.client_notes ? `<h2>Notes</h2><p style="white-space:pre-wrap">${esc(q.client_notes)}</p>` : ''}
    ${settings.quote_terms ? `<h2>Terms</h2><p style="white-space:pre-wrap">${esc(settings.quote_terms)}</p>` : ''}`;
}

// ---------- SOP ----------

async function renderSop() {
  const [sop, history] = await Promise.all([api('/api/sop'), api('/api/sop/history')]);
  app.innerHTML = `
    <div class="row"><h1>Quoting SOP</h1><span class="spacer"></span><button id="save" class="primary">Save SOP</button></div>
    <p class="muted">Claude follows this when drafting every quote. Prices belong in the <a href="#/prices">Price list</a>.
      Last saved ${esc(formatDate(sop.updated_at))}${sop.updated_by ? ' by ' + esc(sop.updated_by) : ''}.</p>
    <div class="panel"><textarea id="content" class="tall" style="min-height:60vh">${esc(sop.content)}</textarea></div>
    <h2>Previous versions</h2>
    <div class="panel">${history.length ? `<table><tbody>${history.map((h) => `
      <tr><td>${esc(formatDate(h.updated_at))}</td><td>${esc(h.updated_by)}</td>
      <td class="num"><button data-id="${h.id}">Load into editor</button></td></tr>`).join('')}</tbody></table>`
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
      <td class="num" style="white-space:nowrap"><button data-act="save">Save</button>
        ${p.id ? (p.active ? '<button data-act="archive" class="danger">Archive</button>' : '<button data-act="restore">Restore</button>') : ''}</td>
    </tr>`;
  app.innerHTML = `
    <div class="row"><h1>Price list</h1><span class="spacer"></span><button id="add" class="primary">Add item</button></div>
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
  const [s, fa] = await Promise.all([api('/api/settings'), api('/api/freeagent/status')]);
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
      <button id="save" class="primary">Save settings</button>
    </div>
    <h2>FreeAgent</h2>
    <div class="panel">
      ${faMessage ? `<div class="warn">${faMessage === 'connected' ? 'FreeAgent is connected.' : 'FreeAgent: ' + esc(faMessage)}</div><br>` : ''}
      ${!fa.configured ? '<p class="muted">Not set up yet. Add the FreeAgent app ID and secret (see the README), then come back here to connect.</p>'
        : fa.connected ? `<p>Connected by ${esc(fa.connected_by)} on ${esc(formatDate(fa.connected_at))}${fa.company_subdomain ? ` (${esc(fa.company_subdomain)}.freeagent.com)` : ''}.</p>
            <p class="muted">Accepted quotes show a "Send to FreeAgent" button.</p>
            <button id="fa-disconnect" class="danger">Disconnect</button>`
        : '<p class="muted">Click Connect, sign in to FreeAgent and click Allow. You only need to do this once.</p><a class="button primary" href="/api/freeagent/connect">Connect FreeAgent</a>'}
    </div>`;
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
    } });
    toast('Settings saved');
  });
}
