// Kontrakt mezi bránou a nástěnkou: co brána zapíše (pravidla.mjs), musí nástěnka přečíst (sloupce.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { znackaVerdiktu, popisKontroly } from '../../.github/brana/pravidla.mjs';
import { prectiZnackuVerdiktu, prectiPopisBrany, stavBrany, urciSloupec } from '../src/sloupce.mjs';

const HLAVA = 'abc1234def5678abc1234def5678abc1234def56';
const PO = Date.parse('2026-11-20T10:00:00Z');

const verdikty = [
  { stav: 'ceka', duvody: [`Samosloučí se po ${new Date(PO).toISOString()}, pokud nikdo nepřidá \`stop\`.`], sloucitPo: PO, ocekavany: 'samo' },
  { stav: 'ceka', duvody: ['Nevratné změny: .github/x.', 'Sloučí se po štítku `schvaleno` od vlastníka.'], potrebujeCloveka: true, ocekavany: 'ceka' },
  { stav: 'ceka', duvody: ['Čeká na review druhým modelem pro tento commit.'], ocekavany: 'kontrola' },
  { stav: 'blokovano', duvody: ['Neprošly kontroly: Testy.'], ocekavany: 'ceka' },
  { stav: 'blokovano', duvody: ['Štítek `stop` přidal vlastnik.'], potrebujeCloveka: true, ocekavany: 'ceka' },
  { stav: 'sloucit', zpusob: 'samoslouceni', duvody: ['Vratná změna, review bez vážných nálezů, lhůta uplynula.'], ocekavany: 'samo' },
  { stav: 'sloucit', zpusob: 'schvaleni', duvody: ['Vlastník schválil tento commit.'], ocekavany: 'samo' },
];

for (const v of verdikty) {
  test(`verdikt ${v.stav}/${v.duvody[0].slice(0, 30)} → ${v.ocekavany}, ze značky i z popisu`, () => {
    const { state, popis } = popisKontroly(v);
    const telo = `<!-- brana:stav -->\n${znackaVerdiktu(v, HLAVA)}\n**Brána:** ${v.duvody.join(' ')}`;
    const znacka = prectiZnackuVerdiktu(telo);
    assert.equal(znacka.hlava, HLAVA);
    assert.equal(znacka.potrebujeCloveka, Boolean(v.potrebujeCloveka));
    assert.equal(znacka.sloucitPo, v.sloucitPo ?? null);

    const pr = { druh: 'pr', stav: 'open', stitky: [], draft: false };
    const zeZnacky = urciSloupec({ issue: null, pr: { ...pr, brana: stavBrany({ stav: state, popis }, znacka, HLAVA) } });
    const zPopisu = urciSloupec({ issue: null, pr: { ...pr, brana: stavBrany({ stav: state, popis }, null, HLAVA) } });
    assert.equal(zeZnacky.sloupec, v.ocekavany);
    assert.equal(zPopisu.sloupec, v.ocekavany, `popis „${popis}“`);
    assert.equal(prectiPopisBrany(popis).sloucitPo, v.sloucitPo ?? null);
  });
}

test('značka verdiktu nejde ukončit textem v JSON a nese commit', () => {
  const telo = znackaVerdiktu({ stav: 'ceka', duvody: ['x'] }, '--> <script>');
  assert.equal(telo.match(/-->/g).length, 1, 'jediné --> je konec komentáře');
  assert.equal(prectiZnackuVerdiktu(telo).hlava, '--> <script>');
});
