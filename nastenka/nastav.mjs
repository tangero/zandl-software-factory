#!/usr/bin/env node
// Průvodce nasazením nástěnky. Spusťte z klonu šablony:
//   node nastenka/nastav.mjs [--org ORGANIZACE]
//
// Kroky: kontrola wrangleru → databáze D1 a migrace → nasazení Workeru → GitHub App přes manifest
// (jedno potvrzení v prohlížeči) → tajemství Workeru → nové nasazení → instalace aplikace na repozitáře.
// Hotové kroky si pamatuje v nastenka/.nastaveni.json (bez tajemství) a při dalším spuštění je přeskočí.
// `--org` založí aplikaci pod organizací místo osobního účtu.

import { spawnSync } from 'node:child_process';
import { createPrivateKey, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

const ADRESAR = path.dirname(fileURLToPath(import.meta.url));
const STAV = path.join(ADRESAR, '.nastaveni.json');
const KONFIGURACE = path.join(ADRESAR, 'wrangler.toml');
const VZOR = path.join(ADRESAR, 'wrangler.example.toml');
const NAZEV_DB = 'nastenka';

const argumenty = process.argv.slice(2);
const hodnota = (n) => { const i = argumenty.indexOf(n); return i >= 0 ? argumenty[i + 1] : undefined; };
const organizace = hodnota('--org');

const krok = (n, text) => console.log(`\n\x1b[1m${n}. ${text}\x1b[0m`);
const ok = (text) => console.log(`   ✓ ${text}`);
function konec(text) {
  console.error(`\n✗ ${text}`);
  process.exit(1);
}

const stav = fs.existsSync(STAV) ? JSON.parse(fs.readFileSync(STAV, 'utf8')) : {};
const uloz = () => fs.writeFileSync(STAV, `${JSON.stringify(stav, null, 2)}\n`);

function wrangler(args, { vstup, tiše = false } = {}) {
  const r = spawnSync('npx', ['--yes', 'wrangler', ...args], {
    cwd: ADRESAR,
    encoding: 'utf8',
    input: vstup,
    stdio: vstup !== undefined || tiše ? ['pipe', 'pipe', 'pipe'] : ['inherit', 'pipe', 'inherit'],
  });
  if (!tiše && r.stdout) process.stdout.write(r.stdout);
  return { ok: r.status === 0, stdout: r.stdout ?? '', vystup: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

function otevri(url) {
  const prikaz = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  spawnSync(prikaz, [url], { stdio: 'ignore', shell: process.platform === 'win32' });
  console.log(`   Pokud se prohlížeč neotevřel, otevřete: ${url}`);
}

// wrangler.toml vzniká ze vzoru; hodnoty se doplňují postupně, jak je průvodce zjistí.
function zapisKonfiguraci() {
  let text = fs.readFileSync(VZOR, 'utf8');
  const nahrad = (vzor, hodnota) => { if (hodnota) text = text.replace(vzor, hodnota); };
  nahrad(/<id databáze[^"]*>/, stav.databaze);
  nahrad('<váš-github-login>', stav.vlastnici);
  nahrad('<App ID>', stav.aplikace?.id && String(stav.aplikace.id));
  nahrad('<slug aplikace>', stav.aplikace?.slug);
  nahrad('<Client ID>', stav.aplikace?.clientId);
  fs.writeFileSync(KONFIGURACE, text);
}

// --- 0. Prostředí ---------------------------------------------------------------------------------

krok(0, 'Kontrola prostředí');
if (Number(process.versions.node.split('.')[0]) < 20) konec('Průvodce potřebuje Node 20 nebo novější.');
const kdo = wrangler(['whoami'], { tiše: true });
if (!kdo.ok || /not authenticated|You are not logged in/i.test(kdo.vystup)) {
  konec('wrangler není přihlášený ke Cloudflaru. Spusťte `npx wrangler login` a průvodce znovu.');
}
ok('wrangler je přihlášený');

if (!stav.vlastnici) {
  const gh = spawnSync('gh', ['api', 'user', '--jq', '.login'], { encoding: 'utf8' });
  const vychozi = gh.status === 0 ? gh.stdout.trim() : '';
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const odpoved = (await rl.question(`   GitHub účty, které se smějí přihlásit (oddělené čárkou)${vychozi ? ` [${vychozi}]` : ''}: `)).trim();
  rl.close();
  stav.vlastnici = odpoved || vychozi;
  if (!stav.vlastnici) konec('Bez vlastníka by se na nástěnku nikdo nepřihlásil.');
  uloz();
}
ok(`vlastníci: ${stav.vlastnici}`);

// --- 1. Databáze --------------------------------------------------------------------------------

krok(1, 'Databáze D1');
if (!stav.databaze) {
  const seznam = wrangler(['d1', 'list', '--json'], { tiše: true });
  let existujici = null;
  try {
    // Jen stdout: hlášky wrangleru jdou na stderr a JSON by rozbily.
    existujici = JSON.parse(seznam.stdout).find((d) => d.name === NAZEV_DB) ?? null;
  } catch {
    console.log('   Seznam databází se nepodařilo přečíst, zakládám novou.');
  }
  if (existujici) {
    stav.databaze = existujici.uuid;
  } else {
    const vytvor = wrangler(['d1', 'create', NAZEV_DB], { tiše: true });
    const id = /"?database_id"?\s*[=:]\s*"([0-9a-f-]{36})"/.exec(vytvor.vystup)?.[1];
    if (!vytvor.ok || !id) konec(`Databázi se nepodařilo založit:\n${vytvor.vystup}`);
    stav.databaze = id;
  }
  uloz();
}
zapisKonfiguraci();
ok(`databáze ${NAZEV_DB} (${stav.databaze})`);
if (!wrangler(['d1', 'migrations', 'apply', NAZEV_DB, '--remote']).ok) konec('Migrace databáze selhaly.');
ok('migrace použité');

// --- 2. Worker ----------------------------------------------------------------------------------

krok(2, 'Nasazení Workeru');
// Adresu Workeru potřebuje GitHub App (webhook a návrat z přihlášení), proto se nasazuje před ní.
const nasazeni = wrangler(['deploy']);
if (!nasazeni.ok) konec('Nasazení selhalo.');
stav.adresa = /https:\/\/[^\s]+\.workers\.dev/.exec(nasazeni.vystup)?.[0] ?? stav.adresa;
if (!stav.adresa) konec('Adresu Workeru se nepodařilo zjistit z výstupu wrangleru. Doplňte "adresa" do nastenka/.nastaveni.json a spusťte průvodce znovu.');
uloz();
ok(`nástěnka běží na ${stav.adresa}`);

// --- 3. GitHub App ------------------------------------------------------------------------------

function manifest() {
  return {
    name: `Nástěnka ${stav.vlastnici.split(',')[0].trim()}`.slice(0, 34),
    url: stav.adresa,
    description: 'Nástěnka práce zandl-software-factory. Čte stav issues a PR, zakládá zadání jménem přihlášeného vlastníka.',
    public: false,
    hook_attributes: { url: `${stav.adresa}/webhook`, active: true },
    redirect_url: '', // doplní se adresou místního serveru
    callback_urls: [`${stav.adresa}/zpet`],
    request_oauth_on_install: false,
    // Žádné Contents, Workflows, Administration ani Secrets: nástěnka nečte kód a nic nemění kromě issues.
    default_permissions: { metadata: 'read', issues: 'write', pull_requests: 'read', statuses: 'read', checks: 'read' },
    // check_run (ne jen check_suite): jen ten hlásí i založení běhu, takže PR po pushi hned ukáže „běží kontroly“.
    default_events: ['issues', 'issue_comment', 'pull_request', 'pull_request_review', 'status', 'check_suite', 'check_run'],
  };
}

// Manifest flow: GitHub chce formulář odeslaný z prohlížeče a vrátí jednorázový kód na redirect_url.
// Místní server na 127.0.0.1 formulář podá a kód přijme; po převzetí se hned vypne.
function zalozAplikaci() {
  return new Promise((hotovo, chyba) => {
    const kontrola = randomBytes(16).toString('hex');
    const server = http.createServer(async (pozadavek, odpoved) => {
      const url = new URL(pozadavek.url, 'http://127.0.0.1');
      if (url.pathname === '/') {
        const m = { ...manifest(), redirect_url: `http://127.0.0.1:${server.address().port}/zpet` };
        const cil = organizace
          ? `https://github.com/organizations/${encodeURIComponent(organizace)}/settings/apps/new?state=${kontrola}`
          : `https://github.com/settings/apps/new?state=${kontrola}`;
        const hodnotaManifestu = JSON.stringify(m).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
        odpoved.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        odpoved.end(`<!doctype html><meta charset="utf-8"><title>Nástěnka</title>
<p>Přesměrování na GitHub…</p>
<form id="f" method="post" action="${cil}"><input type="hidden" name="manifest" value="${hodnotaManifestu}"><button>Pokračovat na GitHub</button></form>
<script>document.getElementById('f').submit()</script>`);
        return;
      }
      if (url.pathname === '/zpet') {
        const kod = url.searchParams.get('code');
        if (url.searchParams.get('state') !== kontrola || !kod) {
          odpoved.writeHead(400).end('Neplatný návrat z GitHubu.');
          return;
        }
        try {
          const r = await fetch(`https://api.github.com/app-manifests/${encodeURIComponent(kod)}/conversions`, {
            method: 'POST',
            headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'nastenka-pruvodce' },
          });
          if (!r.ok) throw new Error(`GitHub vrátil ${r.status}: ${(await r.text()).slice(0, 300)}`);
          const aplikace = await r.json();
          odpoved.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end('<meta charset="utf-8"><p>Aplikace je založená. Můžete se vrátit do terminálu.</p>');
          server.close();
          hotovo(aplikace);
        } catch (e) {
          odpoved.writeHead(500).end(e.message);
          server.close();
          chyba(e);
        }
        return;
      }
      odpoved.writeHead(404).end();
    });
    server.listen(0, '127.0.0.1', () => otevri(`http://127.0.0.1:${server.address().port}/`));
  });
}

function nastavTajemstvi(nazev, hodnota) {
  const r = wrangler(['secret', 'put', nazev], { vstup: hodnota });
  if (!r.ok) konec(`Tajemství ${nazev} se nepodařilo uložit:\n${r.vystup}`);
  ok(`tajemství ${nazev}`);
}

krok(3, 'GitHub App');
if (stav.aplikace && !stav.aplikace.tajemstvi) {
  konec(`Aplikace ${stav.aplikace.slug} vznikla, ale její tajemství se nepodařilo uložit do Workeru a jinde uložená nejsou.
  Smažte aplikaci na ${stav.aplikace.odkaz}/advanced (Delete GitHub App), odeberte klíč "aplikace"
  z nastenka/.nastaveni.json a spusťte průvodce znovu.`);
}
if (!stav.aplikace) {
  console.log('   V prohlížeči se otevře GitHub s předvyplněnou aplikací. Potvrďte ji tlačítkem „Create GitHub App“.');
  const aplikace = await zalozAplikaci();
  // Údaje aplikace se uloží hned, aby opakované spuštění nezaložilo druhou aplikaci.
  // Tajemství jdou rovnou do Workeru, na disk se neukládají.
  stav.aplikace = { id: aplikace.id, slug: aplikace.slug, clientId: aplikace.client_id, odkaz: aplikace.html_url, tajemstvi: false };
  uloz();
  zapisKonfiguraci();
  nastavTajemstvi('GITHUB_CLIENT_SECRET', aplikace.client_secret);
  nastavTajemstvi('GITHUB_WEBHOOK_SECRET', aplikace.webhook_secret);
  nastavTajemstvi('GITHUB_APP_PRIVATE_KEY', createPrivateKey(aplikace.pem).export({ type: 'pkcs8', format: 'pem' }));
  nastavTajemstvi('SESSION_KEY', randomBytes(32).toString('base64'));
  stav.aplikace.tajemstvi = true;
  uloz();
}
zapisKonfiguraci();
ok(`aplikace ${stav.aplikace.slug} (${stav.aplikace.odkaz})`);

// --- 4. Nové nasazení s údaji aplikace --------------------------------------------------------------

krok(4, 'Nasazení s údaji aplikace');
if (!wrangler(['deploy']).ok) konec('Nasazení selhalo.');
ok('hotovo');

// --- 5. Repozitáře ------------------------------------------------------------------------------

krok(5, 'Repozitáře');
console.log('   Vyberte na GitHubu „Only select repositories“ a zaškrtněte repozitáře své továrny.');
console.log('   Další repozitáře přidáte kdykoli stejně, nebo tlačítkem „Přidat repozitář“ na nástěnce.');
otevri(`https://github.com/apps/${stav.aplikace.slug}/installations/new`);

console.log(`\n\x1b[1mNástěnka: ${stav.adresa}\x1b[0m`);
console.log('Repozitáře se objeví do minuty po instalaci aplikace. Log Workeru: npx wrangler tail (ve složce nastenka/).');
