export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  ANTHROPIC_API_KEY: string;
  ALLOWED_DOMAIN: string;
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_AUD: string;
  CLAUDE_MODEL: string;
  /** Local development only (.dev.vars): skips the sign-in check. Never set this on the deployed Worker. */
  DEV_USER_EMAIL?: string;
}

export type AppContext = { Bindings: Env; Variables: { userEmail: string } };
