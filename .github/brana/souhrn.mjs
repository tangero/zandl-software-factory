// Týdenní souhrn (workflow souhrn.yml): co se za posledních 7 dní samosloučilo, co schválil vlastník,
// kde někdo zastavil práci a co se vracelo. Založí issue, které vlastník projde. Jedna náhodně vybraná
// samosloučená změna je k přečtení celá: když souhrn týdny nikdo nečte, nula vet nic neznamená.

import { STITEK } from './pravidla.mjs';
import { REPO, vytvorApi, vsechny } from './github.mjs';

export function tydenIso(datum) {
  const d = new Date(Date.UTC(datum.getUTCFullYear(), datum.getUTCMonth(), datum.getUTCDate()));
  const den = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - den);
  const zacatekRoku = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const tyden = Math.ceil(((d - zacatekRoku) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-T${String(tyden).padStart(2, '0')}`;
}

const odkaz = (p) => `- #${p.number} ${p.title}`;

export function sestavSouhrn({ samo, schvalene, vety, reverty, cekajici, nahodny, tyden }) {
  return [
    `Souhrn za týden ${tyden}. Zaškrtněte, co jste prošli; čísla do tabulky dole doplňte ručně.`,
    '',
    `## Samosloučeno (${samo.length})`,
    ...(samo.length ? samo.map(odkaz) : ['- nic']),
    '',
    `## Schváleno vlastníkem (${schvalene.length})`,
    ...(schvalene.length ? schvalene.map(odkaz) : ['- nic']),
    '',
    `## Zastaveno štítkem \`stop\` (${vety.length})`,
    ...(vety.length ? vety.map(odkaz) : ['- nic']),
    '',
    `## Vráceno revertem (${reverty.length})`,
    ...(reverty.length ? reverty.map(odkaz) : ['- nic']),
    '',
    `## Otevřené PR (${cekajici.length}), u kterých brána může čekat na vás`,
    ...(cekajici.length ? cekajici.map(odkaz) : ['- nic']),
    '',
    '## K přečtení celé',
    nahodny
      ? `- [ ] #${nahodny.number} ${nahodny.title}: náhodně vybraná samosloučená změna. Projděte diff a napište sem, zda byste ji schválili.`
      : '- tento týden se nic nesamosloučilo',
    '',
    '## Měření (doplňte ručně)',
    '',
    '| ukazatel | tento týden | poznámka |',
    '|---|---|---|',
    '| Můj čas na projektu (hodiny) | | |',
    '| Nápady agenta bez mého podnětu | | |',
    '| Chyby, které prošly do produkce | | |',
    '| Cena za hotový výsledek (Kč za sloučený PR) | | |',
  ].join('\n');
}

async function main() {
  const api = vytvorApi();
  const ted = new Date();
  const od = new Date(ted.getTime() - 7 * 86400000).toISOString().slice(0, 10);
  const hledej = (q) => vsechny(api, `search/issues?q=${encodeURIComponent(`repo:${REPO} is:pr ${q}`)}`, 'items');

  const sloucene = await hledej(`is:merged merged:>=${od}`);
  const samo = sloucene.filter((p) => p.labels.some((l) => l.name === STITEK.samoslouceno));
  const schvalene = sloucene.filter((p) => !samo.includes(p));
  const reverty = sloucene.filter((p) => /^revert/i.test(p.title));
  const cekajici = await hledej('is:open -is:draft');

  const vety = [];
  for (const p of await hledej(`updated:>=${od}`)) {
    const udalosti = await vsechny(api, `repos/${REPO}/issues/${p.number}/events`);
    if (udalosti.some((u) => u.event === 'labeled' && u.label?.name === STITEK.stop && u.created_at >= od)) vety.push(p);
  }

  const nahodny = samo.length ? samo[Math.floor(Math.random() * samo.length)] : null;
  const tyden = tydenIso(ted);
  await api(`repos/${REPO}/issues`, {
    method: 'POST',
    body: {
      title: `Týdenní souhrn ${tyden}`,
      body: sestavSouhrn({ samo, schvalene, vety, reverty, cekajici, nahodny, tyden }),
      labels: ['souhrn'],
    },
  });
  console.log(`Souhrn ${tyden}: ${samo.length} samosloučeno, ${schvalene.length} schváleno, ${vety.length} vet, ${reverty.length} revertů.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
