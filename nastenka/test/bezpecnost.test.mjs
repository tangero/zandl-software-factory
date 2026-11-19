import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import { overPodpisWebhooku, zasifruj, desifruj, jeVlastnik, cookies, nahodneId } from '../src/bezpecnost.mjs';

test('podpis webhooku: správný projde, cizí tajemství a chybějící hlavička ne', async () => {
  const telo = '{"action":"opened"}';
  const podpis = `sha256=${createHmac('sha256', 'tajne').update(telo).digest('hex')}`;
  assert.equal(await overPodpisWebhooku('tajne', telo, podpis), true);
  assert.equal(await overPodpisWebhooku('jine', telo, podpis), false);
  assert.equal(await overPodpisWebhooku('tajne', `${telo} `, podpis), false);
  assert.equal(await overPodpisWebhooku('tajne', telo, null), false);
  assert.equal(await overPodpisWebhooku('', telo, podpis), false);
});

test('šifrování tokenu: tam a zpět, pokaždé jiný výsledek, cizí klíč neprojde', async () => {
  const klic = randomBytes(32).toString('base64');
  const a = await zasifruj(klic, 'ghu_token');
  assert.notEqual(a, await zasifruj(klic, 'ghu_token'));
  assert.equal(await desifruj(klic, a), 'ghu_token');
  await assert.rejects(desifruj(randomBytes(32).toString('base64'), a));
  await assert.rejects(zasifruj('kratky', 'x'), /32 bajtů/);
});

test('vlastníci: seznam z proměnné, bez ohledu na velikost písmen', () => {
  assert.equal(jeVlastnik('Tangero', 'tangero, druhy'), true);
  assert.equal(jeVlastnik('druhy', 'tangero, druhy'), true);
  assert.equal(jeVlastnik('cizi', 'tangero'), false);
  assert.equal(jeVlastnik('', ''), false);
  assert.equal(jeVlastnik(undefined, 'tangero'), false);
});

test('cookies a náhodné id', () => {
  const r = new Request('https://x/', { headers: { Cookie: 'a=1; relace=abc=def' } });
  assert.deepEqual(cookies(r), { a: '1', relace: 'abc=def' });
  assert.match(nahodneId(), /^[0-9a-f]{64}$/);
});
