// Synchronizační vrstva nad skutečnou migrací: D1 nahrazuje node:sqlite, GitHub podvržený fetch.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { behCronu, obnovRepozitar, zpracujWebhook } from '../src/synchronizace.mjs';

const MIGRACE = fs.readFileSync(new URL('../migrace/0001_zaklad.sql', import.meta.url), 'utf8');
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });

function d1() {
  const db = new DatabaseSync(':memory:');
  db.exec(MIGRACE);
  const prikaz = (sql, hodnoty = []) => ({
    bind: (...h) => prikaz(sql, h),
    first: async () => db.prepare(sql).get(...hodnoty) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...hodnoty) }),
    run: async () => db.prepare(sql).run(...hodnoty),
  });
  return { db, prepare: (sql) => prikaz(sql), batch: async (prikazy) => Promise.all(prikazy.map((p) => p.run())) };
}

const repoGraphql = (titulek) => ({
  data: { repository: {
    otevreneIssues: { nodes: [{ number: 1, title: titulek, url: 'https://github.com/a/b/issues/1', state: 'OPEN', stateReason: null, createdAt: '2026-11-18T10:00:00Z', closedAt: null, labels: { nodes: [{ name: 'zadani' }] } }] },
    zavreneIssues: { nodes: [] }, otevrenePr: { nodes: [] }, zavrenePr: { nodes: [] },
  } },
});

let env, volani, puvodniFetch, odpovedi;
beforeEach(() => {
  env = {
    DB: d1(),
    GITHUB_APP_ID: '1',
    GITHUB_APP_PRIVATE_KEY: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    SESSION_KEY: randomBytes(32).toString('base64'),
  };
  volani = [];
  odpovedi = { graphql: () => repoGraphql('Zadání') };
  puvodniFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const cesta = new URL(url).pathname;
    volani.push(`${init.method ?? 'GET'} ${cesta}`);
    const data =
      cesta.endsWith('/access_tokens') ? { token: 'ghs_test', expires_at: new Date(Date.now() + 3600e3).toISOString() }
      : cesta === '/app/installations' ? [{ id: 7, suspended_at: null }]
      : cesta === '/installation/repositories' ? { repositories: [{ id: 100, full_name: 'a/b' }] }
      : cesta === '/graphql' ? odpovedi.graphql()
      : null;
    if (data instanceof Error) return new Response(data.message, { status: 502 });
    return new Response(JSON.stringify(data), { status: 200 });
  };
});
afterEach(() => { globalThis.fetch = puvodniFetch; });

const repozitar = (id) => env.DB.db.prepare('SELECT * FROM repozitare WHERE id = ?').get(id);

test('installation.created uloží repozitáře, načte snímek a zaloguje událost', async () => {
  await zpracujWebhook(env, 'installation', { action: 'created', installation: { id: 7 }, repositories: [{ id: 100, full_name: 'a/b' }], sender: { login: 'vlastnik' } });
  const r = repozitar(100);
  assert.equal(r.installation_id, 7);
  assert.equal(JSON.parse(r.polozky)[0].titulek, 'Zadání');
  assert.equal(r.chyba, null);
  assert.equal(env.DB.db.prepare('SELECT typ FROM udalosti').get().typ, 'installation.created');
  // Token se uložil zašifrovaný a druhé načtení ho použije znovu.
  assert.notEqual(env.DB.db.prepare('SELECT token FROM tokeny').get().token, 'ghs_test');
  await obnovRepozitar(env, { id: 100, full_name: 'a/b', installation_id: 7 });
  assert.equal(volani.filter((v) => v.endsWith('/access_tokens')).length, 1);
});

test('událost z repozitáře obnoví snímek; chyba GitHubu se zapíše a starý snímek zůstane', async () => {
  await zpracujWebhook(env, 'issues', { action: 'labeled', installation: { id: 7 }, repository: { id: 100, full_name: 'a/b' } });
  odpovedi.graphql = () => new Error('výpadek');
  await zpracujWebhook(env, 'pull_request', { action: 'opened', installation: { id: 7 }, repository: { id: 100, full_name: 'a/b' } });
  const r = repozitar(100);
  assert.match(r.chyba, /502/);
  assert.equal(JSON.parse(r.polozky)[0].titulek, 'Zadání');
});

test('starší načtení nepřepíše novější snímek', async () => {
  await zpracujWebhook(env, 'issues', { action: 'opened', installation: { id: 7 }, repository: { id: 100, full_name: 'a/b' } });
  env.DB.db.prepare('UPDATE repozitare SET synchronizovano = ?, polozky = ? WHERE id = 100').run('2999-01-01T00:00:00.000Z', '[]');
  await obnovRepozitar(env, { id: 100, full_name: 'a/b', installation_id: 7 });
  assert.equal(repozitar(100).polozky, '[]');
});

test('installation.deleted a installation_repositories.removed repozitáře odeberou', async () => {
  await zpracujWebhook(env, 'installation', { action: 'created', installation: { id: 7 }, repositories: [{ id: 100, full_name: 'a/b' }, { id: 101, full_name: 'a/c' }] });
  await zpracujWebhook(env, 'installation_repositories', { action: 'removed', installation: { id: 7 }, repositories_removed: [{ id: 101 }] });
  assert.equal(repozitar(101), undefined);
  await zpracujWebhook(env, 'installation', { action: 'deleted', installation: { id: 7 } });
  assert.equal(repozitar(100), undefined);
  assert.equal(env.DB.db.prepare('SELECT COUNT(*) AS n FROM tokeny').get().n, 0);
});

test('cron smaže staré události a relace, odebere odinstalované repozitáře a obnoví zbytek', async () => {
  const db = env.DB.db;
  db.prepare('INSERT INTO udalosti (typ, kdy) VALUES (?, ?)').run('stara', '2020-01-01T00:00:00Z');
  db.prepare('INSERT INTO relace (id, login, token, plati_do) VALUES (?, ?, ?, ?)').run('x', 'v', 't', '2020-01-01T00:00:00Z');
  db.prepare('INSERT INTO repozitare (id, full_name, installation_id, pridano) VALUES (?, ?, ?, ?)').run(999, 'a/pryc', 7, '2026-01-01');
  await behCronu(env);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM udalosti').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM relace').get().n, 0);
  assert.equal(repozitar(999), undefined);
  assert.equal(JSON.parse(repozitar(100).polozky).length, 1);
});
