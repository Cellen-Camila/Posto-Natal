'use strict';
process.env.TZ = 'America/Fortaleza';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { open } = require('../server/db');
const { createApp } = require('../server/app');
const { seed } = require('../server/seed');

async function startServer({ withSeed = true } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'posto-test-'));
  const db = open(path.join(dataDir, 'posto.db'));
  if (withSeed) seed(db);
  const app = createApp({ db, dataDir });
  const server = app.server();
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const tokens = {};
  async function req(method, url, { body, as = 'gerente', raw = false, posto } = {}) {
    if (as && !tokens[as]) {
      const r = await fetch(base + '/api/login', { method: 'POST', body: JSON.stringify({ login: as, senha: 'posto123' }) });
      tokens[as] = (await r.json()).token;
    }
    const headers = { 'content-type': 'application/json' };
    if (as) headers.authorization = `Bearer ${tokens[as]}`;
    if (posto) headers['x-posto'] = String(posto);
    const r = await fetch(base + url, { method, headers, body: body ? JSON.stringify(body) : undefined });
    if (raw) return r;
    const data = r.headers.get('content-type')?.includes('json') ? await r.json() : await r.text();
    return { status: r.status, data };
  }
  return {
    db, base, req,
    close: () => new Promise((r) => { server.close(r); }).then(() => { db.close(); fs.rmSync(dataDir, { recursive: true, force: true }); }),
  };
}

module.exports = { startServer };
