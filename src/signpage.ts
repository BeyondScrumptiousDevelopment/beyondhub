import type { AgreementBlock, AgreementContent, AgreementRow } from './agreements';
import { longDate } from './agreements';

// The client-facing signing page. It is rendered on the server as a single self-contained page
// (no app scripts or data), and only ever shows the one agreement its private link belongs to.

const esc = (v: unknown) =>
  String(v ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);

const pounds = (pence: number) =>
  `£${(pence / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const STYLE = `
:root { --navy:#19253f; --slate:#3f5478; --powder:#9bb3d3; --tint:#c5d7ec; --surface:#d8e8f4; --mist:#f3f8fb; }
* { box-sizing: border-box; }
body { margin:0; background:var(--mist); color:var(--navy); font:15px/1.6 "DM Sans", system-ui, sans-serif; }
.wrap { max-width:760px; margin:0 auto; padding:24px 16px 64px; }
header { display:flex; justify-content:space-between; align-items:center; gap:12px; padding-bottom:14px; border-bottom:1px solid var(--tint); }
header img { height:34px; width:auto; }
header span { font-size:12px; letter-spacing:.12em; text-transform:uppercase; color:var(--slate); }
.band { background:var(--surface); border-radius:14px; padding:22px; margin:20px 0; }
.band .kind { font-size:11px; letter-spacing:.22em; text-transform:uppercase; }
h1 { font:400 32px/1.15 "Playfair Display", Georgia, serif; margin:4px 0 0; letter-spacing:.02em; }
h1 em { font-family:"Cormorant Garamond", Georgia, serif; font-weight:300; font-size:1.15em; }
h2 { font:400 18px/1.3 "Playfair Display", Georgia, serif; letter-spacing:.04em; text-transform:uppercase; margin:28px 0 8px; }
.card { background:#fff; border:1px solid var(--tint); border-radius:12px; padding:18px; margin:14px 0; }
dl { display:grid; grid-template-columns:max-content 1fr; gap:6px 18px; margin:0; }
dt { font-size:11px; letter-spacing:.14em; text-transform:uppercase; color:var(--slate); padding-top:3px; }
dd { margin:0; }
table { width:100%; border-collapse:collapse; }
td { padding:8px 0; border-bottom:1px solid var(--tint); vertical-align:top; }
td.num { text-align:right; white-space:nowrap; padding-left:12px; }
.total td { border-bottom:0; font-weight:600; }
p { margin:0 0 10px; }
label { display:block; font-size:13px; color:var(--slate); margin:12px 0 4px; }
input[type=text] { width:100%; font:inherit; padding:10px 12px; border:1px solid var(--tint); border-radius:8px; color:var(--navy); background:var(--mist); }
.check { display:flex; gap:10px; align-items:flex-start; margin-top:14px; color:var(--navy); font-size:15px; }
.check input { margin-top:5px; width:18px; height:18px; }
button { margin-top:16px; font:inherit; font-weight:600; padding:12px 20px; border:0; border-radius:8px; background:var(--navy); color:var(--mist); cursor:pointer; width:100%; }
.note { font-size:13px; color:var(--slate); }
.signed { border-left:4px solid #1a7f37; }
section { border-bottom:1px solid var(--tint); padding-bottom:6px; }
h2 .num { font-family:"Cormorant Garamond", Georgia, serif; font-style:italic; font-weight:300; font-size:1.25em; margin-right:12px; text-transform:none; }
dl.fields { display:grid; grid-template-columns:minmax(120px, 40%) 1fr; gap:0; margin:6px 0 12px; }
dl.fields dt, dl.fields dd { padding:8px 0; border-bottom:1px solid var(--tint); }
dl.fields dt { padding-right:12px; }
dd.tbc { color:var(--slate); font-style:italic; }
ul { margin:4px 0 12px; padding-left:20px; } li { margin:3px 0; }
table.pay { margin:8px 0 14px; background:#fff; border:1px solid var(--tint); border-radius:10px; }
table.pay th { text-align:left; font-size:11px; letter-spacing:.14em; text-transform:uppercase; font-weight:400; padding:10px 10px 8px; border-bottom:1px solid var(--navy); }
table.pay td { padding:9px 10px; }
a { color:var(--navy); }
.terms { display:block; margin:6px 0 2px; font-weight:600; color:var(--navy); }
.error { background:#fff4d6; border:1px solid #e6c25c; border-radius:8px; padding:10px 12px; margin-bottom:10px; }
footer { margin-top:32px; padding-top:12px; border-top:1px solid var(--tint); font-size:11px; letter-spacing:.14em; text-transform:uppercase; color:var(--slate); }
`;

function page(title: string, body: string): string {
  return `<!doctype html><html lang="en-GB"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow">
<title>${esc(title)}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@1,300&family=DM+Sans:wght@400;600&family=Playfair+Display&display=swap">
<style>${STYLE}</style></head><body><div class="wrap">
<header><img src="/brand/wordmark-navy.png" alt="Beyond Scrumptious"><span>Booking agreement</span></header>
${body}
<footer>Beyond Scrumptious</footer></div></body></html>`;
}

/** "12 November 2026 at 14:05" in UK time, from a database timestamp (which is UTC). */
export function ukDateTime(utc: string): string {
  const d = new Date(`${utc.replace(' ', 'T')}Z`);
  if (Number.isNaN(d.getTime())) return utc;
  const date = d.toLocaleDateString('en-GB', { timeZone: 'Europe/London', day: 'numeric', month: 'long', year: 'numeric' });
  const time = d.toLocaleTimeString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit' });
  return `${date} at ${time}`;
}

export function messagePage(title: string, message: string): string {
  return page(title, `<div class="band"><div class="kind">Booking agreement</div><h1>${esc(title)}</h1></div>
    <div class="card"><p>${esc(message)}</p></div>`);
}

/** Content made before blocks existed had plain paragraphs. */
function blocksOf(section: AgreementContent['sections'][number]): AgreementBlock[] {
  const legacy = (section as unknown as { paragraphs?: string[] }).paragraphs;
  return section.blocks ?? (legacy ?? []).map((text) => ({ type: 'p' as const, text }));
}

function renderBlock(b: AgreementBlock): string {
  switch (b.type) {
    case 'p': return `<p>${esc(b.text)}</p>`;
    case 'list': return `<ul>${b.items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`;
    case 'fields': return `<dl class="fields">${b.rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd${v === 'To be confirmed' ? ' class="tbc"' : ''}>${esc(v)}</dd>`).join('')}</dl>`;
    case 'payments': return `<table class="pay"><thead><tr><th>Payment</th><th>Amount</th><th>Due date</th></tr></thead><tbody>
      ${b.rows.map(([k, amount, due]) => `<tr><td>${esc(k)}</td><td>${esc(amount)}</td><td>${esc(due)}</td></tr>`).join('')}
      <tr class="total"><td>Total</td><td>${esc(b.total)}</td><td></td></tr></tbody></table>`;
  }
}

function agreementBody(c: AgreementContent): string {
  return `
    <div class="band"><div class="kind">${esc(c.service_name || 'Booking')} · ${esc(c.number)}</div><h1>BOOKING <em>Agreement</em></h1></div>
    ${c.sections.map((s) => `<section>
      ${s.heading ? `<h2>${s.number ? `<span class="num">${esc(s.number)}</span>` : ''}${esc(s.heading)}</h2>` : ''}
      ${blocksOf(s).map(renderBlock).join('')}</section>`).join('')}`;
}

export function signPage(row: AgreementRow, c: AgreementContent, token: string, error = ''): string {
  return page(`Booking agreement ${c.number}`, `${agreementBody(c)}
    <h2>Sign</h2>
    <form class="card" method="post" action="/${esc(token)}">
      ${error ? `<div class="error">${esc(error)}</div>` : ''}
      <label for="name">Your full name</label>
      <input id="name" name="full_name" type="text" required minlength="2" maxlength="100" autocomplete="name" value="${esc(c.client_name)}">
      <a class="terms" href="/terms" target="_blank" rel="noopener">Read our Terms &amp; Conditions (PDF) ↗</a>
      <label class="check"><input type="checkbox" name="agree" value="yes" required>
        <span>I have read this Booking Agreement and the Beyond Scrumptious Terms &amp; Conditions (August 2026), and I agree to them on behalf of the customer named above.</span></label>
      <button type="submit">Sign agreement</button>
      <p class="note" style="margin-top:12px">Typing your name and pressing Sign is your electronic signature. We record your name, the date and time, and your connection details with the agreement. This link expires on ${esc(longDate(row.expires_at.slice(0, 10)))}.</p>
    </form>`);
}

export function signedPage(row: AgreementRow, c: AgreementContent): string {
  return page(`Booking agreement ${c.number} signed`, `${agreementBody(c)}
    <div class="card signed"><h2 style="margin-top:0">Signed</h2>
      <p>Signed electronically by <strong>${esc(row.signed_name)}</strong> on ${esc(ukDateTime(row.signed_at))}.</p>
      <p class="note">Thank you. We'll send you a copy of the signed agreement. <a href="/terms" target="_blank" rel="noopener">Terms &amp; Conditions (PDF)</a></p></div>`);
}
