// Stránka nástěnky: HTML, styl a skript bez závislostí a bez build kroku.
// Text z GitHubu (titulky, štítky) se vkládá výhradně přes textContent, nikdy jako HTML.

const hlava = (titulek) => `<!doctype html>
<html lang="cs">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${titulek}</title>
<link rel="stylesheet" href="/styl.css">
</head>`;

const escapuj = (t) => String(t).replace(/[&<>"']/g, (z) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[z]);

export const chybovaStranka = (nadpis, text) => `${hlava('Nástěnka')}
<body class="stred">
<main class="okno">
<h1>${escapuj(nadpis)}</h1>
<p>${escapuj(text)}</p>
<p><a class="tlacitko" href="/">Zpět na nástěnku</a></p>
</main>
</body>
</html>`;

export const PRIHLASENI = `${hlava('Nástěnka')}
<body class="stred">
<main class="okno">
<h1>Nástěnka práce</h1>
<p>Stav zadání a PR ze všech repozitářů vaší software factory. Přístup mají jen vlastníci.</p>
<p><a class="tlacitko hlavni" href="/prihlasit">Přihlásit přes GitHub</a></p>
</main>
</body>
</html>`;

export const STRANKA = `${hlava('Nástěnka')}
<body>
<header class="lista">
  <h1>Nástěnka</h1>
  <div class="ovladani">
    <label>Repozitář <select id="filtr"><option value="">Všechny</option></select></label>
    <label class="prepinac"><input type="checkbox" id="zamitnute"> Zamítnuté</label>
    <div class="segment" role="group" aria-label="Zobrazení">
      <button type="button" id="pohled-sloupce" aria-pressed="true">Sloupce</button>
      <button type="button" id="pohled-tabulka" aria-pressed="false">Tabulka</button>
    </div>
    <button type="button" class="tlacitko hlavni" id="nove">Nové zadání</button>
  </div>
  <div class="uzivatel">
    <a id="pridat-repo" href="#" target="_blank" rel="noopener">Přidat repozitář</a>
    <span id="login"></span>
    <form method="post" action="/odhlasit"><button type="submit" class="odkaz">Odhlásit</button></form>
  </div>
</header>
<p id="hlaseni" class="hlaseni" hidden></p>
<main id="obsah" aria-live="polite"></main>
<footer class="pata" id="pata"></footer>

<dialog id="dialog">
  <form id="formular" method="dialog">
    <h2>Nové zadání pro agenta</h2>
    <label>Repozitář <select name="repo" required></select></label>
    <label>Název <input name="titulek" required maxlength="250" placeholder="Krátce, co se má udělat"></label>
    <label>Cíl <textarea name="cil" required rows="3" placeholder="Co se má změnit a pro koho. Jedna až tři věty."></textarea></label>
    <label>Hotovo, když <textarea name="hotovo" required rows="3" placeholder="Ověřitelné podmínky, podle kterých agent pozná, že skončil."></textarea></label>
    <label>Mimo rozsah <textarea name="mimo" rows="2" placeholder="Co agent dělat nemá."></textarea></label>
    <label>Podklady <textarea name="kontext" rows="2" placeholder="Odkazy, soubory, data."></textarea></label>
    <label class="prepinac"><input type="checkbox" name="navrh"> Uložit jen jako návrh (štítek navrh, agent ho zatím nerealizuje)</label>
    <p class="chyba" id="chyba-formulare" hidden></p>
    <div class="akce">
      <button type="button" class="tlacitko" id="zrusit">Zrušit</button>
      <button type="submit" class="tlacitko hlavni" id="odeslat">Založit zadání</button>
    </div>
  </form>
</dialog>
<script src="/app.js" defer></script>
</body>
</html>`;

export const STYL = `
:root {
  --pozadi: #f6f7f9; --plocha: #ffffff; --text: #1b1f24; --tlumeny: #5b6573; --okraj: #d9dee5;
  --akcent: #1f6feb; --akcent-text: #ffffff; --ceka: #d1242f; --samo: #1a7f37; --varovani: #9a6700;
  --stin: 0 1px 2px rgba(0,0,0,.06);
  color-scheme: light dark;
}
@media (prefers-color-scheme: dark) {
  :root { --pozadi: #0f1216; --plocha: #181c22; --text: #e6e9ee; --tlumeny: #9aa4b2; --okraj: #2c333d;
    --akcent: #4493f8; --akcent-text: #0f1216; --ceka: #ff7b72; --samo: #3fb950; --varovani: #d29922; --stin: none; }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--pozadi); color: var(--text); font: 14px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; }
a { color: var(--akcent); }
h1 { font-size: 18px; margin: 0; }
h2 { font-size: 17px; margin: 0 0 12px; }
.stred { display: grid; place-items: center; min-height: 100vh; padding: 16px; }
.okno { background: var(--plocha); border: 1px solid var(--okraj); border-radius: 12px; padding: 24px; max-width: 440px; }
.lista { display: flex; flex-wrap: wrap; align-items: center; gap: 12px 24px; padding: 12px 16px; background: var(--plocha); border-bottom: 1px solid var(--okraj); position: sticky; top: 0; z-index: 2; }
.ovladani { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; flex: 1; }
.uzivatel { display: flex; align-items: center; gap: 12px; color: var(--tlumeny); }
.uzivatel form { margin: 0; }
label { color: var(--tlumeny); }
select, input, textarea { font: inherit; color: var(--text); background: var(--plocha); border: 1px solid var(--okraj); border-radius: 6px; padding: 5px 8px; }
.prepinac { display: inline-flex; align-items: center; gap: 6px; }
.tlacitko, .segment button { font: inherit; cursor: pointer; border: 1px solid var(--okraj); background: var(--plocha); color: var(--text); border-radius: 6px; padding: 6px 12px; text-decoration: none; display: inline-block; }
.tlacitko.hlavni { background: var(--akcent); border-color: var(--akcent); color: var(--akcent-text); font-weight: 600; }
.segment { display: inline-flex; }
.segment button { border-radius: 0; }
.segment button:first-child { border-radius: 6px 0 0 6px; }
.segment button:last-child { border-radius: 0 6px 6px 0; border-left: 0; }
.segment button[aria-pressed="true"] { background: var(--okraj); font-weight: 600; }
.odkaz { font: inherit; background: none; border: 0; color: var(--akcent); cursor: pointer; padding: 0; }
.hlaseni { margin: 12px 16px 0; padding: 8px 12px; border-radius: 6px; border: 1px solid var(--varovani); color: var(--text); }
.tabule { display: flex; gap: 12px; padding: 16px; overflow-x: auto; align-items: flex-start; }
.sloupec { flex: 1 1 240px; min-width: 210px; }
/* Prázdný sloupec jen ukazuje, že existuje; místo nechá sloupcům s kartami. */
.sloupec.prazdny { flex: 0 0 120px; min-width: 120px; }
.sloupec.prazdny h2 { flex-direction: column; gap: 2px; }
.sloupec h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .04em; color: var(--tlumeny); display: flex; justify-content: space-between; margin: 0 0 8px; }
.sloupec[data-id="ceka"] h2 { color: var(--ceka); }
.sloupec[data-id="samo"] h2 { color: var(--samo); }
.karty { display: grid; gap: 8px; }
.karta { background: var(--plocha); border: 1px solid var(--okraj); border-radius: 8px; padding: 10px 12px; box-shadow: var(--stin); }
.sloupec[data-id="ceka"] .karta { border-left: 3px solid var(--ceka); }
.karta .repo { font-size: 12px; color: var(--tlumeny); }
.karta .nazev { font-weight: 600; display: block; margin: 2px 0 4px; color: var(--text); text-decoration: none; overflow-wrap: anywhere; }
.karta .nazev:hover { text-decoration: underline; }
.karta .duvod { font-size: 13px; color: var(--tlumeny); overflow-wrap: anywhere; }
.karta .cas { font-size: 13px; color: var(--samo); font-weight: 600; }
.karta .odkazy { font-size: 12px; margin-top: 6px; display: flex; gap: 10px; flex-wrap: wrap; }
.prazdne { color: var(--tlumeny); font-size: 13px; padding: 8px 0; }
.tabulka { padding: 16px; overflow-x: auto; }
table { width: 100%; border-collapse: collapse; background: var(--plocha); border: 1px solid var(--okraj); }
th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--okraj); vertical-align: top; }
th { font-size: 12px; color: var(--tlumeny); text-transform: uppercase; letter-spacing: .04em; }
.pata { padding: 8px 16px 24px; color: var(--tlumeny); font-size: 12px; }
.pata .chyba-repo { color: var(--ceka); }
dialog { border: 1px solid var(--okraj); border-radius: 12px; padding: 20px; width: min(560px, calc(100vw - 32px)); background: var(--plocha); color: var(--text); }
dialog::backdrop { background: rgba(0,0,0,.4); }
dialog form { display: grid; gap: 10px; }
dialog label { display: grid; gap: 4px; }
dialog label.prepinac { display: flex; }
.akce { display: flex; justify-content: flex-end; gap: 8px; margin-top: 6px; }
.chyba { color: var(--ceka); margin: 0; }
@media (max-width: 700px) {
  .tabule { flex-direction: column; align-items: stretch; }
  .sloupec, .sloupec.prazdny { flex: none; min-width: 0; }
  .sloupec.prazdny h2 { flex-direction: row; }
  .uzivatel { width: 100%; justify-content: space-between; }
}
`;

export const SKRIPT = `
'use strict';
const stav = { data: null, pohled: 'sloupce' };
const $ = (id) => document.getElementById(id);
const el = (znacka, trida, text) => { const e = document.createElement(znacka); if (trida) e.className = trida; if (text != null) e.textContent = text; return e; };
const casFormat = new Intl.DateTimeFormat('cs-CZ', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });
const kdy = (ms) => casFormat.format(new Date(ms));

try { stav.pohled = localStorage.getItem('nastenka-pohled') || 'sloupce'; } catch {}

async function nacti() {
  const odpoved = await fetch('/api/karty', { headers: { Accept: 'application/json' } });
  if (odpoved.status === 401) { location.href = '/prihlasit'; return; }
  if (!odpoved.ok) { hlaseni('Nástěnku se nepodařilo načíst. Zkusím to znovu za minutu.'); return; }
  stav.data = await odpoved.json();
  hlaseni('');
  vykresli();
}

function hlaseni(text) { const h = $('hlaseni'); h.textContent = text; h.hidden = !text; }

function viditelneKarty() {
  const repo = $('filtr').value;
  const zamitnute = $('zamitnute').checked;
  return stav.data.karty.filter((k) => (!repo || k.repo === repo) && (zamitnute || k.sloupec !== 'zamitnuto'));
}

function karta(k) {
  const div = el('article', 'karta');
  div.append(el('div', 'repo', k.repo));
  const a = el('a', 'nazev', k.titulek); a.href = k.url; a.target = '_blank'; a.rel = 'noopener'; div.append(a);
  if (k.sloupec === 'samo' && k.sloucitPo) div.append(el('div', 'cas', 'Sloučí se po ' + kdy(k.sloucitPo)));
  div.append(el('div', 'duvod', k.duvod));
  const odkazy = el('div', 'odkazy');
  if (k.issue) { const i = el('a', null, 'zadání #' + k.issue.cislo); i.href = k.issue.url; i.target = '_blank'; i.rel = 'noopener'; odkazy.append(i); }
  if (k.pr) { const p = el('a', null, (k.pr.draft ? 'draft PR #' : 'PR #') + k.pr.cislo); p.href = k.pr.url; p.target = '_blank'; p.rel = 'noopener'; odkazy.append(p); }
  div.append(odkazy);
  return div;
}

function vykresliSloupce(karty) {
  const tabule = el('div', 'tabule');
  for (const s of stav.data.sloupce) {
    if (s.id === 'zamitnuto' && !$('zamitnute').checked) continue;
    const vSloupci = karty.filter((k) => k.sloupec === s.id);
    const sekce = el('section', vSloupci.length ? 'sloupec' : 'sloupec prazdny'); sekce.dataset.id = s.id;
    const h = el('h2'); h.append(el('span', null, s.nazev), el('span', null, String(vSloupci.length)));
    const seznam = el('div', 'karty');
    if (!vSloupci.length) seznam.append(el('div', 'prazdne', '–'));
    for (const k of vSloupci) seznam.append(karta(k));
    sekce.append(h, seznam);
    tabule.append(sekce);
  }
  return tabule;
}

function vykresliTabulku(karty) {
  const obal = el('div', 'tabulka');
  const t = el('table');
  const hlavicka = el('tr');
  for (const n of ['Sloupec', 'Repozitář', 'Název', 'Stav', 'Odkazy']) hlavicka.append(el('th', null, n));
  const thead = el('thead'); thead.append(hlavicka); t.append(thead);
  const tbody = el('tbody');
  const poradi = new Map(stav.data.sloupce.map((s, i) => [s.id, i]));
  const nazvy = new Map(stav.data.sloupce.map((s) => [s.id, s.nazev]));
  for (const k of [...karty].sort((a, b) => poradi.get(a.sloupec) - poradi.get(b.sloupec))) {
    const r = el('tr');
    r.append(el('td', null, nazvy.get(k.sloupec)), el('td', null, k.repo));
    const td = el('td'); const a = el('a', null, k.titulek); a.href = k.url; a.target = '_blank'; a.rel = 'noopener'; td.append(a); r.append(td);
    r.append(el('td', null, k.sloucitPo ? k.duvod + ' (po ' + kdy(k.sloucitPo) + ')' : k.duvod));
    const odk = el('td');
    if (k.issue) odk.append(el('span', null, '#' + k.issue.cislo + ' '));
    if (k.pr) odk.append(el('span', null, 'PR #' + k.pr.cislo));
    r.append(odk); tbody.append(r);
  }
  t.append(tbody); obal.append(t);
  return obal;
}

function vykresli() {
  const d = stav.data;
  $('login').textContent = d.login;
  $('pridat-repo').href = d.instalace;
  const filtr = $('filtr'); const vybrany = filtr.value;
  filtr.replaceChildren(new Option('Všechny', ''), ...d.repozitare.map((r) => new Option(r.nazev, r.nazev)));
  filtr.value = d.repozitare.some((r) => r.nazev === vybrany) ? vybrany : '';
  $('pohled-sloupce').setAttribute('aria-pressed', String(stav.pohled === 'sloupce'));
  $('pohled-tabulka').setAttribute('aria-pressed', String(stav.pohled === 'tabulka'));
  const obsah = $('obsah');
  if (!d.repozitare.length) {
    const p = el('div', 'okno');
    p.append(el('h2', null, 'Zatím žádný repozitář'));
    p.append(el('p', null, 'Nainstalujte aplikaci nástěnky na repozitáře, které chcete sledovat. Do minuty se tu objeví.'));
    const a = el('a', 'tlacitko hlavni', 'Přidat repozitář'); a.href = d.instalace; a.target = '_blank'; a.rel = 'noopener'; p.append(a);
    obsah.replaceChildren(p);
  } else {
    const karty = viditelneKarty();
    obsah.replaceChildren(stav.pohled === 'tabulka' ? vykresliTabulku(karty) : vykresliSloupce(karty));
  }
  const pata = $('pata'); pata.replaceChildren();
  pata.append(el('span', null, 'Hotovo ukazuje posledních ' + d.dniHotovo + ' dní. '));
  for (const r of d.repozitare.filter((r) => r.chyba)) pata.append(el('div', 'chyba-repo', r.nazev + ': ' + r.chyba));
}

function otevriFormular() {
  if (!stav.data?.repozitare.length) return;
  const f = $('formular');
  f.repo.replaceChildren(...stav.data.repozitare.map((r) => new Option(r.nazev, r.nazev)));
  if ($('filtr').value) f.repo.value = $('filtr').value;
  $('chyba-formulare').hidden = true;
  $('dialog').showModal();
  f.titulek.focus();
}

async function odesli(udalost) {
  udalost.preventDefault();
  const f = $('formular');
  const tlacitko = $('odeslat'); tlacitko.disabled = true;
  const data = { repo: f.repo.value, titulek: f.titulek.value, cil: f.cil.value, hotovo: f.hotovo.value, mimo: f.mimo.value, kontext: f.kontext.value, stitek: f.navrh.checked ? 'navrh' : 'zadani' };
  try {
    const odpoved = await fetch('/api/zadani', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Nastenka': '1' }, body: JSON.stringify(data) });
    const vysledek = await odpoved.json().catch(() => ({}));
    if (!odpoved.ok) throw new Error(vysledek.chyba || 'Zadání se nepodařilo založit.');
    f.reset(); $('dialog').close();
    hlaseni('Zadání #' + vysledek.cislo + ' je založené. Na nástěnce se objeví po obnovení z GitHubu.');
    setTimeout(nacti, 4000);
  } catch (e) {
    const ch = $('chyba-formulare'); ch.textContent = e.message; ch.hidden = false;
  } finally { tlacitko.disabled = false; }
}

function nastavPohled(p) { stav.pohled = p; try { localStorage.setItem('nastenka-pohled', p); } catch {} vykresli(); }

$('filtr').addEventListener('change', vykresli);
$('zamitnute').addEventListener('change', vykresli);
$('pohled-sloupce').addEventListener('click', () => nastavPohled('sloupce'));
$('pohled-tabulka').addEventListener('click', () => nastavPohled('tabulka'));
$('nove').addEventListener('click', otevriFormular);
$('zrusit').addEventListener('click', () => $('dialog').close());
$('formular').addEventListener('submit', odesli);
nacti();
setInterval(() => { if (!document.hidden) nacti(); }, 60000);
`;
