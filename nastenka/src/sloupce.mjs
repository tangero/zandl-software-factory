// Sloupce nástěnky. Čisté funkce bez síťových volání a bez databáze: vstupem jsou položky
// (issues a PR) jednoho repozitáře tak, jak je uložila synchronizace, výstupem karty se sloupcem.
// Sloupec se nikdy neukládá, počítá se při každém čtení.

export const SLOUPCE = [
  { id: 'ceka', nazev: 'Čeká na vás' },
  { id: 'samo', nazev: 'Sloučí se samo' },
  { id: 'kontrola', nazev: 'Kontroluje se' },
  { id: 'pracuje', nazev: 'Agent pracuje' },
  { id: 'zadano', nazev: 'Zadáno' },
  { id: 'navrhy', nazev: 'Návrhy' },
  { id: 'hotovo', nazev: 'Hotovo' },
  { id: 'zamitnuto', nazev: 'Zamítnuto' },
];

// Jak dlouho zůstávají uzavřené karty na nástěnce.
export const DNI_HOTOVO = 14;

// Brána zapisuje jako aplikace GitHub Actions. REST vrací login s příponou [bot], GraphQL bez ní.
export const jeAutomatika = (login) => login === 'github-actions[bot]' || login === 'github-actions';

// --- Čtení výstupu brány ---------------------------------------------------------------------------

// Strojově čitelný verdikt z komentáře brány (`<!-- brana:verdikt {...} -->`), viz .github/brana/pravidla.mjs.
export function prectiZnackuVerdiktu(telo) {
  const shoda = /<!-- brana:verdikt (\{.*?\}) -->/s.exec(telo ?? '');
  if (!shoda) return null;
  try {
    const data = JSON.parse(shoda[1]);
    return {
      stav: data.stav ?? null,
      zpusob: data.zpusob ?? null,
      potrebujeCloveka: Boolean(data.potrebujeCloveka),
      sloucitPo: data.sloucitPo ? Date.parse(data.sloucitPo) : null,
      hlava: data.hlava ?? null,
    };
  } catch {
    return null;
  }
}

// Záloha pro repozitáře se starší kopií brány, která verdikt do komentáře nepíše:
// stejné údaje vyčte z popisu stavu commitu „Brána“ (text pro lidi, viz popisKontroly v pravidla.mjs).
export function prectiPopisBrany(popis) {
  const text = popis ?? '';
  const cas = /Samosloučí se po (\d{4}-\d\d-\d\dT[\d:.]+Z)/.exec(text);
  return {
    potrebujeCloveka: text.startsWith('Čeká na vlastníka') || text.startsWith('Zastaveno'),
    sloucitPo: cas ? Date.parse(cas[1]) : null,
  };
}

// Stav brány pro aktuální commit PR. `status` = poslední stav commitu „Brána“ od automatiky,
// `verdikt` = značka z komentáře brány. Značka platí jen pro stejný commit; jinak se použije popis.
export function stavBrany(status, verdikt, hlava) {
  if (!status) return null;
  const zPopisu = prectiPopisBrany(status.popis);
  const platnyVerdikt = verdikt && verdikt.hlava === hlava ? verdikt : null;
  return {
    stav: status.stav, // success | pending | failure | error
    popis: status.popis ?? '',
    potrebujeCloveka: platnyVerdikt ? platnyVerdikt.potrebujeCloveka : zPopisu.potrebujeCloveka,
    sloucitPo: platnyVerdikt ? platnyVerdikt.sloucitPo : zPopisu.sloucitPo,
    zpusob: platnyVerdikt?.zpusob ?? null,
  };
}

// --- Spojení issue a PR do karty -------------------------------------------------------------------

// Číslo zadání, ke kterému PR patří: větev `zadani/<číslo>-…` (AGENTS.md), jinak issue, které PR
// uzavírá (Fixes #N), pokud je jediné.
export function cisloZadani(pr) {
  const zVetve = /^zadani\/(\d+)(?:-|$)/.exec(pr.vetev ?? '');
  if (zVetve) return Number(zVetve[1]);
  const uzavira = pr.uzaviraIssues ?? [];
  return uzavira.length === 1 ? uzavira[0] : null;
}

const poradiPr = (pr) => (pr.stav === 'open' ? 2 : pr.merged ? 1 : 0);

// Ze všech položek repozitáře sestaví karty. Issue a jeho PR jsou jedna karta; PR bez zadání má
// kartu vlastní. Když k zadání patří víc PR, platí otevřený, jinak sloučený, jinak poslední zavřený.
export function sestavKarty(polozky) {
  const issues = new Map();
  const prPodleIssue = new Map();
  const samostatnePr = [];
  for (const p of polozky) if (p.druh === 'issue') issues.set(p.cislo, p);
  for (const p of polozky) {
    if (p.druh !== 'pr') continue;
    const cislo = cisloZadani(p);
    if (cislo !== null && issues.has(cislo)) {
      const dosavadni = prPodleIssue.get(cislo);
      if (!dosavadni || poradiPr(p) > poradiPr(dosavadni) || (poradiPr(p) === poradiPr(dosavadni) && p.upraveno > dosavadni.upraveno)) {
        prPodleIssue.set(cislo, p);
      }
    } else {
      samostatnePr.push(p);
    }
  }
  return [
    ...[...issues.values()].map((issue) => ({ issue, pr: prPodleIssue.get(issue.cislo) ?? null })),
    ...samostatnePr.map((pr) => ({ issue: null, pr })),
  ];
}

// --- Sloupec ---------------------------------------------------------------------------------------

const maStitek = (polozka, nazev) => Boolean(polozka?.stitky?.includes(nazev));
const cas = (iso) => (iso ? Date.parse(iso) : null);

/**
 * Určí sloupec karty. Pořadí pravidel odpovídá specifikaci: první platné vyhrává.
 * @returns {{ sloupec: string, duvod: string, sloucitPo?: number|null, uzavreno?: number|null } | null}
 *   null = karta na nástěnku nepatří (issue bez štítku zadání, uzavřené dávno).
 */
export function urciSloupec({ issue, pr }, ted = Date.now()) {
  const otevrenePr = pr?.stav === 'open';
  const otevreneIssue = issue?.stav === 'open';

  // Uzavřené karty: sloučený PR = Hotovo (i když zadání zůstalo otevřené), zavřený bez sloučení
  // nebo zamítnuté zadání = Zamítnuto. Otevřené zadání se zavřeným nesloučeným PR jde dál jako Zadáno.
  if (!otevrenePr && !(otevreneIssue && !pr?.merged)) {
    const zadaniNaNastence = issue && ['zadani', 'navrh', 'otazka', 'zamitnuto'].some((s) => maStitek(issue, s));
    if (!pr && !zadaniNaNastence) return null;
    let vysledek;
    if (pr?.merged) {
      const jak = maStitek(pr, 'samoslouceno') ? 'samosloučeno' : maStitek(pr, 'schvaleno') ? 'schváleno vlastníkem' : 'sloučeno';
      vysledek = { sloupec: 'hotovo', duvod: jak, uzavreno: cas(pr.uzavreno) };
    } else if (maStitek(issue, 'zamitnuto') || issue?.duvodUzavreni === 'not_planned' || (pr && !pr.merged)) {
      vysledek = { sloupec: 'zamitnuto', duvod: maStitek(issue, 'zamitnuto') ? 'zadání zamítnuto' : 'zavřeno bez sloučení', uzavreno: cas(issue?.uzavreno ?? pr?.uzavreno) };
    } else {
      vysledek = { sloupec: 'hotovo', duvod: 'zadání uzavřeno', uzavreno: cas(issue?.uzavreno) };
    }
    if (vysledek.uzavreno && ted - vysledek.uzavreno > DNI_HOTOVO * 86_400_000) return null;
    return vysledek;
  }

  // 1. Čeká na vás
  if (maStitek(issue, 'otazka')) return { sloupec: 'ceka', duvod: 'agent se ptá (štítek otazka)' };
  if (otevrenePr && maStitek(pr, 'stop')) return { sloupec: 'ceka', duvod: 'zastaveno štítkem stop' };

  if (otevrenePr) {
    const brana = pr.brana;
    if (brana) {
      if (brana.stav === 'failure' || brana.stav === 'error') return { sloupec: 'ceka', duvod: brana.popis || 'brána zastavila PR' };
      if (brana.stav === 'pending' && brana.potrebujeCloveka) return { sloupec: 'ceka', duvod: brana.popis || 'čeká na vlastníka' };
      // 4. Sloučí se samo
      if (brana.stav === 'success') return { sloupec: 'samo', duvod: 'brána sloučí při dalším běhu', sloucitPo: brana.sloucitPo };
      if (brana.stav === 'pending' && brana.sloucitPo) return { sloupec: 'samo', duvod: 'běží lhůta, stop ji zastaví', sloucitPo: brana.sloucitPo };
      // 6. Agent pracuje (draft má u brány stav pending bez potřeby člověka)
      if (pr.draft) return { sloupec: 'pracuje', duvod: 'PR je rozpracovaný (draft)' };
      // 5. Kontroluje se
      return { sloupec: 'kontrola', duvod: brana.popis || 'brána čeká' };
    }
    // Repozitář bez brány: sloupec jen z PR, kontrol a review.
    if (pr.draft) return { sloupec: 'pracuje', duvod: 'PR je rozpracovaný (draft)' };
    if (pr.kontroly === 'failure') return { sloupec: 'ceka', duvod: 'neprošly kontroly' };
    if (pr.review === 'CHANGES_REQUESTED') return { sloupec: 'ceka', duvod: 'review požaduje změny' };
    if (pr.kontroly === 'pending') return { sloupec: 'kontrola', duvod: 'běží kontroly' };
    return { sloupec: 'ceka', duvod: 'připraveno ke sloučení' };
  }

  // Jen issue bez PR.
  if (maStitek(issue, 'zadani')) return { sloupec: 'zadano', duvod: 'čeká, až si ho agent vezme' };
  if (maStitek(issue, 'navrh')) return { sloupec: 'navrhy', duvod: 'čeká na štítek zadani' };
  return null;
}

// Karty všech repozitářů se sloupcem, seřazené od posledně upravené.
export function kartyNastenky(repozitare, ted = Date.now()) {
  const vysledek = [];
  for (const { repo, polozky } of repozitare) {
    for (const karta of sestavKarty(polozky)) {
      const sloupec = urciSloupec(karta, ted);
      if (!sloupec) continue;
      const { issue, pr } = karta;
      const hlavni = issue ?? pr;
      vysledek.push({
        klic: `${repo}#${hlavni.cislo}`,
        repo,
        titulek: hlavni.titulek,
        url: hlavni.url,
        issue: issue ? { cislo: issue.cislo, url: issue.url, stitky: issue.stitky } : null,
        pr: pr ? { cislo: pr.cislo, url: pr.url, draft: pr.draft, stitky: pr.stitky } : null,
        upraveno: [issue?.upraveno, pr?.upraveno].filter(Boolean).sort().at(-1) ?? null,
        ...sloupec,
      });
    }
  }
  return vysledek.sort((a, b) => (b.upraveno ?? '').localeCompare(a.upraveno ?? ''));
}
