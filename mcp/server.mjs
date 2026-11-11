import express from 'express';
import { McpServer, createMcpHandler } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { z } from 'zod';
import { boundedLimit } from './oauth.mjs';
import { gradeOverview, subjectGrades, projectGrade, unconfirmedGrades } from './grades.mjs';
import qualification from '../qualification/index.js';
import { GRADE_INSTRUCTIONS } from './instructions.mjs';

const page = { offset: z.number().int().min(0).max(10000).default(0), limit: z.number().int().min(1).max(100).default(50) };

export function mountMcp(app, { config, oauth, store, school }) {
  const handler = createMcpHandler(({ authInfo }) => {
    const identity = authInfo?.extra?.connection;
    if (!identity) throw new Error('UNAUTHORIZED');
    const server = new McpServer({ name: 'kaschuso-grades', version: '0.2.0' }, { instructions: GRADE_INSTRUCTIONS });
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
        const result = { ...data, retrievedAt: data.retrievedAt || new Date().toISOString() };
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
      } catch (error) {
        if (error.name === 'ValidationError') return failure('INVALID_SCENARIO', 'Check the supported subject keys, grades and scenario inputs.');
        if (error.code === 'INVALID_SEMESTERS') return failure('INVALID_SEMESTERS', 'Choose up to eight available school semesters.');
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
    const history = options => school.getGradeHistory(mandator, username, password, options);
    tool('get_grade_history', 'Read up to eight authorised school semesters. Missing grades are unknown. Dates and semesters describe assessment history, not upload order.', z.object({ semesterIds: z.array(z.string().regex(/^\d{1,6}$/)).min(1).max(8).optional() }).strict(), async input => history(input));
    tool('get_qualification_overview', 'Get separate BM/BFS semester averages and the source-cited GIBS Solothurn Informatiker EFZ/BM1 TALS planner. Portal-derived results are provisional, with missing inputs and rule-source conflicts identified.', z.object({}).strict(), async () => qualification.buildQualification(await history()));
    const marks = z.record(z.string().max(80), z.number().min(1).max(6));
    const scenario = z.object({
      startYear: z.number().int().min(2000).max(2100).optional(),
      semesterOverrides: z.record(z.string().max(80), marks).optional(), targets: marks.optional(), examGrades: marks.optional(),
      examComponents: z.record(z.string().max(80), z.array(z.number().min(1).max(6)).min(1).max(4)).optional(),
      idafGroups: z.array(z.object({ semesterId: z.string().max(80), grades: z.array(z.number().min(1).max(6)).min(2).max(20) }).strict()).max(8).optional(),
      moduleSelections: z.record(z.string().max(80), z.string().max(80)).optional(),
      ukGrades: z.array(z.number().min(1).max(6)).max(7).optional(), ipaGrade: z.number().min(1).max(6).optional(),
      confirmedCertificateGrades: z.boolean().optional(),
    }).strict();
    tool('calculate_qualification_scenario', 'Calculate hypothetical BM targets, missing semester/exam grades, and the separate EFZ module/üK/IPA model using explicit assumptions. Never substitutes scenarios for observed school marks.', scenario, async input => {
      const valid = qualification.validateScenario(input);
      return qualification.buildQualification(await history(), valid);
    });
    return server;
  }, { responseMode: 'auto', maxRequestBodySize: 16384, maxSubscriptions: 0 });

  const router = express.Router();
  router.use((req, res, next) => {
    res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' });
    if (req.headers.host !== new URL(config.publicUrl).host) return res.status(400).json({ error: 'INVALID_HOST' });
    const origin = req.headers.origin;
    if (origin && !['https://chatgpt.com', 'https://claude.ai', 'https://claude.com', config.frontendUrl].includes(origin)) return res.status(403).json({ error: 'INVALID_ORIGIN' });
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
