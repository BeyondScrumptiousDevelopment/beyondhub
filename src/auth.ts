import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { MiddlewareHandler } from 'hono';
import type { AppContext, Env } from './env';

const jwksByTeam = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

export function isAllowedEmail(email: string, allowedDomain: string): boolean {
  const at = email.lastIndexOf('@');
  return at > 0 && email.slice(at + 1).toLowerCase() === allowedDomain.toLowerCase();
}

/**
 * Cloudflare Access does the Google sign-in in front of the app. This re-checks its
 * signed token on every request, so the app stays locked even if Access is
 * misconfigured or someone reaches the Worker another way.
 */
async function verifiedEmail(request: Request, env: Env): Promise<string | null> {
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  // Local development only (.dev.vars, which `wrangler deploy` doesn't upload). Every request on the
  // live site comes through Cloudflare Access with a token, so the bypass can never apply there.
  if (env.DEV_USER_EMAIL && !token) return env.DEV_USER_EMAIL;
  if (!token || !env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) return null;

  const issuer = `https://${env.ACCESS_TEAM_DOMAIN}`;
  let jwks = jwksByTeam.get(issuer);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
    jwksByTeam.set(issuer, jwks);
  }
  try {
    // Cloudflare Access signs with RS256; refusing other algorithms rules out algorithm-swap tricks.
    const { payload } = await jwtVerify(token, jwks, { issuer, audience: env.ACCESS_AUD, algorithms: ['RS256'] });
    return typeof payload.email === 'string' ? payload.email : null;
  } catch {
    return null;
  }
}

export const requireStaff: MiddlewareHandler<AppContext> = async (c, next) => {
  const email = await verifiedEmail(c.req.raw, c.env);
  if (!email || !isAllowedEmail(email, c.env.ALLOWED_DOMAIN)) {
    return c.text(`Access is limited to @${c.env.ALLOWED_DOMAIN} accounts.`, 403);
  }
  c.set('userEmail', email.toLowerCase());
  await next();
};
