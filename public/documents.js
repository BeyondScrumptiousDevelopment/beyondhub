'use strict';

// Quotes and invoices as PDFs on the Beyond Scrumptious template (Invoice template.pdf):
// wordmark and contact lines, a powder-blue band with the title and document details, the
// client and event, the line items, totals, payment details and "Good to know", and a footer.
// Uses helpers from app.js (money maths and dates), which loads first.

const DOC = {
  navy: [25, 37, 63],
  slate: [63, 84, 120],
  tint: [197, 215, 236],
  surface: [216, 232, 244],
  mist: [243, 248, 251],
  left: 17,
  right: 193,
  pageW: 210,
  pageH: 297,
};

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = src;
    el.onload = resolve;
    el.onerror = () => reject(new Error(`couldn't load ${src}`));
    document.head.appendChild(el);
  });
}

async function fetchBase64(src) {
  const res = await fetch(src);
  if (!res.ok) throw new Error(`couldn't load ${src}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

let pdfAssets;
/** The PDF library, fonts and logo are only fetched the first time someone downloads a document. */
function loadPdfAssets() {
  pdfAssets = pdfAssets || (async () => {
    await loadScript('/vendor/jspdf.umd.min.js');
    await loadScript('/vendor/jspdf.plugin.autotable.min.js');
    const [dmSans, dmSansMedium, playfair, cormorant, logo] = await Promise.all([
      fetchBase64('/vendor/fonts/DMSans-Regular.ttf'),
      fetchBase64('/vendor/fonts/DMSans-Medium.ttf'),
      fetchBase64('/vendor/fonts/PlayfairDisplay-Regular.ttf'),
      fetchBase64('/vendor/fonts/CormorantGaramond-LightItalic.ttf'),
      fetchBase64('/brand/wordmark-navy.png'),
    ]);
    return { fonts: { dmSans, dmSansMedium, playfair, cormorant }, logo: `data:image/png;base64,${logo}` };
  })();
  return pdfAssets.catch((err) => { pdfAssets = null; throw err; });
}

function newBrandedDoc(assets) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const fonts = [
    ['DMSans-Regular.ttf', assets.fonts.dmSans, 'DMSans', 'normal'],
    ['DMSans-Medium.ttf', assets.fonts.dmSansMedium, 'DMSans', 'bold'],
    ['PlayfairDisplay-Regular.ttf', assets.fonts.playfair, 'Playfair', 'normal'],
    ['CormorantGaramond-LightItalic.ttf', assets.fonts.cormorant, 'Cormorant', 'italic'],
  ];
  for (const [file, data, name, style] of fonts) {
    doc.addFileToVFS(file, data);
    doc.addFont(file, name, style);
  }
  return doc;
}

// The fonts cover Latin characters; anything else (emoji etc.) is left out rather than printed as junk.
function docText(value) {
  return String(value ?? '').replace(/[^\x09\x0a\x0d\x20-\x7e -ÿ‐-‧‰-›€™−]/g, '');
}

function docMoney(pence) {
  const n = Math.abs(Number(pence || 0)) / 100;
  const s = `£ ${n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return Number(pence) < 0 ? `− ${s}` : s;
}

function docDate(iso) {
  const p = parseIso(iso);
  if (!p) return '';
  return new Date(Date.UTC(p.y, p.m, p.d)).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function safeFileName(s) {
  return String(s || '').replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim();
}

/** Text with letter spacing; jsPDF's own right-alignment ignores the spacing, so measure it here. */
function spaced(doc, text, x, y, { space = 0, align = 'left' } = {}) {
  const t = docText(text);
  doc.setCharSpace(space);
  const width = doc.getTextWidth(t) + space * Math.max(0, t.length - 1);
  const startX = align === 'right' ? x - width : x;
  doc.text(t, startX, y);
  doc.setCharSpace(0);
  return width;
}

function setFont(doc, family, size, color = DOC.navy, style = 'normal') {
  doc.setFont(family, style);
  doc.setFontSize(size);
  doc.setTextColor(...color);
}

function rule(doc, x1, y, x2, color = DOC.tint, width = 0.25) {
  doc.setDrawColor(...color);
  doc.setLineWidth(width);
  doc.line(x1, y, x2, y);
}

function label(doc, text, x, y, align = 'left') {
  setFont(doc, 'DMSans', 6.2, DOC.navy);
  spaced(doc, text.toUpperCase(), x, y, { space: 0.55, align });
}

/**
 * Draws a quote or invoice.
 * d = {
 *   kind: 'QUOTE' | 'INVOICE', title: ['THANK', 'you'], meta: [[label, value]...],
 *   leftTitle, left: [[label, value]...], rightTitle, right: [[label, value]...],
 *   items: [{ name, details, qty, amount }], totals: [[label, amount, note?]...], grand: [label, amount],
 *   payment: { title, rows: [[label, value]...] } | null, notes: { title, text } | null,
 *   goodToKnow: [string...], fileName,
 * }
 */
async function drawBrandedDocument(d, settings) {
  const assets = await loadPdfAssets();
  const doc = newBrandedDoc(assets);
  const { left: L, right: R } = DOC;

  const header = () => {
    const props = doc.getImageProperties(assets.logo);
    const logoW = 75;
    doc.addImage(assets.logo, 'PNG', L, 16, logoW, (logoW * props.height) / props.width, 'wordmark', 'FAST');
    setFont(doc, 'DMSans', 7.6, DOC.slate);
    String(settings.contact_lines || '').split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 5)
      .forEach((line, i) => spaced(doc, line, R, 14 + i * 4, { space: 0.1, align: 'right' }));
    rule(doc, L, 32.8, R);
  };
  const footer = (pageNo, pages) => {
    rule(doc, L, 282, R);
    setFont(doc, 'DMSans', 6.2, DOC.slate);
    spaced(doc, String(settings.footer_tagline || '').toUpperCase(), L, 287, { space: 0.55 });
    spaced(doc, pages > 1 ? `${d.kind}  ${pageNo}/${pages}` : d.kind, R, 287, { space: 0.55, align: 'right' });
  };

  // ---- Header, band and details
  header();
  doc.setFillColor(...DOC.surface);
  doc.rect(0, 33, DOC.pageW, 37.6, 'F');
  label(doc, d.kind, L, 51);
  setFont(doc, 'Playfair', 26, DOC.navy);
  const firstW = spaced(doc, d.title[0], L, 62.5, { space: 0.3 });
  if (d.title[1]) {
    setFont(doc, 'Cormorant', 30, DOC.navy, 'italic');
    doc.text(docText(d.title[1]), L + firstW + 3, 62.5);
  }
  d.meta.forEach(([k, v], i) => {
    const y = 44 + i * 8;
    label(doc, k, 132, y);
    setFont(doc, 'DMSans', 8.8, DOC.navy);
    doc.text(docText(v), 156.5, y);
    rule(doc, 132, y + 4, R);
  });

  // ---- Billed to / For
  const block = (title, rows, x1, x2) => {
    setFont(doc, 'Playfair', 11, DOC.navy);
    spaced(doc, title.toUpperCase(), x1, 79, { space: 0.35 });
    rows.forEach(([k, v], i) => {
      const y = 88 + i * 8.2;
      label(doc, k, x1, y);
      setFont(doc, 'DMSans', 8.8, DOC.navy);
      doc.text(doc.splitTextToSize(docText(v) || '–', x2 - x1 - 33)[0], x1 + 32, y);
      rule(doc, x1, y + 4.3, x2);
    });
  };
  block(d.leftTitle, d.left, L, 101.6);
  block(d.rightTitle, d.right, 108, R);

  // ---- Line items
  const rowsY = 88 + Math.max(d.left.length, d.right.length) * 8.2 + 6;
  window.autoTable(doc, {
    startY: rowsY,
    margin: { left: L, right: DOC.pageW - R, top: 40, bottom: 22 },
    head: [['ITEM', 'DETAILS', 'QTY', 'AMOUNT']],
    body: d.items.map((i) => [docText(i.name), docText(i.details), docText(i.qty), docMoney(i.amount)]),
    theme: 'plain',
    styles: { font: 'DMSans', fontSize: 8.4, textColor: DOC.slate, cellPadding: { top: 3.2, bottom: 3.2, left: 2, right: 2 }, valign: 'top' },
    headStyles: { font: 'DMSans', fontSize: 6.2, textColor: DOC.navy, cellPadding: { top: 1, bottom: 3, left: 2, right: 2 } },
    columnStyles: {
      0: { cellWidth: 45, font: 'Playfair', fontSize: 10, textColor: DOC.navy },
      1: { cellWidth: 'auto' },
      2: { cellWidth: 18, halign: 'right', textColor: DOC.navy },
      3: { cellWidth: 26, halign: 'right', textColor: DOC.navy },
    },
    didParseCell: (cell) => {
      if (cell.section === 'head') {
        cell.cell.styles.font = 'DMSans';
        cell.cell.styles.fontSize = 6.2;
        cell.cell.styles.textColor = DOC.navy;
        if (cell.column.index > 1) cell.cell.styles.halign = 'right';
      }
    },
    willDrawCell: (cell) => { if (cell.section === 'head') doc.setCharSpace(0.55); },
    didDrawCell: (cell) => {
      doc.setCharSpace(0);
      if (cell.column.index !== 3) return;
      const y = cell.cell.y + cell.cell.height;
      rule(doc, L, y, R, cell.section === 'head' ? DOC.navy : DOC.tint, cell.section === 'head' ? 0.35 : 0.25);
    },
    didDrawPage: () => { if (doc.getNumberOfPages() > 1 && doc.getCurrentPageInfo().pageNumber > 1) header(); },
  });
  let y = doc.lastAutoTable.finalY + 8;

  // ---- Totals
  const need = d.totals.length * 7 + 16;
  if (y + need > 270) { doc.addPage(); header(); y = 44; }
  const tx = 115.6;
  d.totals.forEach(([k, v, note]) => {
    setFont(doc, 'DMSans', 8.8, DOC.navy);
    const w = doc.getTextWidth(docText(k));
    doc.text(docText(k), tx, y);
    if (note) { setFont(doc, 'DMSans', 8.8, DOC.slate); doc.text(docText(note), tx + w + 2, y); }
    setFont(doc, 'DMSans', 8.8, DOC.navy);
    doc.text(v, R - 2, y, { align: 'right' });
    y += 7.3;
  });
  rule(doc, 113.8, y - 3.6, R, DOC.navy, 0.35);
  y += 3.4;
  setFont(doc, 'Playfair', 13, DOC.navy);
  const roomForLabel = R - 2 - doc.getTextWidth(d.grand[1]) - 4 - tx;
  if (doc.getTextWidth(docText(d.grand[0])) > roomForLabel) doc.setFontSize(10.5);
  doc.text(docText(d.grand[0]), tx, y);
  doc.setFontSize(13);
  doc.text(d.grand[1], R - 2, y, { align: 'right' });
  y += 10;

  // ---- Payment box and Good to know
  const goodLines = d.goodToKnow.map((g) => doc.setFont('DMSans', 'normal').setFontSize(8.2).splitTextToSize(docText(g), R - 113));
  const goodHeight = 10 + goodLines.reduce((h, lines) => h + lines.length * 4.2 + 1.2, 0);
  const box = d.payment || d.notes;
  const boxRows = d.payment ? d.payment.rows.length : 0;
  const notesLines = d.notes ? doc.setFont('DMSans', 'normal').setFontSize(8.4).splitTextToSize(docText(d.notes.text), 101.6 - L - 8) : [];
  const boxHeight = d.payment ? 16 + boxRows * 8.2 : d.notes ? 14 + notesLines.length * 4.4 : 0;
  let by = Math.max(y, 182);
  if (by + Math.max(boxHeight, goodHeight) > 279) { doc.addPage(); header(); by = 44; }

  if (box) {
    doc.setFillColor(...DOC.mist);
    doc.setDrawColor(...DOC.tint);
    doc.setLineWidth(0.25);
    doc.rect(L, by, 101.6 - L, boxHeight, 'FD');
    setFont(doc, 'Playfair', 11, DOC.navy);
    spaced(doc, (d.payment || d.notes).title.toUpperCase(), L + 4.4, by + 7, { space: 0.35 });
    if (d.payment) {
      d.payment.rows.forEach(([k, v], i) => {
        const ry = by + 16 + i * 8.2;
        label(doc, k, L + 4.4, ry);
        setFont(doc, 'DMSans', 8.8, DOC.navy);
        doc.text(docText(v), L + 36.7, ry);
        rule(doc, L + 4.4, ry + 4.3, 97.4);
      });
    } else {
      setFont(doc, 'DMSans', 8.4, DOC.slate);
      notesLines.forEach((line, i) => doc.text(line, L + 4.4, by + 15 + i * 4.4));
    }
  }

  setFont(doc, 'Playfair', 11, DOC.navy);
  spaced(doc, 'GOOD TO KNOW', 108, by + 3, { space: 0.35 });
  let gy = by + 10.5;
  goodLines.forEach((lines) => {
    setFont(doc, 'DMSans', 8.2, DOC.navy);
    doc.circle(110.3, gy - 1.05, 0.45, 'F');
    lines.forEach((line) => { doc.text(line, 113, gy); gy += 4.2; });
    gy += 1.2;
  });

  // ---- Footer on every page
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) { doc.setPage(i); footer(i, pages); }

  doc.setProperties({ title: d.fileName, author: settings.business_name, creator: settings.business_name });
  doc.save(`${safeFileName(d.fileName)}.pdf`);
}

// ---------- Mapping quotes and invoices onto the template ----------

function lineItemsForDoc(lines) {
  return lines.map((i) => {
    const qty = i.unit && !['each', 'booking', 'cake'].includes(i.unit) ? `${i.quantity} ${i.unit}` : String(i.quantity);
    // Item names like "Pancake Station – Classic – 101–150 guests" read best split into name and details.
    const [name, ...rest] = String(i.description).split(' – ');
    return { name, details: rest.join(' · '), qty, amount: Math.round(i.quantity * i.unit_price_pence) };
  });
}

function subtotalRows(s) {
  const lines = s.line_items.reduce((sum, i) => sum + Math.round(i.quantity * i.unit_price_pence), 0);
  const rows = [];
  if (s.discount_pence > 0) {
    rows.push(['Items', docMoney(lines)]);
    rows.push(['Discount', docMoney(-s.discount_pence)]);
  }
  if (s.vat_pence) {
    rows.push(['Subtotal', docMoney(s.subtotal_pence)]);
    rows.push([`VAT (${s.vat_rate_percent}%)`, docMoney(s.vat_pence)]);
  }
  return rows;
}

function eventRows(s) {
  return [
    ['Event', s.event_type],
    ['Date', [docDate(s.event_date), s.event_time].filter(Boolean).join(', ')],
    ['Venue', s.venue],
  ];
}

function clientRows(s) {
  return [
    ['Name', s.client_name],
    s.client_address ? ['Address', s.client_address.replace(/\s*\n\s*/g, ', ')] : ['Phone', s.client_phone],
    ['Email', s.client_email],
  ];
}

async function downloadQuoteDocument(q, settings) {
  const t = computeTotals(q.line_items, q.discount_pence, q.vat_rate_percent, q.deposit_percent, q.deposit_fixed_pence);
  const issued = isoToday();
  const validUntil = addDays(issued, Number(settings.quote_valid_days) || 7);
  const s = { ...q, subtotal_pence: t.subtotal, vat_pence: t.vat };
  const totals = [...subtotalRows(s), ['Total', docMoney(t.total)]];
  let grand = ['Total', docMoney(t.total)];
  if (t.deposit && t.deposit < t.total) {
    totals.push([q.deposit_fixed_pence !== null && q.deposit_fixed_pence !== undefined ? 'Deposit to secure your date' : `Deposit to secure your date (${q.deposit_percent}%)`, docMoney(t.deposit)]);
    grand = ['Balance due', docMoney(t.total - t.deposit)];
  } else if (t.deposit >= t.total) {
    grand = ['Due to confirm your order', docMoney(t.total)];
  }
  if (grand[0] === 'Total') totals.pop();
  const terms = String(settings.quote_terms || '').split(/\n\s*\n/).map((p) => p.replace(/\s+/g, ' ').trim()).filter(Boolean);
  await drawBrandedDocument({
    kind: 'QUOTE',
    title: ['YOUR', 'quote'],
    meta: [['Quote no.', q.reference], ['Date', docDate(issued)], ['Valid until', docDate(validUntil)]],
    leftTitle: 'Prepared for',
    left: clientRows(q),
    rightTitle: 'For',
    right: eventRows(q),
    items: lineItemsForDoc(q.line_items),
    totals,
    grand,
    payment: null,
    notes: q.client_notes ? { title: 'Notes', text: q.client_notes } : null,
    goodToKnow: [
      `This quote is valid until ${docDate(validUntil)}`,
      t.deposit && t.deposit < t.total && q.final_payment_due ? `The balance is due by ${docDate(q.final_payment_due)}` : '',
      ...terms,
      settings.questions_email ? `Questions? ${settings.questions_email}` : '',
    ].filter(Boolean),
    fileName: `${settings.business_name} Quote ${q.reference}${q.client_name ? ' - ' + q.client_name : ''}`,
  }, settings);
}

async function downloadInvoiceDocument(inv, settings) {
  const s = inv.snapshot;
  const totals = [...subtotalRows(s), ['Total', docMoney(inv.total_pence)]];
  let grand;
  let items = lineItemsForDoc(s.line_items);
  if (inv.kind === 'deposit') {
    grand = ['Deposit due', docMoney(inv.amount_due_pence)];
  } else if (inv.kind === 'balance') {
    totals.push(['Deposit paid', docMoney(-inv.deposit_paid_pence), inv.deposit_paid_on ? docDate(inv.deposit_paid_on) : '']);
    grand = ['Balance due', docMoney(inv.amount_due_pence)];
  } else {
    totals.pop();
    grand = ['Amount due', docMoney(inv.amount_due_pence)];
  }
  const daysBefore = s.event_date ? daysBetween(inv.due_on, s.event_date) : null;
  const what = inv.kind === 'deposit' ? 'Deposit' : inv.kind === 'balance' ? 'Balance' : 'Payment';
  const goodToKnow = ['Please use the invoice number as your payment reference'];
  if (inv.kind === 'deposit') {
    goodToKnow.push(`Your deposit secures your date${s.event_date ? ` of ${docDate(s.event_date)}` : ''}`);
  } else if (daysBefore !== null && daysBefore > 0) {
    goodToKnow.push(`${what} due ${daysBefore} day${daysBefore === 1 ? '' : 's'} before your event`);
  } else {
    goodToKnow.push(`${what} due by ${docDate(inv.due_on)}`);
  }
  if (settings.questions_email) goodToKnow.push(`Questions? ${settings.questions_email}`);
  await drawBrandedDocument({
    kind: 'INVOICE',
    title: ['THANK', 'you'],
    meta: [['Invoice no.', inv.number], ['Date', docDate(inv.issued_on)], ['Due', docDate(inv.due_on)]],
    leftTitle: 'Billed to',
    left: clientRows(s),
    rightTitle: 'For',
    right: [['Event', s.event_type], ['Date', docDate(s.event_date)], ['Quote ref.', s.quote_reference]],
    items,
    totals,
    grand,
    payment: {
      title: 'Pay by bank transfer',
      rows: [
        ['Account name', settings.bank_account_name],
        ['Sort code', settings.bank_sort_code],
        ['Account no.', settings.bank_account_number],
        ['Reference', inv.number],
      ],
    },
    notes: null,
    goodToKnow,
    fileName: `${settings.business_name} Invoice ${inv.number}${s.client_name ? ' - ' + s.client_name : ''}`,
  }, settings);
}
