// Local-only fixture server. OAuth, PostgreSQL and MCP are real; only school data is synthetic.
import express from 'express';
import cors from 'cors';
import { createRequire } from 'node:module';
import { harness } from './helpers.mjs';
import { mountMcp } from '../server.mjs';
import https from 'node:https';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

if (process.env.NODE_ENV === 'production') throw new Error('Test fixture cannot run in production');
const require = createRequire(import.meta.url);
const { createAuthSession } = require('../../routes/api/middleware/auth.js');
const h = await harness({ port: 3002, frontendUrl: 'http://localhost:5173' });
const certDir = await mkdtemp(join(tmpdir(), 'synthetic-oauth-callback-'));
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(certDir, 'key.pem'), '-out', join(certDir, 'cert.pem'), '-subj', '/CN=localhost', '-days', '1'], { stdio: 'ignore' });
const callback = https.createServer({ key: await readFile(join(certDir, 'key.pem')), cert: await readFile(join(certDir, 'cert.pem')) }, (_req, res) => { res.setHeader('Cache-Control', 'no-store'); res.end('Connection returned'); });
await new Promise(resolve => callback.listen(3003, '127.0.0.1', resolve));
const school = {
  async getGrades() { return [{ class: 'SYNTHETIC_COURSE', name: 'Mathematics', average: '5', grades: [{ date: '01.01.2000', name: 'Synthetic assessment', value: '5', weighting: '1' }] }]; },
  async getUnconfirmedGrades() { return []; },
  async getGradeHistory() {
    const subject = (name, average) => ({ name, average: String(average), grades: [{ date: '01.01.2000', name: 'Synthetic assessment', value: String(average), weighting: '1' }] });
    const semesters = Array.from({ length: 5 }, (_, index) => ({ id: String(38 + index), label: `${index % 2 + 1}. ${24 + Math.floor(index / 2)}/${25 + Math.floor(index / 2)}`, isCurrent: index === 4, subjects: [subject('Deutsch', 4.5), subject('M' + (100 + index), 5), ...(index >= 2 ? [subject('Physik', 4)] : []), ...(index >= 4 ? [subject('Chemie', 5), subject('Interdisziplinäres Arbeiten in den Fächern 1.1', 4.5), subject('Interdisziplinäres Arbeiten in den Fächern 1.2', 5)] : [])] }));
    return { semesters, availableSemesters: semesters.map(({ subjects, ...term }) => term), selectedSemester: { id: '42', label: '1. 26/27' }, complete: true, issues: [], retrievedAt: '2026-11-10T12:00:00Z' };
  },
};
const handler = mountMcp(h.app, { config: h.config, oauth: h.oauth, store: h.store, school });
h.app.use(cors({ origin: h.config.frontendUrl }));
h.app.get('/api/mcp/status', (_req, res) => res.json({ enabled: true }));
h.app.get('/test/ready', (_req, res) => res.json({ ready: true }));
h.app.get('/api/mandators', (_req, res) => res.json([{ name: 'school-a', description: 'Synthetic school' }]));
h.app.get('/api/meta', (_req, res) => res.json({ mandators: [{ name: 'school-a', description: 'Synthetic school' }], features: { salPortal: false } }));
h.app.post('/api/authenticate', express.json(), (req, res) => {
  if (req.body.password !== 'SYNTHETIC_PASSWORD' || !['SYNTHETIC_STUDENT_A', 'SYNTHETIC_STUDENT_B'].includes(req.body.username)) return res.status(401).json({ authenticated: false, reason: 'INVALID_CREDENTIALS' });
  res.json({ authenticated: true, mandator: 'school-a', username: req.body.username, ...createAuthSession('school-a', req.body.username, req.body.password) });
});
h.app.get('/api/grades', async (_req, res) => res.json({ subjects: await school.getGrades() }));
h.app.get('/api/grade-history', async (_req, res) => res.json(await school.getGradeHistory()));
h.app.use('/api/qualification', express.json({ limit: '8kb' }), require('../../routes/api/qualification').createQualificationRouter({ school }));
h.app.get('/api/unconfirmed-grades', (_req, res) => res.json({ grades: [] }));
h.app.get('/api/absences', (_req, res) => res.json({ absences: [], tardiness: [], incidents: [], openReports: [] }));
h.app.get('/api/user/info', (_req, res) => res.json({ name: 'SYNTHETIC_STUDENT', class: 'SYNTHETIC_GROUP' }));
console.log('Local synthetic OAuth browser fixture ready');
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, async () => { callback.closeAllConnections(); await new Promise(resolve => callback.close(resolve)); await rm(certDir, { recursive: true }); await handler.close(); await h.close(); });
