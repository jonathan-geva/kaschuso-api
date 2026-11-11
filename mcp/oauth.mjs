import express from 'express';
import cookieParser from 'cookie-parser';
import Provider, { errors, interactionPolicy } from 'oidc-provider';
import { z } from 'zod';

const asyncRoute = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
const uidSchema = z.string().regex(/^[A-Za-z0-9_-]{16,128}$/);
const proofSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const callback = z.string().max(2048).refine(value => {
  try {
    const u = new URL(value);
    const loopback = u.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(u.hostname);
    return (u.protocol === 'https:' || loopback) && !u.username && !u.password && !u.hash;
  } catch { return false; }
});
const registration = z.object({
  client_name: z.string().min(1).max(100).regex(/^[^\p{Cc}\p{Cf}]*$/u).optional(),
  client_uri: callback.optional(),
  redirect_uris: z.array(callback).min(1).max(5),
  application_type: z.enum(['web', 'native']).default('web'),
  response_types: z.array(z.literal('code')).length(1).default(['code']),
  grant_types: z.array(z.enum(['authorization_code', 'refresh_token'])).min(1).max(2).refine(x => x.includes('authorization_code')).default(['authorization_code', 'refresh_token']),
  token_endpoint_auth_method: z.enum(['none', 'client_secret_post', 'client_secret_basic']).default('none'),
  scope: z.literal('grades:read').optional(),
}).strict();

export function boundedLimit(limit, windowMs, key = req => req.ip) {
  const entries = new Map();
  return (req, res, next) => {
    const now = Date.now();
    for (const [id, entry] of entries) if (entry.until <= now) entries.delete(id);
    const id = key(req);
    const entry = entries.get(id) || { count: 0, until: now + windowMs };
    if (entries.size >= 10000 && !entries.has(id)) return res.status(429).json({ error: 'RATE_LIMITED' });
    entries.set(id, entry);
    if (++entry.count > limit) return res.status(429).set('Retry-After', String(Math.ceil((entry.until - now) / 1000))).json({ error: 'RATE_LIMITED' });
    next();
  };
}

export async function createOAuth({ config, store, requireDashboard, onDisconnect = async () => {} }) {
  const policy = interactionPolicy.base();
  policy.get('consent').checks.add(new interactionPolicy.Check('explicit_grade_access', 'Grade access needs explicit consent', ctx => ctx.oidc.result?.consent ? interactionPolicy.Check.NO_NEED_TO_PROMPT : interactionPolicy.Check.REQUEST_PROMPT));
  const provider = new Provider(config.issuer, {
    adapter: store.adapter(), jwks: config.jwks,
    cookies: { keys: [config.cookieKey], names: { session: 'mcp_session', interaction: 'mcp_interaction', resume: 'mcp_resume' }, short: { httpOnly: true, sameSite: 'lax', secure: config.secure, signed: true }, long: { httpOnly: true, sameSite: 'lax', secure: config.secure, signed: true } },
    scopes: ['grades:read'], claims: {}, responseTypes: ['code'],
    pkce: { required: () => true },
    features: {
      devInteractions: { enabled: false }, registration: { enabled: true },
      revocation: { enabled: true }, userinfo: { enabled: false },
      rpInitiatedLogout: { enabled: false }, pushedAuthorizationRequests: { enabled: false },
      resourceIndicators: {
        enabled: true, defaultResource: () => config.resource, useGrantedResource: () => true,
        getResourceServerInfo(ctx, resource) {
          if (resource !== config.resource) throw new errors.InvalidTarget();
          if (['authorization', 'resume'].includes(ctx.oidc.route)) {
            if (ctx.oidc.params.scope !== 'grades:read') throw new errors.InvalidScope('Only grades:read is supported');
            if (ctx.oidc.params.response_mode && ctx.oidc.params.response_mode !== 'query') throw new errors.InvalidRequest('Only query responses are supported');
          }
          return { scope: 'grades:read', audience: config.resource, accessTokenTTL: 600, accessTokenFormat: 'opaque' };
        },
      },
    },
    ttl: { AccessToken: 600, AuthorizationCode: 300, Interaction: 300, Grant: 2592000, Session: 300, RefreshToken: (_ctx, token) => Math.max(1, token.iiat ? token.iiat + 2592000 - Math.floor(Date.now() / 1000) : 2592000) },
    issueRefreshToken: (_ctx, client) => client.grantTypeAllowed('refresh_token'),
    rotateRefreshToken: true, expiresWithSession: () => false,
    interactions: { policy, url: (_ctx, interaction) => `${config.publicUrl}/oauth/connect/${interaction.uid}` },
    loadExistingGrant: ctx => ctx.oidc.result?.consent?.grantId ? provider.Grant.find(ctx.oidc.result.consent.grantId) : undefined,
    findAccount: async (_ctx, accountId) => {
      const found = await store.pool.query('SELECT id FROM mcp_accounts WHERE id=$1', [accountId]);
      return found.rowCount ? { accountId, claims: async () => ({ sub: accountId }) } : undefined;
    },
    clientBasedCORS: (_ctx, origin, client) => client.redirectUris.some(uri => new URL(uri).origin === origin),
    renderError: async ctx => { ctx.status = 400; ctx.type = 'html'; ctx.body = '<!doctype html><html lang="en"><meta charset="utf-8"><title>Connection unavailable</title><p>This connection could not be completed. Start a new connection from ChatGPT.</p></html>'; },
  });
  provider.proxy = true;
  const outcomes = new WeakMap();
  provider.on('authorization.success', (ctx, result) => outcomes.set(ctx, Boolean(result.code)));
  provider.on('authorization.error', ctx => outcomes.set(ctx, false));
  provider.on('error', () => console.error('MCP authorization temporarily unavailable'));
  // This middleware completes before Koa writes the redirect. Failed resumptions
  // revoke the newly created grant; an interrupted database write has a short reaper backstop.
  provider.use(async (ctx, next) => {
    try {
      await next();
      if (ctx.oidc?.route === 'discovery' && ctx.body && typeof ctx.body === 'object') {
        ctx.body.response_modes_supported = ['query'];
        ctx.body.scopes_supported = ['grades:read'];
      }
    }
    finally {
      const grantId = ctx.oidc?.result?.consent?.grantId;
      if (ctx.oidc?.route === 'resume' && grantId) {
        try {
          if (outcomes.get(ctx)) await store.completeAuthorization(grantId);
          else await store.revokeConnection(grantId);
        } catch {
          ctx.remove('Location');
          ctx.status = 503;
          ctx.body = { error: 'temporarily_unavailable' };
        }
      }
    }
  });

  const router = express.Router();
  router.use(cookieParser());
  router.use((req, res, next) => {
    if (req.path.startsWith('/oauth') || req.path.startsWith('/api/mcp') || req.path.startsWith('/.well-known')) {
      res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'" });
      const host = req.headers.host;
      const canonical = new URL(config.publicUrl);
      const forwardedHost = req.headers['x-forwarded-host']?.split(',')[0].trim();
      const forwardedProto = req.headers['x-forwarded-proto']?.split(',')[0].trim();
      if (host !== canonical.host || (forwardedHost && forwardedHost !== canonical.host) || (forwardedProto && `${forwardedProto}:` !== canonical.protocol)) return res.status(400).json({ error: 'INVALID_HOST' });
    }
    next();
  });
  const metadata = { issuer: config.issuer, authorization_endpoint: `${config.issuer}/auth`, token_endpoint: `${config.issuer}/token`, registration_endpoint: `${config.issuer}/reg`, revocation_endpoint: `${config.issuer}/token/revocation`, response_types_supported: ['code'], response_modes_supported: ['query'], grant_types_supported: ['authorization_code', 'refresh_token'], code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'], scopes_supported: ['grades:read'], authorization_response_iss_parameter_supported: true };
  router.get(['/.well-known/oauth-authorization-server', '/.well-known/oauth-authorization-server/oauth'], (_req, res) => res.json(metadata));
  router.get(['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp'], (_req, res) => res.json({ resource: config.resource, authorization_servers: [config.issuer], scopes_supported: ['grades:read'] }));

  const frontend = (req, res, next) => {
    if (req.headers.origin !== config.frontendUrl) return res.status(403).json({ error: 'INVALID_ORIGIN' });
    next();
  };
  router.use('/api/mcp', (req, res, next) => {
    if (req.headers.origin === config.frontendUrl) {
      res.set({ 'Access-Control-Allow-Origin': config.frontendUrl, Vary: 'Origin', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' });
    }
    if (req.method === 'OPTIONS') return req.headers.origin === config.frontendUrl ? res.sendStatus(204) : res.sendStatus(403);
    next();
  });
  const parseJSON = express.json({ limit: '8kb' });
  const consentInput = z.object({ interaction: uidSchema, denied: z.boolean() }).strict();
  router.post('/api/mcp/context', frontend, parseJSON, asyncRoute(async (req, res) => {
    const parsed = z.object({ interaction: uidSchema }).strict().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'INVALID_REQUEST' });
    const interaction = await provider.Interaction.find(parsed.data.interaction);
    if (!interaction) return res.status(410).json({ error: 'CONNECTION_EXPIRED' });
    const client = await provider.Client.find(interaction.params.client_id);
    res.json({ clientName: client.clientName || 'Connected app', callbackOrigin: new URL(interaction.params.redirect_uri).origin, scope: 'grades:read' });
  }));
  router.post('/api/mcp/consent', frontend, boundedLimit(30, 60000), parseJSON, (req, res, next) => {
    const parsed = consentInput.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'INVALID_REQUEST' });
    req.consent = parsed.data;
    if (parsed.data.denied) return next();
    requireDashboard(req, res, next);
  }, asyncRoute(async (req, res) => {
    const { interaction: uid, denied } = req.consent;
    const details = await provider.Interaction.find(uid);
    if (!details) return res.status(410).json({ error: 'CONNECTION_EXPIRED' });
    if (await store.decisionExists(uid)) return res.status(409).json({ error: 'DECISION_ALREADY_SUBMITTED' });
    const proof = await store.saveDecision(uid, denied ? { denied: true } : { denied: false, credentials: { mandator: req.auth.mandator, username: req.auth.username, password: req.auth.password } });
    res.json({ proof });
  }));
  router.get('/api/mcp/connections', requireDashboard, asyncRoute(async (req, res) => {
    const rows = await store.listConnections(req.auth);
    const connections = await Promise.all(rows.map(async row => {
      const client = await provider.Client.find(row.clientId);
      return { id: row.id, name: client?.clientName || 'Connected app', createdAt: row.createdAt, expiresAt: row.expiresAt, reconnect: row.reconnect };
    }));
    res.json({ connections });
  }));
  router.post('/api/mcp/connections/:id/revoke', frontend, parseJSON, requireDashboard, asyncRoute(async (req, res) => {
    if (!uidSchema.safeParse(req.params.id).success) return res.status(400).json({ error: 'INVALID_REQUEST' });
    const revoked = await store.revokeOwned(req.params.id, req.auth);
    if (!revoked) return res.status(404).json({ error: 'NOT_FOUND' });
    if (!(await store.listConnections(req.auth)).length) await onDisconnect(req.auth);
    res.json({ revoked: true });
  }));

  router.get('/oauth/connect/:uid', asyncRoute(async (req, res) => {
    try {
      const interaction = await provider.interactionDetails(req, res);
      if (interaction.uid !== req.params.uid) throw new Error();
      res.redirect(303, `${config.frontendUrl}/connect#request=${encodeURIComponent(interaction.uid)}`);
    } catch { res.status(400).json({ error: 'BROWSER_BINDING_REQUIRED' }); }
  }));
  const proofCookie = uid => ({ httpOnly: true, secure: config.secure, sameSite: 'lax', path: `/oauth/connect/${uid}`, maxAge: 300000 });
  router.post('/oauth/connect/:uid/resume', frontend, express.urlencoded({ extended: false, limit: '2kb' }), asyncRoute(async (req, res) => {
    if (!uidSchema.safeParse(req.params.uid).success || !proofSchema.safeParse(req.body.proof).success) return res.status(400).json({ error: 'INVALID_REQUEST' });
    // The original Lax interaction cookie is deliberately verified after this cross-site POST.
    res.cookie('mcp_completion', req.body.proof, proofCookie(req.params.uid));
    res.redirect(303, `/oauth/connect/${req.params.uid}/complete`);
  }));
  router.get('/oauth/connect/:uid/complete', asyncRoute(async (req, res) => {
    let interaction;
    try {
      interaction = await provider.interactionDetails(req, res);
      if (interaction.uid !== req.params.uid || !proofSchema.safeParse(req.cookies.mcp_completion).success) throw new Error();
    } catch { return res.status(400).json({ error: 'BROWSER_BINDING_REQUIRED' }); }
    const decision = await store.claimDecision(interaction.uid, req.cookies.mcp_completion);
    const { maxAge: _maxAge, ...clearOptions } = proofCookie(interaction.uid);
    res.clearCookie('mcp_completion', clearOptions);
    if (!decision) return res.status(400).json({ error: 'INVALID_COMPLETION' });
    if (decision.denied) return provider.interactionFinished(req, res, { error: 'access_denied' }, { mergeWithLastSubmission: false });
    if (interaction.params.scope !== 'grades:read') return res.status(400).json({ error: 'INVALID_SCOPE' });
    const accountId = await store.saveAccount(decision.credentials);
    let grantId;
    try {
      const grant = new provider.Grant({ accountId, clientId: interaction.params.client_id });
      grant.addOIDCScope('grades:read');
      grant.addResourceScope(config.resource, 'grades:read');
      grantId = await grant.save();
      await store.saveConnection({ grantId, accountId, clientId: interaction.params.client_id });
      return await provider.interactionFinished(req, res, { login: { accountId, remember: false }, consent: { grantId } }, { mergeWithLastSubmission: false });
    } catch (error) {
      if (grantId) await store.revokeConnection(grantId);
      throw error;
    }
  }));

  router.post('/oauth/reg', boundedLimit(20, 60000), parseJSON, (req, res, next) => {
    const parsed = registration.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'invalid_client_metadata' });
    req.body = parsed.data;
    next();
  });
  router.use('/oauth', boundedLimit(240, 60000), provider.callback());

  async function authenticateMcp(raw) {
    if (typeof raw !== 'string' || raw.length > 2048) throw new Error('UNAUTHORIZED');
    const token = await provider.AccessToken.find(raw);
    if (!token || token.isExpired || token.aud !== config.resource || !token.scope?.split(' ').includes('grades:read')) throw new Error('UNAUTHORIZED');
    const connection = await store.activeConnection(token.grantId);
    if (!connection || connection.accountId !== token.accountId || connection.clientId !== token.clientId) throw new Error('UNAUTHORIZED');
    return { ...connection, tokenExpiresAt: token.exp };
  }
  return { router, provider, authenticateMcp };
}
