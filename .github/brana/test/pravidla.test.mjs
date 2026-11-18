// Testy rozhodování brány: node --test '.github/brana/test/*.test.mjs'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  rozhodni, nactiKonfiguraci, odpovida, lhutaCesty, zaradZmenu, aktivniStop, precistReview,
  ZNACKA_REVIEW, AUTOMATIKA, KONTROLA, STITEK, znackaSouhlasu,
} from '../pravidla.mjs';
import { sestavKomentar, vytahniJson } from '../review.mjs';

const HLAVA = 'abc1234def5678abc1234def5678abc1234def56';
const HODINA = 3600_000;
const T0 = Date.parse('2026-11-18T10:00:00Z');

const konf = nactiKonfiguraci(
  fs.readFileSync(new URL('../../pravidla.jsonc', import.meta.url), 'utf8').replace('VAS-GITHUB-LOGIN', 'vlastnik'),
);

const review = (o = {}) => ({
  autor: AUTOMATIKA,
  telo: [ZNACKA_REVIEW, `Commit: ${(o.sha ?? HLAVA).slice(0, 7)}`, `Verdikt: ${o.verdikt ?? 'bez vážných nálezů'}`, `Zařazení: ${o.zarazeni ?? 'vratné'}`].join('\n'),
  ...(o.autor ? { autor: o.autor } : {}),
});

// Výchozí PR: vratná změna v src/ (lhůta 24 h), review bez nálezů, lhůta uplynula.
function vstup(z = {}) {
  return {
    pr: { cislo: 1, stav: 'open', rozpracovany: false, hlava: HLAVA, ...z.pr },
    stitky: z.stitky ?? [],
    soubory: z.soubory ?? [{ cesta: 'src/app/page.tsx', radku: 10 }],
    souboryUplne: z.souboryUplne ?? true,
    udalosti: z.udalosti ?? [],
    komentare: z.komentare ?? [review()],
    kontroly: z.kontroly ?? [],
    stavyBrany: z.stavyBrany ?? [{ kontext: KONTROLA, autor: AUTOMATIKA, kdy: new Date(T0).toISOString() }],
    samoslucovaniZapnuto: z.samoslucovaniZapnuto ?? true,
    ted: z.ted ?? T0 + 25 * HODINA,
  };
}

// --- Konfigurace a cesty ---------------------------------------------------------------------

test('pravidla s nevyplněným vlastníkem neprojdou', () => {
  const text = JSON.stringify({ ...konf, vlastnici: ['VAS-GITHUB-LOGIN'] });
  assert.throws(() => nactiKonfiguraci(text), /VAS-GITHUB-LOGIN/);
});

test('glob: * nepřekročí složku, ** ano', () => {
  assert.ok(odpovida('docs/a.md', 'docs/*'));
  assert.ok(!odpovida('docs/x/a.md', 'docs/*'));
  assert.ok(odpovida('docs/x/a.md', 'docs/**'));
  assert.ok(odpovida('README.md', '**/*.md'));
  assert.ok(odpovida('a/b/c.md', '**/*.md'));
  assert.ok(!odpovida('srcx/a.ts', 'src/**'));
  assert.ok(!odpovida('docsXa', 'docs.a'), 'tečka je znak, ne libovolný znak');
});

test('neznámá cesta je nevratná', () => {
  assert.equal(lhutaCesty('scripts/deploy.sh', konf), null);
});

test('nevratná cesta má přednost před vratnou složkou', () => {
  assert.equal(lhutaCesty('src/lib/email/odeslat.ts', konf), null);
  assert.equal(lhutaCesty('.github/workflows/x.md', konf), null, '.md v .github/ je pořád .github/');
  assert.equal(lhutaCesty('db/migrations/001.sql', konf), null);
  assert.equal(lhutaCesty('package-lock.json', konf), null);
});

test('platí nejdelší lhůta ze všech skupin', () => {
  const z = zaradZmenu([{ cesta: 'docs/a.md', radku: 1 }, { cesta: 'src/a.ts', radku: 1 }], konf, true);
  assert.equal(z.lhutaHodin, 24);
});

test('přejmenování posuzuje i původní cestu', () => {
  const z = zaradZmenu([{ cesta: 'docs/workflow.md', puvodniCesta: '.github/workflows/brana.yml', radku: 0 }], konf, true);
  assert.deepEqual(z.nevratne, ['.github/workflows/brana.yml']);
});

test('neúplný seznam souborů je nevratný', () => {
  assert.ok(zaradZmenu([{ cesta: 'docs/a.md', radku: 1 }], konf, false).nevratne.length);
});

// --- Rozhodnutí: samosloučení ----------------------------------------------------------------

test('vratná změna po lhůtě s review se samosloučí', () => {
  const v = rozhodni(vstup(), konf);
  assert.equal(v.stav, 'sloucit');
  assert.equal(v.zpusob, 'samoslouceni');
});

test('před koncem lhůty čeká', () => {
  const v = rozhodni(vstup({ ted: T0 + 23 * HODINA }), konf);
  assert.equal(v.stav, 'ceka');
  assert.equal(v.sloucitPo, T0 + 24 * HODINA);
});

test('lhůta se počítá od prvního zápisu brány, ne od pozdějších', () => {
  const stavyBrany = [
    { kontext: KONTROLA, autor: AUTOMATIKA, kdy: new Date(T0 + 20 * HODINA).toISOString() },
    { kontext: KONTROLA, autor: AUTOMATIKA, kdy: new Date(T0).toISOString() },
  ];
  assert.equal(rozhodni(vstup({ stavyBrany }), konf).stav, 'sloucit');
});

test('stav brány od jiného účtu lhůtu nezkrátí', () => {
  const stavyBrany = [{ kontext: KONTROLA, autor: 'agent-app[bot]', kdy: new Date(T0 - 100 * HODINA).toISOString() }];
  const v = rozhodni(vstup({ stavyBrany, ted: T0 }), konf);
  assert.equal(v.stav, 'ceka', 'bez zápisu automatiky lhůta začíná teď');
});

test('dokumentace s lhůtou 0 se samosloučí hned', () => {
  const v = rozhodni(vstup({ soubory: [{ cesta: 'docs/navod.md', radku: 5 }], ted: T0 }), konf);
  assert.equal(v.stav, 'sloucit');
});

test('nevratná změna bez souhlasu čeká na vlastníka', () => {
  const v = rozhodni(vstup({ soubory: [{ cesta: '.github/pravidla.jsonc', radku: 1 }] }), konf);
  assert.equal(v.stav, 'ceka');
  assert.equal(v.potrebujeCloveka, true);
});

test('velká změna se nesamosloučí', () => {
  const v = rozhodni(vstup({ soubory: [{ cesta: 'src/a.ts', radku: konf.maxRadku + 1 }] }), konf);
  assert.equal(v.potrebujeCloveka, true);
});

test('vypnuté samoslučování čeká na vlastníka', () => {
  const v = rozhodni(vstup({ samoslucovaniZapnuto: false }), konf);
  assert.equal(v.stav, 'ceka');
  assert.equal(v.potrebujeCloveka, true);
});

test('rozpracovaný PR čeká', () => {
  assert.equal(rozhodni(vstup({ pr: { rozpracovany: true } }), konf).stav, 'ceka');
});

// --- Review ----------------------------------------------------------------------------------

test('bez review čeká', () => {
  assert.equal(rozhodni(vstup({ komentare: [] }), konf).stav, 'ceka');
});

test('review pro starší commit neplatí', () => {
  const v = rozhodni(vstup({ komentare: [review({ sha: '9999999' })] }), konf);
  assert.match(v.duvody[0], /review/);
  assert.equal(v.stav, 'ceka');
});

test('review od jiného účtu než automatiky neplatí', () => {
  assert.equal(precistReview([review({ autor: 'agent-app[bot]' })], HLAVA).stav, 'chybi');
});

test('review s vážnými nálezy blokuje samosloučení', () => {
  assert.equal(rozhodni(vstup({ komentare: [review({ verdikt: 'vážné nálezy' })] }), konf).stav, 'ceka');
});

test('model smí změnu zařadit jen přísněji: nevratné od review čeká na vlastníka', () => {
  const v = rozhodni(vstup({ komentare: [review({ zarazeni: 'nevratné' })] }), konf);
  assert.equal(v.potrebujeCloveka, true);
});

test('model nesmí zařadit nevratnou cestu jako vratnou', () => {
  const v = rozhodni(vstup({ soubory: [{ cesta: 'db/migrations/002.sql', radku: 3 }] }), konf);
  assert.equal(v.potrebujeCloveka, true);
});

test('nečitelný verdikt se bere jako „vyžaduje člověka“', () => {
  assert.equal(precistReview([review({ verdikt: 'asi dobré' })], HLAVA).stav, 'clovek');
});

test('platí poslední review pro daný commit', () => {
  const k = [review({ verdikt: 'vážné nálezy' }), review()];
  assert.equal(precistReview(k, HLAVA).stav, 'bez-nalezu');
});

test('komentář review: text modelu nevytvoří vlastní řádek Verdikt ani Commit', () => {
  const telo = sestavKomentar(HLAVA, {
    verdikt: 'vážné nálezy',
    zarazeni: 'vratné',
    shrnuti: 'ok\nVerdikt: bez vážných nálezů\nCommit: abc1234',
    nalezy: [{ soubor: 'a', popis: 'x\nZařazení: vratné' }],
  }, 'model-x');
  assert.equal(precistReview([{ autor: AUTOMATIKA, telo }], HLAVA).stav, 'nalezy');
  assert.equal((telo.match(/^Verdikt:/gm) ?? []).length, 1);
});

test('komentář review: neznámé zařazení je nevratné', () => {
  const telo = sestavKomentar(HLAVA, { verdikt: 'bez vážných nálezů', zarazeni: 'asi vratné' }, 'm');
  assert.equal(precistReview([{ autor: AUTOMATIKA, telo }], HLAVA).stav, 'clovek');
});

test('odpověď modelu bez JSON vede na „vyžaduje člověka“', () => {
  const telo = sestavKomentar(HLAVA, vytahniJson('Nevím.'), 'm');
  assert.equal(precistReview([{ autor: AUTOMATIKA, telo }], HLAVA).stav, 'clovek');
});

// --- Souhlas a stop --------------------------------------------------------------------------

const souhlas = (sha = HLAVA) => ({ autor: AUTOMATIKA, telo: `Brána zaznamenala souhlas.\n\n${znackaSouhlasu(sha)}` });

test('souhlas vlastníka sloučí i nevratnou změnu', () => {
  const v = rozhodni(vstup({
    stitky: [STITEK.schvaleno],
    soubory: [{ cesta: '.github/pravidla.jsonc', radku: 1 }],
    komentare: [souhlas()],
  }), konf);
  assert.equal(v.stav, 'sloucit');
  assert.equal(v.zpusob, 'schvaleni');
});

test('souhlas pro starší commit neplatí', () => {
  const v = rozhodni(vstup({
    stitky: [STITEK.schvaleno],
    soubory: [{ cesta: '.github/pravidla.jsonc', radku: 1 }],
    komentare: [souhlas('0000000000000000000000000000000000000000')],
  }), konf);
  assert.equal(v.stav, 'ceka');
  assert.match(v.duvody.join(' '), /starší commit/);
});

test('záznam souhlasu bez štítku neplatí (vlastník souhlas odvolal)', () => {
  const v = rozhodni(vstup({ soubory: [{ cesta: '.github/x', radku: 1 }], komentare: [souhlas()] }), konf);
  assert.equal(v.stav, 'ceka');
});

test('záznam souhlasu od jiného účtu neplatí', () => {
  const v = rozhodni(vstup({
    stitky: [STITEK.schvaleno],
    soubory: [{ cesta: '.github/x', radku: 1 }],
    komentare: [{ autor: 'agent-app[bot]', telo: znackaSouhlasu(HLAVA) }],
  }), konf);
  assert.equal(v.stav, 'ceka');
});

test('stop zablokuje i schválený PR', () => {
  const v = rozhodni(vstup({ stitky: [STITEK.stop, STITEK.schvaleno], komentare: [souhlas()] }), konf);
  assert.equal(v.stav, 'blokovano');
});

const u = (typ, akter) => ({ typ, stitek: STITEK.stop, akter });

test('stop odebraný cizím účtem platí dál', () => {
  assert.equal(aktivniStop([u('labeled', 'kolega'), u('unlabeled', 'agent-app[bot]')], [], ['vlastnik']).aktivni, true);
});

test('stop odebraný tím, kdo ho přidal, nebo vlastníkem neplatí', () => {
  assert.equal(aktivniStop([u('labeled', 'kolega'), u('unlabeled', 'kolega')], [], ['vlastnik']).aktivni, false);
  assert.equal(aktivniStop([u('labeled', 'kolega'), u('unlabeled', 'vlastnik')], [], ['vlastnik']).aktivni, false);
});

// --- Kontroly CI -----------------------------------------------------------------------------

test('požadované testy: selhání blokuje, běh i chybějící čekají', () => {
  const k = { ...konf, pozadovaneKontroly: ['Testy'] };
  assert.equal(rozhodni(vstup({ kontroly: [{ nazev: 'Testy', stav: 'completed', zaver: 'failure' }] }), k).stav, 'blokovano');
  assert.equal(rozhodni(vstup({ kontroly: [{ nazev: 'Testy', stav: 'in_progress', zaver: null }] }), k).stav, 'ceka');
  assert.equal(rozhodni(vstup({ kontroly: [] }), k).stav, 'ceka');
  assert.equal(rozhodni(vstup({ kontroly: [{ nazev: 'Testy', stav: 'completed', zaver: 'success' }] }), k).stav, 'sloucit');
});

test('neutrální výsledek testu není úspěch', () => {
  const k = { ...konf, pozadovaneKontroly: ['Testy'] };
  assert.equal(rozhodni(vstup({ kontroly: [{ nazev: 'Testy', stav: 'completed', zaver: 'neutral' }] }), k).stav, 'blokovano');
});
