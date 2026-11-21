#!/usr/bin/env node
// Průvodce nastavením. Spusťte v kořeni svého repozitáře se zkopírovanou sadou:
//   node nastaveni/onboarding.mjs
//
// Projde vás kroky, které jdou udělat z příkazové řádky (vlastník, štítky, ruleset, review),
// a na GitHubu založí issue „Začínáme“ se zbytkem, který se nastavuje ručně.
//
// Bez otázek (pro skripty a testy):
//   node nastaveni/onboarding.mjs --ano [--vlastnik LOGIN]
//     [--review-url URL --review-model MODEL | --review-rezim claude-cli [--review-model MODEL] | --bez-review]
// Klíč k API ani token předplatného se nikdy nepředává parametrem: zadáte ho do skrytého vstupu `gh secret set`.

import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

const PRAVIDLA = '.github/pravidla.jsonc';
const NAZEV_RULESETU = 'Ochrana hlavní větve';

// Adresy endpointů kompatibilních s OpenAI Chat Completions. Název modelu se zadává ručně,
// protože se mění rychleji než tento soubor.
const RECENZENTI = [
  { nazev: 'OpenAI', url: 'https://api.openai.com/v1/chat/completions' },
  { nazev: 'xAI (Grok)', url: 'https://api.x.ai/v1/chat/completions' },
  { nazev: 'Moonshot (Kimi)', url: 'https://api.moonshot.ai/v1/chat/completions' },
  { nazev: 'Mistral', url: 'https://api.mistral.ai/v1/chat/completions' },
  { nazev: 'DeepSeek', url: 'https://api.deepseek.com/chat/completions' },
  { nazev: 'OpenRouter (modely různých výrobců)', url: 'https://openrouter.ai/api/v1/chat/completions' },
];

const argumenty = process.argv.slice(2);
const prepinac = (n) => argumenty.includes(n);
const hodnota = (n) => {
  const i = argumenty.indexOf(n);
  return i >= 0 ? argumenty[i + 1] : undefined;
};
const bezOtazek = prepinac('--ano');

const rl = bezOtazek ? null : readline.createInterface({ input: stdin, output: stdout });
async function zeptej(otazka, vychozi = '') {
  if (bezOtazek) return vychozi;
  const odpoved = (await rl.question(vychozi ? `${otazka} [${vychozi}]: ` : `${otazka}: `)).trim();
  return odpoved || vychozi;
}
async function potvrd(otazka, vychozi = true) {
  if (bezOtazek) return vychozi;
  const o = (await rl.question(`${otazka} ${vychozi ? '[A/n]' : '[a/N]'}: `)).trim().toLowerCase();
  return o === '' ? vychozi : ['a', 'ano', 'y', 'yes'].includes(o);
}

const sh = (prikaz, args, volby = {}) => execFileSync(prikaz, args, { encoding: 'utf8', ...volby }).trim();
const zkus = (prikaz, args) => spawnSync(prikaz, args, { encoding: 'utf8' });
const krok = (n, text) => console.log(`\n\x1b[1m${n}. ${text}\x1b[0m`);
const ok = (text) => console.log(`   ✓ ${text}`);
const pozor = (text) => console.log(`   ! ${text}`);

function konec(text) {
  console.error(`\n✗ ${text}`);
  rl?.close();
  process.exit(1);
}

// --- 0. Kontrola prostředí ----------------------------------------------------------------------

function zkontrolujProstredi() {
  krok(0, 'Kontrola prostředí');
  if (zkus('gh', ['--version']).status !== 0) konec('Chybí GitHub CLI (gh). Instalace: https://cli.github.com');
  const stav = zkus('gh', ['auth', 'status']);
  if (stav.status !== 0) konec('gh není přihlášené. Spusťte `gh auth login`.');
  const vystup = `${stav.stdout}${stav.stderr}`;
  if (!/workflow/.test(vystup)) {
    konec('Token gh nemá oprávnění „workflow“ (bez něj nejde nahrát soubory z .github/workflows).\n  Spusťte `gh auth refresh -s workflow`.');
  }
  if (zkus('git', ['rev-parse', '--is-inside-work-tree']).status !== 0) konec('Spusťte průvodce v kořeni repozitáře.');
  if (!fs.existsSync(PRAVIDLA)) konec(`Chybí ${PRAVIDLA}. Zkopírovali jste do repozitáře celou sadu?`);
  const repo = sh('gh', ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner']);
  // Prázdný repozitář ještě hlavní větev nemá.
  const vetev = sh('gh', ['repo', 'view', '--json', 'defaultBranchRef', '--jq', '.defaultBranchRef.name // ""']) || 'main';
  const prihlaseny = sh('gh', ['api', 'user', '--jq', '.login']);
  ok(`repozitář ${repo}, hlavní větev ${vetev}, přihlášen ${prihlaseny}`);
  return { repo, vetev, prihlaseny };
}

function rulesetExistuje(repo) {
  const r = zkus('gh', ['api', `repos/${repo}/rulesets`, '--jq', '.[].name']);
  return r.status === 0 && r.stdout.split('\n').includes(NAZEV_RULESETU);
}

// --- 1. Vlastník --------------------------------------------------------------------------------

export function nastavVlastniky(text, vlastnici) {
  const seznam = JSON.stringify(vlastnici);
  const nove = text.replace(/"vlastnici":\s*\[[^\]]*\]/, `"vlastnici": ${seznam}`);
  if (nove === text && !text.includes(`"vlastnici": ${seznam}`)) throw new Error('V pravidlech chybí položka "vlastnici".');
  return nove;
}

async function krokVlastnik(prostredi) {
  krok(1, 'Vlastník: kdo smí schvalovat a zastavovat');
  console.log('   Štítek `schvaleno` brána uzná jen od těchto účtů. Agent mezi nimi být nesmí.');
  const zadano = hodnota('--vlastnik') ?? (await zeptej('   GitHub login vlastníka (víc účtů oddělte čárkou)', prostredi.prihlaseny));
  const vlastnici = zadano.split(',').map((s) => s.trim()).filter(Boolean);
  const text = fs.readFileSync(PRAVIDLA, 'utf8');
  const nove = nastavVlastniky(text, vlastnici);
  fs.writeFileSync(PRAVIDLA, nove);
  ok(`vlastníci: ${vlastnici.join(', ')}`);

  console.log('\n   Vratné cesty (samosloučí se po lhůtě), výchozí nastavení:');
  for (const radek of nove.split('\n').filter((r) => /"cesty"/.test(r))) console.log(`     ${radek.trim()}`);
  if (!(await potvrd('   Ponechat výchozí vratné cesty? (upravit je můžete i později přes PR)'))) {
    await zeptej(`   Upravte ${PRAVIDLA} v editoru, uložte a stiskněte Enter`);
  }
  return nove !== text || zkus('git', ['diff', '--quiet', '--', PRAVIDLA]).status !== 0;
}

// --- 2. Nahrání ----------------------------------------------------------------------------------

async function krokNahrani(prostredi, zmeneno) {
  krok(2, 'Nahrání pravidel do repozitáře');
  const neodeslano = zkus('git', ['status', '--porcelain']).stdout.trim();
  const ahead = zkus('git', ['rev-list', '--count', `origin/${prostredi.vetev}..HEAD`]);
  if (!zmeneno && !neodeslano && ahead.status === 0 && ahead.stdout.trim() === '0') {
    ok('vše je nahrané');
    return;
  }
  if (rulesetExistuje(prostredi.repo)) {
    pozor('Hlavní větev už je zamčená. Změny nahrajte přes PR a přidejte k němu štítek `schvaleno`:');
    console.log(`     git switch -c nastaveni/vlastnik && git commit -am "Vlastník v pravidlech brány" && gh pr create --fill`);
    return;
  }
  if (!(await potvrd('   Commitnout a pushnout sadu do hlavní větve teď, před jejím zamčením?'))) {
    pozor('Přeskočeno. Bez nahrání brána na GitHubu nepoběží.');
    return;
  }
  sh('git', ['add', '--', '.github', 'nastaveni', 'MANIFEST.md', 'AGENTS.md', 'CLAUDE.md'].filter((p) => p === 'add' || p === '--' || fs.existsSync(p)));
  if (zkus('git', ['diff', '--cached', '--quiet']).status !== 0) {
    sh('git', ['commit', '-m', 'Brána sloučení: startovací sada']);
  }
  sh('git', ['push', 'origin', `HEAD:${prostredi.vetev}`], { stdio: 'pipe' });
  ok('nahráno');
}

// --- 3. Štítky a ruleset --------------------------------------------------------------------------

function krokZamceni(prostredi) {
  krok(3, 'Štítky, zamčení hlavní větve a oprávnění workflow');
  const r = spawnSync('bash', [path.join('nastaveni', 'nastav.sh'), prostredi.repo], { encoding: 'utf8' });
  for (const radek of `${r.stdout}${r.stderr}`.split('\n').filter(Boolean)) console.log(`     ${radek}`);
  if (r.status !== 0) {
    if (/Upgrade|403|not available/i.test(`${r.stdout}${r.stderr}`)) {
      pozor('GitHub ruleset odmítl. U soukromých repozitářů na bezplatném účtu rulesety nefungují:');
      pozor('repozitář zveřejněte, nebo použijte GitHub Pro/Team. Bez rulesetu brána nic nezamyká.');
    }
    konec('Nastavení štítků a rulesetu selhalo, viz výpis výše.');
  }
  ok('štítky, ruleset a oprávnění nastavená');
}

// --- 4. Review ----------------------------------------------------------------------------------

async function krokReview(prostredi) {
  krok(4, 'Review druhým modelem');
  console.log('   Kdo kód píše, ten ho nekontroluje. Zvolte model od JINÉHO výrobce, než používá váš agent.');
  if (prepinac('--bez-review')) {
    pozor('Přeskočeno (--bez-review). Bez review se nic nesamosloučí, jen PR se `schvaleno`.');
    return false;
  }
  if (hodnota('--review-rezim') === 'claude-cli') return krokReviewClaude(prostredi);
  let url = hodnota('--review-url');
  let model = hodnota('--review-model');
  if (!url) {
    RECENZENTI.forEach((r, i) => console.log(`     ${i + 1}) ${r.nazev}`));
    console.log(`     ${RECENZENTI.length + 1}) jiný (zadám adresu)`);
    console.log(`     ${RECENZENTI.length + 2}) Claude přes předplatné Pro/Max (bez klíče k API; agent pak nesmí být Claude)`);
    console.log(`     0) teď ne`);
    const volba = Number(await zeptej('   Volba', '0'));
    if (!volba) {
      pozor('Přeskočeno. Doplníte později: README, „Review druhým modelem“.');
      return false;
    }
    if (volba === RECENZENTI.length + 2) return krokReviewClaude(prostredi);
    url = volba <= RECENZENTI.length ? RECENZENTI[volba - 1].url : await zeptej('   Adresa endpointu …/chat/completions');
  }
  if (!model) model = await zeptej('   Název modelu (přesně podle dokumentace výrobce)');
  if (!url || !model) {
    pozor('Chybí adresa nebo model, review přeskočeno.');
    return false;
  }
  sh('gh', ['variable', 'set', 'REVIEW_REZIM', '--repo', prostredi.repo, '--body', 'api']);
  sh('gh', ['variable', 'set', 'REVIEW_API_URL', '--repo', prostredi.repo, '--body', url]);
  sh('gh', ['variable', 'set', 'REVIEW_MODEL', '--repo', prostredi.repo, '--body', model]);
  ok(`recenzent ${model} přes ${url}`);
  const maKlic = zkus('gh', ['secret', 'list', '--repo', prostredi.repo]).stdout.includes('REVIEW_API_KEY');
  if (maKlic && !(await potvrd('   Klíč REVIEW_API_KEY už je nastavený. Přepsat?', false))) return true;
  if (bezOtazek) {
    pozor(`Klíč nastavte sami: gh secret set REVIEW_API_KEY --repo ${prostredi.repo}`);
    return true;
  }
  console.log('   Vložte klíč k API (vstup je skrytý, klíč jde rovnou do GitHubu, průvodce ho nevidí):');
  rl.pause();
  const r = spawnSync('gh', ['secret', 'set', 'REVIEW_API_KEY', '--repo', prostredi.repo], { stdio: 'inherit' });
  rl.resume();
  if (r.status === 0) ok('klíč uložen');
  else pozor(`Uložení klíče selhalo. Zkuste: gh secret set REVIEW_API_KEY --repo ${prostredi.repo}`);
  return true;
}

// Review přes předplatné Claude: Claude Code v Actions s tokenem z `claude setup-token`.
async function krokReviewClaude(prostredi) {
  console.log('   Recenzent poběží jako Claude Code s vaším předplatným Claude (Pro, Max, Team, Enterprise).');
  pozor('Agent, který píše kód, pak nesmí být Claude. Kdo kód píše, ten ho nekontroluje.');
  pozor('Token je vázaný na vaše předplatné a nejde omezit částkou. U veřejného repozitáře zvažte raději klíč k API.');
  const model = hodnota('--review-model') ?? (bezOtazek ? '' : await zeptej('   Model (např. opus nebo sonnet, prázdné = výchozí)', ''));
  sh('gh', ['variable', 'set', 'REVIEW_REZIM', '--repo', prostredi.repo, '--body', 'claude-cli']);
  if (model) sh('gh', ['variable', 'set', 'REVIEW_MODEL', '--repo', prostredi.repo, '--body', model]);
  else zkus('gh', ['variable', 'delete', 'REVIEW_MODEL', '--repo', prostredi.repo]);
  ok(`recenzent Claude přes předplatné${model ? ` (${model})` : ''}`);
  const maToken = zkus('gh', ['secret', 'list', '--repo', prostredi.repo]).stdout.includes('CLAUDE_CODE_OAUTH_TOKEN');
  if (maToken && !(await potvrd('   Token CLAUDE_CODE_OAUTH_TOKEN už je nastavený. Přepsat?', false))) return true;
  if (bezOtazek) {
    pozor(`Token vyrobte příkazem \`claude setup-token\` a uložte: gh secret set CLAUDE_CODE_OAUTH_TOKEN --repo ${prostredi.repo}`);
    return true;
  }
  console.log('   V jiném terminálu spusťte `claude setup-token`, přihlaste se a zkopírujte vypsaný token.');
  console.log('   Pak ho vložte sem (vstup je skrytý, token jde rovnou do GitHubu, průvodce ho nevidí):');
  rl.pause();
  const r = spawnSync('gh', ['secret', 'set', 'CLAUDE_CODE_OAUTH_TOKEN', '--repo', prostredi.repo], { stdio: 'inherit' });
  rl.resume();
  if (r.status === 0) ok('token uložen');
  else pozor(`Uložení tokenu selhalo. Zkuste: gh secret set CLAUDE_CODE_OAUTH_TOKEN --repo ${prostredi.repo}`);
  return true;
}

// --- 5. Issue „Začínáme“ ---------------------------------------------------------------------------

export function teloZaciname(repo, review) {
  return [
    'Tohle issue založil průvodce nastavením. Zbývá pár kroků, které se dělají ručně. Postup je v README.',
    '',
    '## Před prvním zadáním',
    '',
    '- [ ] **Agent má vlastní identitu.** Nainstalujte agentovi GitHub App (nebo mu založte účet) a připojte ho k tomuto repozitáři.',
    '- [ ] **Agent nemá oprávnění Workflows**, Administration, Checks, Secrets ani Variables. Zkontrolujte v Settings → Integrations → GitHub Apps → Configure → Permissions. S oprávněním Workflows by si agent mohl bránu obejít.',
    review
      ? '- [ ] **Review běží.** Po prvním PR se pod ním objeví komentář „Review modelem …“. Když ne, podívejte se do Actions → Brána → Review druhým modelem.'
      : '- [ ] **Nastavte review druhým modelem** (README, „Review druhým modelem“). Bez něj se nic nesamosloučí.',
    '- [ ] **Vyplňte `MANIFEST.md`**: cíl, zákazy, rozpočet. Soubor je nevratný, takže to bude zároveň první zkouška brány: otevřete PR, brána napíše „Čeká na vlastníka“, přidejte `schvaleno` a PR se sloučí.',
    `- [ ] **Tabule práce.** Projects → New project → Board, propojte s ${repo} a zapněte vestavěné automatizace.`,
    '',
    '## První týden',
    '',
    '- [ ] Zvolte jeden vratný proces (dokumentace, texty webu, sběr dat). Platby, smlouvy a rozesílky si nechte.',
    '- [ ] Založte první zadání formulářem **Zadání pro agenta** a přidejte mu štítek `zadani`.',
    '- [ ] Zapište si výchozí stav: kolik hodin týdně teď na projektu trávíte.',
    '- [ ] V pondělí projděte issue **Týdenní souhrn**, hlavně náhodně vybranou změnu k přečtení.',
    '',
    '## Kdyby něco',
    '',
    '- Zastavit jeden PR: štítek `stop`.',
    '- Zastavit všechno samoslučování: proměnná repozitáře `SAMOSLUCOVANI` = `vypnuto` (Settings → Secrets and variables → Actions → Variables).',
    '- Vrátit sloučenou změnu: tlačítko **Revert** u PR.',
  ].join('\n');
}

function krokZaciname(prostredi, review) {
  krok(5, 'Issue „Začínáme“ s ručními kroky');
  const existuje = zkus('gh', ['issue', 'list', '--repo', prostredi.repo, '--state', 'open', '--search', 'Začínáme in:title', '--json', 'number', '--jq', '.[0].number']).stdout.trim();
  if (existuje) {
    ok(`už existuje: #${existuje}`);
    return;
  }
  const url = sh('gh', ['issue', 'create', '--repo', prostredi.repo, '--title', 'Začínáme: nastavení agenta a brány', '--body', teloZaciname(prostredi.repo, review)]);
  ok(url);
}

// --- Běh ----------------------------------------------------------------------------------------

async function main() {
  console.log('\x1b[1mPrůvodce nastavením: AI agent s branou sloučení\x1b[0m');
  console.log('Vratné změny se samosloučí, nevratné čekají na vás. Průvodce lze spustit znovu, hotové kroky přeskočí.');
  const prostredi = zkontrolujProstredi();
  const zmeneno = await krokVlastnik(prostredi);
  await krokNahrani(prostredi, zmeneno);
  krokZamceni(prostredi);
  const review = await krokReview(prostredi);
  krokZaciname(prostredi, review);
  console.log('\n\x1b[1mHotovo.\x1b[0m Pokračujte podle issue „Začínáme“ na GitHubu.');
  rl?.close();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => konec(e.message));
}
