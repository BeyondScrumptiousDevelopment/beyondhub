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
  /** Local development only (.dev.vars): skips the sign-in check. Never set this on the deployed Worker. */
  DEV_USER_EMAIL?: string;
}

export type AppContext = { Bindings: Env; Variables: { userEmail: string } };
