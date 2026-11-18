// Rozhodování brány sloučení. Čisté funkce bez síťových volání: vstupem jsou data PR načtená
// z GitHub API (github.mjs), výstupem verdikt. Díky tomu se dají otestovat bez GitHubu.

export const STITEK = { schvaleno: 'schvaleno', samoslouceno: 'samoslouceno', stop: 'stop' };
export const KONTROLA = 'Brána';
export const AUTOMATIKA = 'github-actions[bot]';
export const ZNACKA_REVIEW = '<!-- brana:review -->';
export const znackaSouhlasu = (sha) => `<!-- brana:souhlas sha=${sha} -->`;

// --- Konfigurace -----------------------------------------------------------------------------

export function nactiKonfiguraci(text) {
  const bezKomentaru = text
    .split('\n')
    .filter((radek) => !radek.trimStart().startsWith('//'))
    .join('\n');
  const k = JSON.parse(bezKomentaru);
  const chyby = [];
  if (!Array.isArray(k.vlastnici) || k.vlastnici.length === 0) chyby.push('vlastnici: chybí aspoň jeden účet');
  if (k.vlastnici?.some((v) => v === 'VAS-GITHUB-LOGIN')) chyby.push('vlastnici: nahraďte VAS-GITHUB-LOGIN svým loginem');
  if (!Array.isArray(k.vratne)) chyby.push('vratne: musí být seznam skupin');
  for (const s of k.vratne ?? []) {
    if (!Array.isArray(s.cesty) || typeof s.lhutaHodin !== 'number' || s.lhutaHodin < 0) {
      chyby.push(`vratne: skupina ${JSON.stringify(s)} potřebuje "cesty" a nezápornou "lhutaHodin"`);
    }
  }
  if (!Array.isArray(k.nevratne)) chyby.push('nevratne: musí být seznam cest');
  if (typeof k.maxRadku !== 'number') chyby.push('maxRadku: musí být číslo');
  if (!Array.isArray(k.pozadovaneKontroly)) chyby.push('pozadovaneKontroly: musí být seznam');
  if (!['squash', 'merge', 'rebase'].includes(k.zpusobSlouceni)) chyby.push('zpusobSlouceni: squash, merge nebo rebase');
  if (chyby.length) throw new Error(`Chybná pravidla brány:\n- ${chyby.join('\n- ')}`);
  return k;
}

// --- Cesty -----------------------------------------------------------------------------------

export function globNaRegex(vzor) {
  let r = '';
  for (let i = 0; i < vzor.length; i++) {
    const z = vzor[i];
    if (z === '*' && vzor[i + 1] === '*') {
      i++;
      if (vzor[i + 1] === '/') {
        i++;
        r += '(?:.*/)?'; // `**/` = žádná nebo libovolně mnoho složek
      } else {
        r += '.*';
      }
    } else if (z === '*') {
      r += '[^/]*';
    } else if (z === '?') {
      r += '[^/]';
    } else {
      r += z.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${r}$`);
}

export const odpovida = (cesta, vzor) => globNaRegex(vzor).test(cesta);

// Vrací lhůtu v hodinách pro vratnou cestu, nebo null pro nevratnou.
export function lhutaCesty(cesta, konf) {
  if (konf.nevratne.some((v) => odpovida(cesta, v))) return null;
  const lhuty = konf.vratne.filter((s) => s.cesty.some((v) => odpovida(cesta, v))).map((s) => s.lhutaHodin);
  return lhuty.length ? Math.max(...lhuty) : null;
}

// soubory: [{ cesta, puvodniCesta?, radku }]; uplny = false, když API nevrátilo všechny soubory.
export function zaradZmenu(soubory, konf, uplny) {
  const nevratne = [];
  let lhutaHodin = 0;
  let radku = 0;
  for (const s of soubory) {
    radku += s.radku;
    // U přejmenování musí být vratná stará i nová cesta: přesun z .github/ ven je také zásah do .github/.
    for (const cesta of [s.cesta, s.puvodniCesta].filter(Boolean)) {
      const l = lhutaCesty(cesta, konf);
      if (l === null) nevratne.push(cesta);
      else lhutaHodin = Math.max(lhutaHodin, l);
    }
  }
  if (!uplny) nevratne.push('(seznam změněných souborů není úplný)');
  if (soubory.length === 0) nevratne.push('(PR nemění žádný soubor)');
  return { nevratne: [...new Set(nevratne)], lhutaHodin, radku };
}

// --- Štítky ----------------------------------------------------------------------------------

// Stop platí, dokud ho neodebere ten, kdo ho přidal, nebo vlastník. Odebrání kýmkoli jiným se nepočítá.
// udalosti: [{ typ: "labeled"|"unlabeled", stitek, akter, kdy }] seřazené od nejstarší.
export function aktivniStop(udalosti, stitky, vlastnici) {
  if (stitky.includes(STITEK.stop)) return { aktivni: true, duvod: 'PR má štítek `stop`.' };
  let pridal = null;
  let aktivni = false;
  for (const u of udalosti.filter((u) => u.stitek === STITEK.stop)) {
    if (u.typ === 'labeled') {
      pridal = u.akter;
      aktivni = true;
    } else if (u.typ === 'unlabeled' && aktivni) {
      if (u.akter === pridal || vlastnici.includes(u.akter)) aktivni = false;
    }
  }
  return aktivni
    ? { aktivni: true, duvod: `Štítek \`stop\` odebral někdo jiný než ten, kdo ho přidal (${pridal}), nebo vlastník; platí dál.` }
    : { aktivni: false };
}

// Souhlas platí jen pro commit, na který ho brána zaznamenala (komentář automatiky se SHA),
// a jen dokud štítek `schvaleno` na PR je. Nový push tedy souhlas zruší.
export function platnySouhlas(stitky, komentare, hlava) {
  if (!stitky.includes(STITEK.schvaleno)) return false;
  return komentare.some((k) => k.autor === AUTOMATIKA && k.telo.includes(znackaSouhlasu(hlava)));
}

// --- Review ----------------------------------------------------------------------------------

// Review platí jen od automatiky (workflow z hlavní větve), se značkou a pro aktuální commit.
// Verdikt, který nejde přečíst, se počítá jako „vyžaduje člověka“.
export function precistReview(komentare, hlava) {
  const platne = komentare.filter((k) => {
    if (k.autor !== AUTOMATIKA || !k.telo.includes(ZNACKA_REVIEW)) return false;
    const m = k.telo.match(/^Commit:\s*([0-9a-f]{7,40})\s*$/m);
    return Boolean(m) && hlava.startsWith(m[1]);
  });
  if (platne.length === 0) return { stav: 'chybi' };
  const telo = platne[platne.length - 1].telo;
  const verdikt = telo.match(/^Verdikt:\s*(.+?)\s*$/m)?.[1]?.toLowerCase() ?? '';
  const zarazeni = telo.match(/^Zařazení:\s*(.+?)\s*$/m)?.[1]?.toLowerCase() ?? '';
  if (verdikt === 'vážné nálezy') return { stav: 'nalezy' };
  if (verdikt !== 'bez vážných nálezů') return { stav: 'clovek', duvod: `verdikt „${verdikt || 'chybí'}“` };
  if (zarazeni !== 'vratné') return { stav: 'clovek', duvod: 'review změnu zařadilo jako nevratnou' };
  return { stav: 'bez-nalezu' };
}

// --- Kontroly CI -----------------------------------------------------------------------------

// runy: poslední běh každé kontroly na aktuálním commitu [{ nazev, stav, zaver }].
export function stavKontrol(runy, pozadovane) {
  const vysledek = { chybi: [], bezi: [], selhaly: [] };
  for (const nazev of pozadovane) {
    const run = runy.find((r) => r.nazev === nazev);
    if (!run) vysledek.chybi.push(nazev);
    else if (run.stav !== 'completed') vysledek.bezi.push(nazev);
    else if (!['success', 'skipped'].includes(run.zaver)) vysledek.selhaly.push(nazev);
  }
  return vysledek;
}

// Lhůta běží od prvního stavu „Brána“, který automatika zapsala na tento commit. Čas zapisuje GitHub,
// ne autor commitu, takže ho nejde posunout falešným datem commitu.
// stavyBrany: stavy commitu [{ kontext, autor, kdy }].
export function zacatekLhuty(stavyBrany) {
  const casy = stavyBrany
    .filter((s) => s.kontext === KONTROLA && s.autor === AUTOMATIKA && s.kdy)
    .map((s) => Date.parse(s.kdy));
  return casy.length ? Math.min(...casy) : null;
}

// --- Rozhodnutí ------------------------------------------------------------------------------

/**
 * @returns {{ stav: 'sloucit'|'ceka'|'blokovano'|'mimo', zpusob?: 'schvaleni'|'samoslouceni',
 *   duvody: string[], potrebujeCloveka?: boolean, sloucitPo?: number }}
 */
export function rozhodni(v, konf) {
  if (v.pr.stav !== 'open') return { stav: 'mimo', duvody: ['PR není otevřený.'] };

  const stop = aktivniStop(v.udalosti, v.stitky, konf.vlastnici);
  if (stop.aktivni) return { stav: 'blokovano', duvody: [stop.duvod], potrebujeCloveka: true };

  if (v.pr.rozpracovany) return { stav: 'ceka', duvody: ['PR je rozpracovaný (draft).'] };

  const ci = stavKontrol(v.kontroly, konf.pozadovaneKontroly);
  if (ci.selhaly.length) return { stav: 'blokovano', duvody: [`Neprošly kontroly: ${ci.selhaly.join(', ')}.`] };
  if (ci.bezi.length || ci.chybi.length) {
    return { stav: 'ceka', duvody: [`Čeká na kontroly: ${[...ci.bezi, ...ci.chybi].join(', ')}.`] };
  }

  if (platnySouhlas(v.stitky, v.komentare, v.pr.hlava)) {
    return { stav: 'sloucit', zpusob: 'schvaleni', duvody: ['Vlastník schválil tento commit.'] };
  }

  const staryStitek = v.stitky.includes(STITEK.schvaleno);
  const clovek = (duvod) => ({
    stav: 'ceka',
    duvody: [
      duvod,
      staryStitek
        ? 'Štítek `schvaleno` platil pro starší commit. Po kontrole nové verze ho vlastník odebere a přidá znovu.'
        : 'Sloučí se po štítku `schvaleno` od vlastníka.',
    ],
    potrebujeCloveka: true,
  });

  if (!v.samoslucovaniZapnuto) return clovek('Samoslučování je vypnuté (proměnná SAMOSLUCOVANI).');

  const zmena = zaradZmenu(v.soubory, konf, v.souboryUplne);
  if (zmena.nevratne.length) return clovek(`Nevratné změny: ${zmena.nevratne.join(', ')}.`);
  if (zmena.radku > konf.maxRadku) return clovek(`Změna má ${zmena.radku} řádků, limit pro samosloučení je ${konf.maxRadku}.`);

  const review = precistReview(v.komentare, v.pr.hlava);
  if (review.stav === 'chybi') return { stav: 'ceka', duvody: ['Čeká na review druhým modelem pro tento commit.'] };
  if (review.stav === 'nalezy') {
    return { stav: 'ceka', duvody: ['Review má vážné nálezy. Agent je opraví, nebo vlastník přidá `schvaleno`.'] };
  }
  if (review.stav === 'clovek') return clovek(`Review: ${review.duvod}.`);

  const zacatek = zacatekLhuty(v.stavyBrany) ?? v.ted;
  const sloucitPo = zacatek + zmena.lhutaHodin * 3600_000;
  if (v.ted < sloucitPo) {
    return {
      stav: 'ceka',
      duvody: [`Samosloučí se po ${new Date(sloucitPo).toISOString()}, pokud nikdo nepřidá \`stop\`.`],
      sloucitPo,
    };
  }
  return { stav: 'sloucit', zpusob: 'samoslouceni', duvody: ['Vratná změna, review bez vážných nálezů, lhůta uplynula.'] };
}
