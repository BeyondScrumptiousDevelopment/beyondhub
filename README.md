# Beyond Scrumptious Hub

A private web app at `hub.beyondscrumptious.com` for quotes, invoices, booking agreements and event prep, built around your own quoting SOP. (It used to be at `quotes.beyondscrumptious.com`, which now redirects here.)

- **Email in a WhatsApp chat export** (or paste it into the app). Claude reads the conversation and drafts a quote.
- **Your SOP and price list live in the app**, and anyone on the team can edit them. Claude only uses prices from the price list. Anything else is highlighted for a person to price.
- **Edit every quote** before it goes out: lines, quantities, prices, discount, VAT, deposit and notes. Then print it or save it as a PDF, and copy a ready-made WhatsApp reply.
- **Only people with a `@beyondscrumptious.com` email** can open the app or email enquiries into it.

It runs on Cloudflare: a Worker, a D1 database, Email Routing and Cloudflare Access. Everything stays on Cloudflare's free tiers. The only running cost is the Claude API.

## How it works

```
WhatsApp Business app ──Export chat──▶ email to quotes@in.beyondscrumptious.com
                                              │  Cloudflare Email Routing
                                              ▼
Staff browser ──Cloudflare Access sign-in──▶ Worker (src/index.ts) ──▶ D1 database
                                              │
                                              └──▶ Claude API drafts the quote
```

| File | What it does |
|---|---|
| `src/index.ts` | The API routes and the email handler |
| `src/auth.ts` | Checks the Cloudflare Access sign-in and the email domain on every request |
| `src/claude.ts` | The drafting prompt and the quote format Claude must return |
| `src/pricing.ts` | Totals, and replacing prices with the price list's prices |
| `src/email.ts` | Reads inbound emails and WhatsApp exports (`.txt`, or `.zip` from an iPhone) |
| `public/` | The web app |
| `migrations/` | Database schema |

## One-time setup

You need a Cloudflare account with `beyondscrumptious.com` added as a site, so its DNS is managed by Cloudflare. When you add the domain, Cloudflare copies your existing DNS records, including Google Workspace's MX records, so your email keeps working. Check the MX records before you switch nameservers.

### 1. Claude API key

Create a key at [console.anthropic.com](https://console.anthropic.com). Add a few pounds of credit and set a monthly spend limit under Billing.

### 2. Database and deploy

```bash
npm install
```

```bash
npx wrangler login
```

```bash
npx wrangler d1 create beyondhub-quotes
```

Paste the `database_id` it prints into `wrangler.jsonc`, then run:

```bash
npm run db:migrate
```

```bash
npx wrangler secret put ANTHROPIC_API_KEY
```

### 3. Lock it to your domain (Cloudflare Access)

In the Cloudflare dashboard, go to **Zero Trust**. The free plan covers up to 50 users.

1. **Settings → Authentication → Login methods:** "One-time PIN" works with no extra setup (you get a code by email). To sign in with Google instead, add Google Workspace.
2. **Access → Applications → Add an application → Self-hosted.**
   - Domain: `hub.beyondscrumptious.com`
   - Policy: **Allow**, with the rule **Emails ending in** `@beyondscrumptious.com`
3. Open the application and copy its **Application Audience (AUD) Tag**. Your team domain is shown under **Settings → Custom pages** (it looks like `yourteam.cloudflareaccess.com`).
4. Put both into `ACCESS_AUD` and `ACCESS_TEAM_DOMAIN` in `wrangler.jsonc`, then deploy:

```bash
npm run deploy
```

The app also checks the Access sign-in token itself, so it refuses requests that didn't come through Access. The `*.workers.dev` address is switched off.

### 4. The quotes email address (Cloudflare Email Routing)

Your main domain's email stays with Google. The app uses a subdomain so the two don't clash.

1. In the dashboard, open the domain → **Email → Email Routing**. Enable it for the subdomain `in.beyondscrumptious.com` (**Settings → Subdomains**). Cloudflare adds the DNS records for the subdomain only.
2. **Routing rules → Custom address:** `quotes@in.beyondscrumptious.com` → action **Send to a Worker** → `beyondhub-quotes`.

The app only accepts email sent directly from a `@beyondscrumptious.com` mailbox. Email from anyone else is bounced. Send from your own Workspace account, not through a forwarding alias or group, because forwarding changes the sender.

### 5. FreeAgent (optional)

This adds a **Send to FreeAgent** button to accepted quotes. It creates the quote in FreeAgent as an approved estimate, with the client's contact, every line and the event details. Nothing is emailed to the client.

1. Go to [dev.freeagent.com](https://dev.freeagent.com), sign in with your FreeAgent login and create an app:
   - **Name:** `Beyond Scrumptious Quotes`
   - **OAuth redirect URI:** `https://hub.beyondscrumptious.com/api/freeagent/callback`
2. Copy the app's **OAuth identifier** and **OAuth secret**, and store them:

```bash
npx wrangler secret put FREEAGENT_CLIENT_ID
```

```bash
npx wrangler secret put FREEAGENT_CLIENT_SECRET
```

3. In the app, go to **Settings → Connect FreeAgent**, sign in and click **Allow**. You only do this once.

The app can do whatever the FreeAgent user who clicked Allow can do, but it only ever reads contacts and creates contacts and estimates. To cut access off, click **Disconnect** in Settings, or revoke the app in FreeAgent.

### Deploying updates without a terminal

Connect the Worker to GitHub once, in **Workers & Pages → beyondhub-quotes → Settings → Build → Connect**:

- **Branch:** the branch you deploy from
- **Build command:** leave empty
- **Deploy command:** `npx wrangler d1 migrations apply beyondhub-quotes --remote && npx wrangler deploy`

After that, every push to that branch applies any new database migrations and deploys. Secrets can be added in the dashboard under **Settings → Variables and Secrets** (type **Secret**).

## Using it

1. The SOP, price list and settings come pre-loaded from the Cake and Dessert Stations SOPs (`migrations/0002_beyond_scrumptious_sop.sql`). Check **Settings** (VAT, deposit) and make any changes in the app from then on.
2. In the WhatsApp Business app, open the chat → tap the contact's name (iPhone) or **⋮ → More** (Android) → **Export chat** → **Without media** → **Mail**, and send it to `quotes@in.beyondscrumptious.com`. Save that address as a contact so it's one tap.
3. Within about a minute, the draft appears under **Inbox** and **Quotes**. Lines highlighted in yellow need a person to check them.
4. Edit, **Save**, then **Print / PDF** or **Copy** the WhatsApp reply.

You can also paste a chat or upload an export under **New enquiry**.

## Costs

- Cloudflare Workers, D1, Email Routing and Access (up to 50 users): free tier.
- Claude API: pay per use. Each draft sends your SOP, price list and the chat. Expect roughly 3–4p per quote with the default model (`CLAUDE_MODEL` in `wrangler.jsonc`, currently Claude Sonnet 5.5). Switching to `claude-opus-5-5` is more careful but costs about twice as much. Very long chats cost more. The app keeps the most recent ~200,000 characters.

## Privacy

Chats contain clients' personal data. They're stored in your D1 database and sent to the Claude API to draft the quote. Mention this in your privacy notice. Delete old enquiries from the Inbox when you no longer need them.

## Quotes and invoices on the brand template

Quotes and invoices download as PDFs on the Beyond Scrumptious template: wordmark and contact lines, the powder-blue band, Billed to / For, items, totals, bank transfer details and Good to know. They use DM Sans, Playfair Display and Cormorant Garamond, built into the PDF from `public/vendor/fonts/` (Latin-only copies of the Google Fonts files, under the SIL Open Font Licence).

- **Issuing invoices:** open an accepted quote and use **Invoices**. Issue a **deposit** invoice (due on receipt) and later a **balance** invoice (due by the final payment date, with the paid deposit taken off), or a single **full** invoice.
- **Invoice numbers match FreeAgent:** while FreeAgent is connected, each new invoice continues FreeAgent's own sequence. The app reads FreeAgent's latest invoice number, keeping its prefix and digits, so INV-0045 is followed by INV-0046, and the same number is used when the invoice is sent to FreeAgent. **Settings → Invoice numbers** shows the next number, lets an admin set the prefix, starting number and digits, and has a **Match FreeAgent** button. A number already used in the app is never given out again.
- **Invoices are frozen:** each one copies the quote as it was when issued, so editing the quote later never changes it. Invoices can be voided by an admin but never deleted, so numbers aren't reused, and a quote with invoices can't be deleted.
- **Deposit + balance on one invoice:** the default when a quote has a deposit. One invoice for the total shows a payment schedule: the deposit (due on the date you enter when issuing it, between the invoice date and the final date) and the balance (due on the quote's final payment date). It goes to FreeAgent due on the final date, with the schedule in its notes.
- **Part payments:** **Record payment** on the invoice's page (amount and date; it suggests the deposit first, then the rest). Statuses go Unpaid → Part paid → Paid; payments can be removed if entered by mistake. The PDF shows "Paid so far" and the balance outstanding. Unpaid and overdue invoices (by the next date due) show on the home page and under **Invoices**. In FreeAgent, part payments are matched from the bank feed as usual.
- **FreeAgent:** **Send to FreeAgent** on an invoice creates it there with the same number and marks it as sent, for the accounts. FreeAgent doesn't email the client; the client gets the PDF from the app. Record payments in FreeAgent as usual.
- **Settings:** bank details, the contact lines, the footer line and the questions email that appear on the documents.

## Booking agreements

The agreement is the owner's **Booking Agreement V1** (Live Mini Pancake Station), word for word, with its blanks filled in automatically:

- **From the quote:** customer details, event, package, extras, total and the payment schedule (the quote's real deposit and balance date).
- **From the event prep sheet:** the on-the-day contact, venue address, serving times, arrival time, toppings and sauces, power and parking, and allergies.
- **From the deposit invoice:** the payment reference.

Anything unknown shows as "To be confirmed", so fill in the prep sheet (**Fill from chat**) before creating the agreement; the app reminds you. The wording can be edited under **Settings → Booking agreement**: `## 1. Heading` starts a section, `| Label | value` is a field, `- ` is a bullet and `{{payment_table}}` is the payment schedule.

- **How it's used now (online signing off):** **Generate booking agreement** creates it and downloads the PDF straight away, with signature lines like the paper form. When the owner (an admin) generates it, the "For Beyond Scrumptious" section is already signed: Naavyen Patel's signature in a handwriting font (Allura, OFL), the date, and a "Signed electronically" note, saved with the agreement so it can't change. Agreements generated by anyone else leave those lines blank. Send it however you like, keep the signed copy in Google Drive, then use **Mark as signed** (name and date) so the Hub knows it's done. Online signing is switched off with `"ONLINE_SIGNING": "false"` in `wrangler.jsonc`; set it to `"true"` to use the online flow below.
- **Signing online (when switched on):** clients sign at **`sign.beyondscrumptious.com/<private link>`**. This address sits outside the staff login and serves only signing pages, the T&Cs and the logo; I tested that the Hub's pages and data aren't reachable from it. The client reads the agreement, opens the **Terms & Conditions (PDF)**, types their name and ticks to agree. The app records the name, UK date and time, connection, device and a fingerprint of exactly what was signed. No paid signing service is used.
- **Links:** for security, the link is only shown when it's created; **Create a new link** replaces it. Links expire after 60 days.
- **PDF:** the agreement downloads from the Hub, signed or not, laid out like the branded Terms & Conditions, with the electronic signature record in place of the signature lines.
- **Terms & Conditions:** the branded PDF (August 2026) is at `sign.beyondscrumptious.com/terms` for clients, and linked from Settings for staff.

## Manual quotes and invoices

- **Write a quote manually** (home page and Quotes page) opens a blank quote to fill in yourself.
- **New manual invoice** (Invoices page) is for one-off jobs without a quote: enter the client and lines (typed, or from the price list), and it issues a branded invoice with the next FreeAgent-matching number. Behind the scenes it's kept as an accepted quote marked "Manual invoice", so it works like every other invoice.

## Event prep sheets

**Event prep sheet** on a quote opens an internal sheet for the day:

- **Quantities** worked out from the quote with the SOP's planning figures (pancakes: 4 per guest, about 110 per 900ml batter bottle, about 50 per batch, 2 staff or 3 from 251 guests, 2 or 2.5 hours of service; croffles: count, venue needs, setup time; cakes: the items).
- **Fill from chat:** Claude reads the original WhatsApp chat and the quote and fills in arrival and service times, the contact on the day, the address, access, power, allergies, selections and design notes. It only fills empty fields, never what staff typed, and it only uses what the chat actually says.
- **Checklist:** a starting checklist for the product, which you can tick, edit and add to.
- **PDF:** a printable sheet with allergies highlighted at the top, marked "Internal · not for clients".

## Security

- **Sign-in:** Cloudflare Access only lets `@beyondscrumptious.com` emails in, and the app re-checks Access's signed token (RS256) on every request. `DEV_USER_EMAIL` is for local testing only, and it's ignored whenever a request arrives through Access.
- **Admins:** `ADMIN_EMAILS` in `wrangler.jsonc` lists who can change the SOP, prices, settings and FreeAgent connection, and who can delete. The server enforces this; other staff can still draft, edit and send quotes.
- **Limits:** 300 requests and 10 drafts per person per minute (Cloudflare rate limiting), at most `MAX_DRAFTS_PER_DAY` Claude drafts a day across everyone, uploads up to 20 MB, other requests up to 1 MB, and zips capped at 10 MB unpacked. Inbound email is limited to 30 per sender per hour.
- **Secrets:** `ANTHROPIC_API_KEY`, `FREEAGENT_CLIENT_ID` and `FREEAGENT_CLIENT_SECRET` live only in Cloudflare's secret store and never reach the browser. FreeAgent tokens are stored encrypted (AES-GCM, key derived from the client secret). Claude and FreeAgent requests only go to their official addresses.
- **Browser protection:** strict security headers on every response (Content-Security-Policy, HSTS, no framing, no sniffing), `Cache-Control: no-store` on API responses, no CORS, and a custom header required on every change.
- **Errors:** staff see clear messages for problems they can fix. Anything unexpected is logged in Cloudflare and shown as a generic message.
- **Dependencies:** exact versions are pinned in `package.json`. Run `npm audit` before updating, and prefer releases that are at least a couple of weeks old. After updating jsPDF, run `npm run vendor`.

## Local development

Copy `.dev.vars.example` to `.dev.vars`. `DEV_USER_EMAIL` skips the sign-in check locally; never set it on the deployed Worker. Then run:

```bash
npm run db:migrate:local
```

```bash
npm run dev
```

To test the email handler locally, POST a raw email to `http://localhost:8787/cdn-cgi/handler/email?from=you@beyondscrumptious.com&to=quotes@in.beyondscrumptious.com`.
