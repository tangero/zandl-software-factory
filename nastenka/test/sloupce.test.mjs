// Testy sloupců nástěnky: node --test 'nastenka/test/*.test.mjs'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { urciSloupec, sestavKarty, kartyNastenky, cisloZadani, stavBrany, prectiPopisBrany, DNI_HOTOVO } from '../src/sloupce.mjs';

const T = Date.parse('2026-11-19T12:00:00Z');
const DEN = 86_400_000;
const iso = (ms) => new Date(ms).toISOString();

const issue = (o = {}) => ({ druh: 'issue', cislo: 5, titulek: 'Zadání', url: 'u/5', stitky: ['zadani'], stav: 'open', upraveno: iso(T), ...o });
const pr = (o = {}) => ({ druh: 'pr', cislo: 9, titulek: 'PR', url: 'u/9', stitky: [], stav: 'open', merged: false, draft: false, vetev: 'zadani/5-neco', uzaviraIssues: [], upraveno: iso(T), brana: null, kontroly: null, review: null, ...o });
const brana = (o = {}) => ({ stav: 'pending', popis: 'Čeká: …', potrebujeCloveka: false, sloucitPo: null, zpusob: null, ...o });
const sloupec = (karta) => urciSloupec(karta, T)?.sloupec ?? null;

test('issue bez PR: zadani = Zadáno, navrh = Návrhy, bez štítku se neukáže', () => {
  assert.equal(sloupec({ issue: issue() }), 'zadano');
  assert.equal(sloupec({ issue: issue({ stitky: ['navrh'] }) }), 'navrhy');
  assert.equal(sloupec({ issue: issue({ stitky: ['bug'] }) }), null);
});

test('otazka má přednost před vším otevřeným', () => {
  assert.equal(sloupec({ issue: issue({ stitky: ['zadani', 'otazka'] }), pr: pr({ draft: true }) }), 'ceka');
});

test('brána: failure, čeká na vlastníka i stop = Čeká na vás', () => {
  assert.equal(sloupec({ issue: issue(), pr: pr({ brana: brana({ stav: 'failure', popis: 'Zastaveno: …' }) }) }), 'ceka');
  assert.equal(sloupec({ issue: issue(), pr: pr({ brana: brana({ potrebujeCloveka: true }) }) }), 'ceka');
  assert.equal(sloupec({ issue: issue(), pr: pr({ stitky: ['stop'], brana: brana({ sloucitPo: T + DEN }) }) }), 'ceka');
});

test('brána: běžící lhůta a success = Sloučí se samo, s časem', () => {
  const v = urciSloupec({ issue: issue(), pr: pr({ brana: brana({ sloucitPo: T + 3600_000 }) }) }, T);
  assert.equal(v.sloupec, 'samo');
  assert.equal(v.sloucitPo, T + 3600_000);
  assert.equal(sloupec({ issue: issue(), pr: pr({ brana: brana({ stav: 'success' }) }) }), 'samo');
});

test('brána: draft = Agent pracuje, jinak pending = Kontroluje se', () => {
  assert.equal(sloupec({ issue: issue(), pr: pr({ draft: true, brana: brana({ popis: 'Čeká: PR je rozpracovaný (draft).' }) }) }), 'pracuje');
  assert.equal(sloupec({ issue: issue(), pr: pr({ brana: brana({ popis: 'Čeká: Čeká na review druhým modelem pro tento commit.' }) }) }), 'kontrola');
});

test('repozitář bez brány: sloupec z PR, kontrol a review', () => {
  assert.equal(sloupec({ issue: null, pr: pr({ draft: true }) }), 'pracuje');
  assert.equal(sloupec({ issue: null, pr: pr({ kontroly: 'pending' }) }), 'kontrola');
  assert.equal(sloupec({ issue: null, pr: pr({ kontroly: 'failure' }) }), 'ceka');
  assert.equal(sloupec({ issue: null, pr: pr({ kontroly: 'success', review: 'CHANGES_REQUESTED' }) }), 'ceka');
  // Zelené PR bez brány čeká na člověka, který ho sloučí.
  assert.equal(urciSloupec({ issue: null, pr: pr({ kontroly: 'success' }) }, T).duvod, 'připraveno ke sloučení');
  assert.equal(sloupec({ issue: null, pr: pr({ kontroly: null }) }), 'ceka');
});

test('sloučený PR = Hotovo, i když zadání zůstalo otevřené; ukáže, jak se sloučil', () => {
  const v = urciSloupec({ issue: issue(), pr: pr({ stav: 'closed', merged: true, stitky: ['samoslouceno'], uzavreno: iso(T - DEN) }) }, T);
  assert.equal(v.sloupec, 'hotovo');
  assert.equal(v.duvod, 'samosloučeno');
  assert.equal(urciSloupec({ issue: null, pr: pr({ stav: 'closed', merged: true, stitky: ['schvaleno'], uzavreno: iso(T) }) }, T).duvod, 'schváleno vlastníkem');
});

test('Hotovo a Zamítnuto zmizí po DNI_HOTOVO dnech', () => {
  const stary = iso(T - (DNI_HOTOVO + 1) * DEN);
  assert.equal(sloupec({ issue: null, pr: pr({ stav: 'closed', merged: true, uzavreno: stary }) }), null);
  assert.equal(sloupec({ issue: issue({ stav: 'closed', duvodUzavreni: 'not_planned', uzavreno: stary }) }), null);
});

test('zamítnutí: štítek, not_planned, PR zavřený bez sloučení', () => {
  assert.equal(sloupec({ issue: issue({ stav: 'closed', stitky: ['zamitnuto'], uzavreno: iso(T) }) }), 'zamitnuto');
  assert.equal(sloupec({ issue: issue({ stav: 'closed', duvodUzavreni: 'not_planned', uzavreno: iso(T) }) }), 'zamitnuto');
  assert.equal(sloupec({ issue: null, pr: pr({ stav: 'closed', uzavreno: iso(T) }) }), 'zamitnuto');
  // Uzavřené issue bez štítků zadání na nástěnku nepatří.
  assert.equal(sloupec({ issue: issue({ stav: 'closed', stitky: [], uzavreno: iso(T) }) }), null);
});

test('otevřené zadání se zavřeným nesloučeným PR je znovu Zadáno', () => {
  assert.equal(sloupec({ issue: issue(), pr: pr({ stav: 'closed', uzavreno: iso(T) }) }), 'zadano');
});

test('PR k zadání: větev zadani/<číslo>-…, jinak jediné uzavírané issue', () => {
  assert.equal(cisloZadani({ vetev: 'zadani/12-oprava' }), 12);
  assert.equal(cisloZadani({ vetev: 'zadani/12' }), 12);
  assert.equal(cisloZadani({ vetev: 'zadani/12x' }), null);
  assert.equal(cisloZadani({ vetev: 'feature', uzaviraIssues: [7] }), 7);
  assert.equal(cisloZadani({ vetev: 'feature', uzaviraIssues: [7, 8] }), null);
});

test('karta: issue a jeho PR jsou jedna karta, otevřené PR má přednost před starším zavřeným', () => {
  const karty = sestavKarty([
    issue(),
    pr({ cislo: 8, stav: 'closed', upraveno: iso(T + DEN) }),
    pr({ cislo: 9 }),
    pr({ cislo: 10, vetev: 'jina-vec' }),
    pr({ cislo: 11, vetev: 'zadani/99-neexistuje' }),
  ]);
  assert.equal(karty.length, 3);
  assert.equal(karty[0].pr.cislo, 9);
  assert.deepEqual(karty.slice(1).map((k) => k.pr.cislo), [10, 11]);
});

test('kartyNastenky: klíč, odkazy, vynechá karty mimo nástěnku', () => {
  const karty = kartyNastenky([{ repo: 'a/b', polozky: [issue(), issue({ cislo: 6, stitky: [] }), pr()] }], T);
  assert.equal(karty.length, 1);
  assert.equal(karty[0].klic, 'a/b#5');
  assert.equal(karty[0].pr.cislo, 9);
  assert.equal(karty[0].sloupec, 'ceka', 'PR bez brány a bez CI čeká na sloučení');
});

test('stavBrany: značka platí jen pro aktuální commit, jinak se čte popis', () => {
  const status = { stav: 'pending', popis: 'Čeká: Samosloučí se po 2026-11-20T10:00:00.000Z, pokud nikdo nepřidá `stop`.' };
  const znacka = { stav: 'ceka', potrebujeCloveka: false, sloucitPo: Date.parse('2026-11-21T10:00:00Z'), zpusob: null, hlava: 'aaa' };
  assert.equal(stavBrany(status, znacka, 'aaa').sloucitPo, Date.parse('2026-11-21T10:00:00Z'));
  assert.equal(stavBrany(status, znacka, 'bbb').sloucitPo, Date.parse('2026-11-20T10:00:00Z'));
  assert.equal(stavBrany(null, znacka, 'aaa'), null);
});

test('prectiPopisBrany: čeká na vlastníka a zastaveno potřebují člověka', () => {
  assert.equal(prectiPopisBrany('Čeká na vlastníka: Nevratné změny: .github/x.').potrebujeCloveka, true);
  assert.equal(prectiPopisBrany('Zastaveno: Neprošly kontroly: Testy.').potrebujeCloveka, true);
  assert.equal(prectiPopisBrany('Čeká: PR je rozpracovaný (draft).').potrebujeCloveka, false);
  assert.equal(prectiPopisBrany(undefined).sloucitPo, null);
});

test('otevřené zadání se štítkem zamitnuto je Zamítnuto, ne Zadáno ani Návrh', () => {
  assert.equal(sloupec({ issue: issue({ stitky: ['zadani', 'zamitnuto'] }) }), 'zamitnuto');
  assert.equal(sloupec({ issue: issue({ stitky: ['navrh', 'zamitnuto'] }) }), 'zamitnuto');
  assert.equal(sloupec({ issue: issue({ stitky: ['zamitnuto'] }) }), 'zamitnuto');
  // Otevřený PR má přednost: práce ještě běží.
  assert.equal(sloupec({ issue: issue({ stitky: ['zadani', 'zamitnuto'] }), pr: pr({ draft: true }) }), 'pracuje');
});
