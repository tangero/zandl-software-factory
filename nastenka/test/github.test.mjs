// Převod odpovědi GitHub GraphQL na položky nástěnky a podpis JWT aplikace.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, verify } from 'node:crypto';
import { polozkyZOdpovedi, souhrnKontrol, jwtAplikace, pemNaPkcs8, teloZadani } from '../src/github.mjs';
import { kartyNastenky } from '../src/sloupce.mjs';
import { znackaVerdiktu } from '../../.github/brana/pravidla.mjs';

const T = Date.parse('2026-11-19T12:00:00Z');
const HLAVA = 'abc1234def5678abc1234def5678abc1234def56';
const PO = Date.parse('2026-11-20T08:00:00Z');

const stitky = (...n) => ({ nodes: n.map((name) => ({ name })) });
const status = (o) => ({ __typename: 'StatusContext', context: 'Brána', state: 'PENDING', description: 'Čeká: …', creator: { login: 'github-actions' }, ...o });
const checkRun = (o) => ({ __typename: 'CheckRun', name: 'Testy', status: 'COMPLETED', conclusion: 'SUCCESS', ...o });

function otevrenePr(o = {}) {
  return {
    number: 9, title: 'Oprava', url: 'https://github.com/a/b/pull/9', state: 'OPEN', merged: false, isDraft: false,
    updatedAt: '2026-11-19T11:00:00Z', closedAt: null, headRefName: 'zadani/5-oprava', headRefOid: HLAVA,
    author: { login: 'agent' }, labels: stitky(), closingIssuesReferences: { nodes: [{ number: 5 }] }, reviewDecision: null,
    commits: { nodes: [{ commit: { statusCheckRollup: { contexts: { nodes: o.kontexty ?? [] } } } }] },
    comments: { nodes: o.komentare ?? [] },
    ...o.pr,
  };
}

const repository = (o = {}) => ({
  otevreneIssues: { nodes: [{ number: 5, title: 'Zadání', url: 'https://github.com/a/b/issues/5', state: 'OPEN', stateReason: null, updatedAt: '2026-11-19T10:00:00Z', closedAt: null, author: { login: 'vlastnik' }, labels: stitky('zadani') }] },
  zavreneIssues: { nodes: [] },
  otevrenePr: { nodes: o.otevrenePr ?? [otevrenePr()] },
  zavrenePr: { nodes: o.zavrenePr ?? [] },
});

const karty = (repo) => kartyNastenky([{ repo: 'a/b', polozky: polozkyZOdpovedi(repo, T) }], T);

test('lhůta samosloučení ze značky v komentáři brány', () => {
  const telo = `<!-- brana:stav -->\n${znackaVerdiktu({ stav: 'ceka', duvody: ['x'], sloucitPo: PO }, HLAVA)}\n**Brána:** …`;
  const [k] = karty(repository({ otevrenePr: [otevrenePr({
    kontexty: [status({ description: 'Čeká: Samosloučí se po 2026-11-20T08:00:00.000Z, pokud nikdo nepřidá `stop`.' })],
    komentare: [{ author: { login: 'github-actions' }, body: telo }],
  })] }));
  assert.equal(k.sloupec, 'samo');
  assert.equal(k.sloucitPo, PO);
  assert.equal(k.issue.cislo, 5);
  assert.equal(k.pr.cislo, 9);
});

test('stav Brána ani značku od někoho jiného než automatiky nástěnka nebere', () => {
  const falesnaZnacka = znackaVerdiktu({ stav: 'ceka', duvody: ['x'], sloucitPo: PO }, HLAVA);
  const [k] = karty(repository({ otevrenePr: [otevrenePr({
    kontexty: [status({ state: 'SUCCESS', creator: { login: 'agent' } })],
    komentare: [{ author: { login: 'agent' }, body: falesnaZnacka }],
  })] }));
  // Bez platné brány se PR posuzuje jako v repozitáři bez brány: žádné CI = čeká na sloučení člověkem.
  assert.equal(k.sloupec, 'ceka');
  assert.equal(k.sloucitPo, undefined);
});

test('souhrn kontrol vynechá Bránu; selhání > běh > úspěch', () => {
  assert.equal(souhrnKontrol([status({ state: 'FAILURE' })]), null);
  assert.equal(souhrnKontrol([checkRun()]), 'success');
  assert.equal(souhrnKontrol([checkRun(), checkRun({ status: 'IN_PROGRESS', conclusion: null })]), 'pending');
  assert.equal(souhrnKontrol([checkRun({ status: 'IN_PROGRESS', conclusion: null }), checkRun({ conclusion: 'FAILURE' })]), 'failure');
  assert.equal(souhrnKontrol([{ __typename: 'StatusContext', context: 'ci', state: 'ERROR' }]), 'failure');
  assert.equal(souhrnKontrol([checkRun({ conclusion: 'SKIPPED' })]), 'success');
});

test('uzavřené PR starší než 14 dní se nenačtou', () => {
  const zavreny = (closedAt) => ({ ...otevrenePr({ pr: { number: 3, state: 'MERGED', merged: true, closedAt, headRefName: 'x', closingIssuesReferences: { nodes: [] } } }) });
  const polozky = polozkyZOdpovedi(repository({ otevrenePr: [], zavrenePr: [zavreny('2026-11-18T00:00:00Z'), zavreny('2026-10-01T00:00:00Z')] }), T);
  assert.equal(polozky.filter((p) => p.druh === 'pr').length, 1);
});

test('JWT aplikace: PKCS#1 klíč z GitHubu se obalí a podpis ověří veřejným klíčem', async () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  for (const typ of ['pkcs1', 'pkcs8']) {
    const pem = privateKey.export({ type: typ, format: 'pem' });
    const jwt = await jwtAplikace(123, pem, T);
    const [h, p, s] = jwt.split('.');
    assert.ok(verify('RSA-SHA256', Buffer.from(`${h}.${p}`), publicKey, Buffer.from(s, 'base64url')), typ);
    const obsah = JSON.parse(Buffer.from(p, 'base64url'));
    assert.equal(obsah.iss, '123');
    assert.equal(obsah.exp - obsah.iat, 600);
  }
  assert.ok(pemNaPkcs8(privateKey.export({ type: 'pkcs1', format: 'pem' })).length > 1000);
});

test('tělo zadání má oddíly formuláře zadani.yml', () => {
  const t = teloZadani({ cil: 'A', hotovo: 'B', mimo: '', kontext: ' ' });
  assert.match(t, /^### Cíl\n\nA\n\n### Hotovo, když\n\nB\n\n### Mimo rozsah\n\n_No response_/);
});

test('zalozZadani: když štítek selže, vrátí issue s varováním místo chyby (žádný duplikát při opakování)', async () => {
  const { zalozZadani } = await import('../src/github.mjs');
  const puvodni = globalThis.fetch;
  const volani = [];
  globalThis.fetch = async (url, init) => {
    volani.push(`${init.method} ${new URL(url).pathname}`);
    if (url.endsWith('/labels')) return new Response('nope', { status: 403 });
    return new Response(JSON.stringify({ number: 42, html_url: 'https://github.com/a/b/issues/42' }), { status: 201 });
  };
  try {
    const v = await zalozZadani('t', 'a/b', { titulek: 'X', cil: 'c', hotovo: 'h' });
    assert.equal(v.cislo, 42);
    assert.match(v.varovani, /zadani/);
    assert.deepEqual(volani, ['POST /repos/a/b/issues', 'POST /repos/a/b/issues/42/labels']);
  } finally { globalThis.fetch = puvodni; }
});
