import express from 'express';
import { McpServer, createMcpHandler } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { z } from 'zod';
import { boundedLimit } from './oauth.mjs';
import { gradeOverview, subjectGrades, projectGrade, unconfirmedGrades } from './grades.mjs';

const page = { offset: z.number().int().min(0).max(10000).default(0), limit: z.number().int().min(1).max(100).default(50) };

export function mountMcp(app, { config, oauth, store, school }) {
  const handler = createMcpHandler(({ authInfo }) => {
    const identity = authInfo?.extra?.connection;
    if (!identity) throw new Error('UNAUTHORIZED');
    const server = new McpServer({ name: 'kaschuso-grades', version: '0.1.0' });
    const { mandator, username, password } = identity.credentials;
    const annotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
    const tool = (name, description, inputSchema, action) => server.registerTool(name, {
      description, inputSchema, annotations,
      _meta: { securitySchemes: [{ type: 'oauth2', scopes: ['grades:read'] }] },
    }, async input => {
      try {
        // A fresh lookup protects calls queued before a connection was revoked.
        const active = await store.activeConnection(identity.grantId);
        if (!active) return failure('RECONNECT_REQUIRED', 'Connect your school account again.');
        if (active.reconnect) return failure('RECONNECT_REQUIRED', 'School sign-in needs updating. Reconnect through the dashboard.');
        const data = await action(input);
        if (!(await store.activeConnection(identity.grantId))) return failure('RECONNECT_REQUIRED', 'This connection was disconnected.');
        const result = { ...data, retrievedAt: new Date().toISOString() };
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
      } catch (error) {
        const reason = school.getAuthenticationFailureInfo?.(error)?.reason;
        if (reason === 'INVALID_CREDENTIALS') {
          try { await store.markReconnect(identity.accountId); }
          catch { return failure('TEMPORARILY_UNAVAILABLE', 'Grade data is temporarily unavailable. Please try again.'); }
          return failure('RECONNECT_REQUIRED', 'School sign-in needs updating. Reconnect through the dashboard.');
        }
        return failure('TEMPORARILY_UNAVAILABLE', 'Grade data is temporarily unavailable. Please try again.');
      }
    });
    const grades = () => school.getGrades(mandator, username, password);
    tool('get_grade_overview', 'Get current subjects, portal averages and assessment counts. Use returned references to retrieve detailed grades.', z.object({}).strict(), async () => gradeOverview(await grades()));
    tool('get_subject_grades', 'Get paginated exam details and source weights for a subject. Subject averages and individual class averages are separate.', z.object({ subject: z.string().min(1).max(200), ...page }).strict(), async input => subjectGrades(await grades(), input));
    tool('get_unconfirmed_grades', 'Get grades awaiting confirmation. The assessment date does not indicate when a grade was uploaded.', z.object(page).strict(), async input => {
      const feed = await school.getUnconfirmedGrades(mandator, username, password);
      return unconfirmedGrades(feed, input.offset, input.limit, feed.length ? await grades() : []);
    });
    tool('calculate_grade_projection', 'Estimate the next grade needed for an exact unrounded subject-average target. Requires a supplied next-assessment weight; does not infer school rounding rules.', z.object({ subject: z.string().min(1).max(200), targetAverage: z.number().min(1).max(6), nextWeight: z.number().positive().max(10000) }).strict(), async input => projectGrade(await grades(), input));
    return server;
  }, { responseMode: 'auto', maxRequestBodySize: 16384, maxSubscriptions: 0 });

  const router = express.Router();
  router.use((req, res, next) => {
    res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' });
    if (req.headers.host !== new URL(config.publicUrl).host) return res.status(400).json({ error: 'INVALID_HOST' });
    const origin = req.headers.origin;
    if (origin && !['https://chatgpt.com', config.frontendUrl].includes(origin)) return res.status(403).json({ error: 'INVALID_ORIGIN' });
    if (origin) res.set({ 'Access-Control-Allow-Origin': origin, Vary: 'Origin', 'Access-Control-Allow-Headers': 'Authorization, Content-Type, MCP-Protocol-Version, MCP-Session-Id', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Expose-Headers': 'WWW-Authenticate, MCP-Session-Id' });
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });
  router.use((req, res, next) => {
    const raw = /^Bearer (\S+)$/i.exec(req.headers.authorization || '')?.[1];
    oauth.authenticateMcp(raw).then(identity => { req.mcpIdentity = identity; req.mcpToken = raw; next(); }).catch(error => {
      if (error.message !== 'UNAUTHORIZED') return res.status(503).json({ error: 'TEMPORARILY_UNAVAILABLE' });
      res.status(401).set('WWW-Authenticate', `Bearer resource_metadata="${config.publicUrl}/.well-known/oauth-protected-resource", scope="grades:read"`).json({ error: 'UNAUTHORIZED' });
    });
  });
  router.use(boundedLimit(60, 60000, req => req.mcpIdentity.accountId));
  router.all('/', (req, res, next) => {
    const identity = req.mcpIdentity;
    const nodeHandler = toNodeHandler({ fetch: request => handler.fetch(request, { authInfo: { token: req.mcpToken, clientId: identity.clientId, scopes: ['grades:read'], expiresAt: identity.tokenExpiresAt, resource: new URL(config.resource), extra: { connection: identity } } }) }, { maxRequestBodySize: 16384 });
    nodeHandler(req, res).catch(next);
  });
  app.use('/mcp', router);
  return handler;
}

function failure(code, message) {
  const result = { error: code, message };
  return { isError: true, content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
}
