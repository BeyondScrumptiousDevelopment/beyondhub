export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  ANTHROPIC_API_KEY: string;
  ALLOWED_DOMAIN: string;
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_AUD: string;
  CLAUDE_MODEL: string;
  /** From the app registered at dev.freeagent.com. Optional: the FreeAgent button is hidden without them. */
  FREEAGENT_CLIENT_ID?: string;
  FREEAGENT_CLIENT_SECRET?: string;
  /** Set to https://api.sandbox.freeagent.com/v2 to try things against a FreeAgent sandbox account. */
  FREEAGENT_API_BASE?: string;
  /** Comma-separated emails allowed to change the SOP, prices, settings and FreeAgent, and to delete. */
  ADMIN_EMAILS?: string;
  /** Cap on Claude drafts per 24 hours across everyone (default 200). */
  MAX_DRAFTS_PER_DAY?: string;
  /** Cloudflare rate limiters (see wrangler.jsonc). */
  API_LIMITER?: RateLimit;
  DRAFT_LIMITER?: RateLimit;
  /** Local development only (.dev.vars): skips the sign-in check. Ignored behind Cloudflare Access. */
  DEV_USER_EMAIL?: string;
  /** Local development only, and only alongside DEV_USER_EMAIL: send Claude requests to a test server. */
  ANTHROPIC_BASE_URL?: string;
}

export type AppContext = { Bindings: Env; Variables: { userEmail: string; isAdmin: boolean } };
