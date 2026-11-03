# Beyond Scrumptious Quotes

A private web app for drafting quotes from WhatsApp enquiries, following your own quoting SOP.

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
   - Domain: `quotes.beyondscrumptious.com`
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
   - **OAuth redirect URI:** `https://quotes.beyondscrumptious.com/api/freeagent/callback`
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

## Local development

Copy `.dev.vars.example` to `.dev.vars`. `DEV_USER_EMAIL` skips the sign-in check locally; never set it on the deployed Worker. Then run:

```bash
npm run db:migrate:local
```

```bash
npm run dev
```

To test the email handler locally, POST a raw email to `http://localhost:8787/cdn-cgi/handler/email?from=you@beyondscrumptious.com&to=quotes@in.beyondscrumptious.com`.
