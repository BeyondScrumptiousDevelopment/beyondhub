import type { MiddlewareHandler } from 'hono';
import type { AppContext, Env } from './env';

/**
 * An error whose message is written for staff and safe to show them. Anything else that
 * goes wrong is logged and shown as a generic message, so internal details never reach the page.
 */
export class UserError extends Error {
  constructor(message: string, readonly status: 400 | 403 | 404 | 409 | 413 | 429 | 502 = 400) {
    super(message);
  }
}

export function publicMessage(err: unknown): string {
  return err instanceof UserError ? err.message : 'Something went wrong. Try again, and if it keeps happening, check the logs.';
}

// Scripts and styles only from this site (plus Google Fonts). Inline style attributes are used
// throughout the page, so styles allow 'unsafe-inline'; scripts do not.
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

export const securityHeaders: MiddlewareHandler<AppContext> = async (c, next) => {
  await next();
  // Responses from the asset store have read-only headers, so copy them into a new response.
  const res = new Response(c.res.body, c.res);
  res.headers.set('Content-Security-Policy', CONTENT_SECURITY_POLICY);
  res.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.headers.set('X-Content-Type-Options', 'nosniff');
  res.headers.set('X-Frame-Options', 'DENY');
  res.headers.set('Referrer-Policy', 'same-origin');
  res.headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  // The public logo is shown on the Cloudflare login page, which is on another address.
  const isPublicLogo = new URL(c.req.url).pathname.startsWith('/brand/');
  res.headers.set('Cross-Origin-Resource-Policy', isPublicLogo ? 'cross-origin' : 'same-origin');
  res.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  // Client details must not be kept in shared or browser caches.
  if (new URL(c.req.url).pathname.startsWith('/api/')) res.headers.set('Cache-Control', 'no-store');
  c.res = res;
};

/** Per-person limits, using Cloudflare's rate limiting. Counts are approximate and per location. */
export function rateLimit(binding: 'API_LIMITER' | 'DRAFT_LIMITER', message: string): MiddlewareHandler<AppContext> {
  return async (c, next) => {
    const limiter = c.env[binding];
    if (limiter) {
      const { success } = await limiter.limit({ key: c.get('userEmail') || 'anonymous' });
      if (!success) throw new UserError(message, 429);
    }
    await next();
  };
}

/** A hard daily cap on Claude drafts across everyone, so a mistake or a stolen login can't run up a big bill. */
export async function checkDailyDraftCap(env: Env): Promise<void> {
  const cap = Number(env.MAX_DRAFTS_PER_DAY) || 200;
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM enquiries WHERE received_at >= datetime('now', '-1 day')")
    .first<{ n: number }>();
  if ((row?.n ?? 0) >= cap) {
    throw new UserError(`The daily limit of ${cap} drafts has been reached. Try again tomorrow, or raise MAX_DRAFTS_PER_DAY.`, 429);
  }
}

export function isAdmin(env: Env, email: string): boolean {
  const admins = (env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  // With no admins listed, every staff member can change everything (the original behaviour).
  return admins.length === 0 || admins.includes(email.toLowerCase());
}

/** For changes to the SOP, prices, settings and FreeAgent connection, and for deleting things. */
export const requireAdmin: MiddlewareHandler<AppContext> = async (c, next) => {
  if (!isAdmin(c.env, c.get('userEmail'))) {
    throw new UserError('Only an admin can do that. Ask the owner to make this change.', 403);
  }
  await next();
};

/** Parses a numeric route id, rejecting anything else before it reaches the database. */
export function parseId(value: string): number {
  if (!/^\d{1,10}$/.test(value)) throw new UserError('Not found', 404);
  return Number(value);
}
