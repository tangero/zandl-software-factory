// Běh brány ve workflow brana.yml. Pro každý dotčený PR:
// 1. zaznamená souhlas vlastníka (štítek `schvaleno`) s konkrétním commitem,
// 2. rozhodne podle pravidla.mjs a zapíše kontrolu „Brána“ na aktuální commit,
// 3. když je PR připravený, sloučí ho a samosloučený označí štítkem `samoslouceno`.

import fs from 'node:fs';
import { rozhodni, KONTROLA, STITEK, znackaSouhlasu } from './pravidla.mjs';
import { REPO, vytvorApi, nactiKonfiguraciZeSouboru, nactiVstup, otevrenePr } from './github.mjs';

const api = vytvorApi();
const udalost = process.env.GITHUB_EVENT_NAME;
const data = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
// Vypínač: proměnná repozitáře SAMOSLUCOVANI=vypnuto (Settings → Secrets and variables → Actions → Variables).
// Mění ji jen správce repozitáře, agent k ní přístup nemá.
const samoslucovaniZapnuto = (process.env.SAMOSLUCOVANI ?? '').trim().toLowerCase() !== 'vypnuto';
const ZNACKA_STAVU = '<!-- brana:stav -->';

const komentuj = (cislo, telo) => api(`repos/${REPO}/issues/${cislo}/comments`, { method: 'POST', body: { body: telo } });

// Jeden komentář se stavem brány na PR, který se přepisuje (žádný spam při každém běhu).
async function zapisStav(cislo, telo) {
  const { data: vsechny } = await api(`repos/${REPO}/issues/${cislo}/comments?per_page=100`);
  const stavajici = vsechny.find((k) => k.user?.login === 'github-actions[bot]' && k.body?.includes(ZNACKA_STAVU));
  const obsah = `${ZNACKA_STAVU}\n${telo}`;
  if (stavajici?.body === obsah) return;
  if (stavajici) await api(`repos/${REPO}/issues/comments/${stavajici.id}`, { method: 'PATCH', body: { body: obsah } });
  else await komentuj(cislo, obsah);
}

// Stav commitu „Brána“: success = smí se sloučit, pending = čeká, failure = zastaveno.
// Zapisuje se jen při změně, aby hodinový běh nezakládal stále nové stavy.
async function zapisKontrolu(vstup, verdikt) {
  const titulek = {
    sloucit: verdikt.zpusob === 'samoslouceni' ? 'Samosloučí se' : 'Schváleno vlastníkem',
    ceka: verdikt.potrebujeCloveka ? 'Čeká na vlastníka' : 'Čeká',
    blokovano: 'Zastaveno',
  }[verdikt.stav];
  const state = { sloucit: 'success', ceka: 'pending', blokovano: 'failure' }[verdikt.stav];
  const popis = `${titulek}: ${verdikt.duvody[0]}`.slice(0, 140);
  const posledni = vstup.stavyBrany.find((s) => s.autor === 'github-actions[bot]');
  if (posledni?.stav === state && posledni?.popis === popis) return;
  await api(`repos/${REPO}/statuses/${vstup.pr.hlava}`, {
    method: 'POST',
    body: {
      state,
      context: KONTROLA,
      description: popis,
      target_url: `${process.env.GITHUB_SERVER_URL}/${REPO}/actions/runs/${process.env.GITHUB_RUN_ID}`,
    },
  });
}

async function vyhodnotPr(cislo, konf) {
  const vstup = await nactiVstup(api, cislo);
  if (vstup.pr.stav !== 'open') return;
  const verdikt = rozhodni({ ...vstup, samoslucovaniZapnuto, ted: Date.now() }, konf);
  await zapisKontrolu(vstup, verdikt);
  console.log(`PR #${cislo}: ${verdikt.stav} – ${verdikt.duvody.join(' ')}`);

  if (verdikt.stav !== 'sloucit') {
    await zapisStav(cislo, `**Brána:** ${verdikt.duvody.join(' ')}`);
    return;
  }
  try {
    // SHA v požadavku: když mezitím přišel nový commit, GitHub sloučení odmítne.
    await api(`repos/${REPO}/pulls/${cislo}/merge`, {
      method: 'PUT',
      body: { sha: vstup.pr.hlava, merge_method: konf.zpusobSlouceni },
    });
  } catch (e) {
    // 405/409: ruleset nebo nový commit sloučení nepustil. Příště se vyhodnotí znovu.
    console.log(`PR #${cislo}: sloučení odmítnuto (${e.status}). ${e.message}`);
    await zapisStav(cislo, `**Brána:** PR je připravený, ale GitHub sloučení odmítl (${e.status}). Zkusím to při dalším běhu.`);
    return;
  }
  if (verdikt.zpusob === 'samoslouceni') {
    await api(`repos/${REPO}/issues/${cislo}/labels`, { method: 'POST', body: { labels: [STITEK.samoslouceno] } });
  }
  await zapisStav(cislo, `**Brána:** sloučeno (${verdikt.zpusob === 'samoslouceni' ? 'samosloučeno' : 'schváleno vlastníkem'}). Vrátit jde tlačítkem Revert.`);
}

async function main() {
  const konf = nactiKonfiguraciZeSouboru();
  let cisla = [];

  if (udalost === 'pull_request_target') {
    const pr = data.pull_request;
    if (data.action === 'labeled' && data.label?.name === STITEK.schvaleno) {
      if (konf.vlastnici.includes(data.sender?.login)) {
        await komentuj(pr.number, `Brána zaznamenala souhlas vlastníka s commitem ${pr.head.sha.slice(0, 7)}. Nový commit souhlas zruší.\n\n${znackaSouhlasu(pr.head.sha)}`);
      } else {
        await api(`repos/${REPO}/issues/${pr.number}/labels/${STITEK.schvaleno}`, { method: 'DELETE' }).catch(() => {});
        await komentuj(pr.number, `Štítek \`schvaleno\` smí přidat jen vlastník (${konf.vlastnici.join(', ')}). Přidal ho ${data.sender?.login}, brána ho odebrala.`);
      }
    }
    if (data.action === 'labeled' && data.label?.name === STITEK.samoslouceno && data.sender?.login !== 'github-actions[bot]') {
      await api(`repos/${REPO}/issues/${pr.number}/labels/${STITEK.samoslouceno}`, { method: 'DELETE' }).catch(() => {});
    }
    cisla = [pr.number];
  } else if (udalost === 'workflow_dispatch' && Number.isInteger(Number(data.inputs?.pr)) && Number(data.inputs.pr) > 0) {
    cisla = [Number(data.inputs.pr)];
  } else {
    cisla = await otevrenePr(api);
  }

  let chyba = false;
  for (const cislo of cisla) {
    try {
      await vyhodnotPr(cislo, konf);
    } catch (e) {
      chyba = true;
      console.error(`PR #${cislo}: ${e.message}`);
    }
  }
  if (chyba) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
