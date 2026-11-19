// Worker nástěnky: přihlášení přes GitHub, API pro stránku, příjem webhooků a cron.

import { kartyNastenky, SLOUPCE, DNI_HOTOVO } from './sloupce.mjs';
import { gh, zalozZadani } from './github.mjs';
import { overPodpisWebhooku, nahodneId, zasifruj, desifruj, cookies, cookie, jeVlastnik } from './bezpecnost.mjs';
import { behCronu, obnovRepozitar, zpracujWebhook } from './synchronizace.mjs';
import { STRANKA, PRIHLASENI, SKRIPT, STYL, chybovaStranka } from './stranka.mjs';

const BEZPECNOSTNI_HLAVICKY = {
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
};

const html = (telo, status = 200, hlavicky = {}) =>
  new Response(telo, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', ...BEZPECNOSTNI_HLAVICKY, ...hlavicky } });
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...BEZPECNOSTNI_HLAVICKY } });
const presmeruj = (kam, hlavicky = {}) => new Response(null, { status: 302, headers: { Location: kam, ...hlavicky } });

// Chybějící nastavení hlásíme srozumitelně, ne výjimkou: průvodce nasazuje Worker dřív, než má secrets.
const POVINNE = ['GITHUB_APP_ID', 'GITHUB_APP_SLUG', 'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'GITHUB_APP_PRIVATE_KEY', 'GITHUB_WEBHOOK_SECRET', 'SESSION_KEY', 'VLASTNICI'];
const chybiNastaveni = (env) => POVINNE.filter((k) => !env[k]);

async function nactiRelaci(request, env) {
  const id = cookies(request).relace;
  if (!id || !/^[0-9a-f]{64}$/.test(id)) return null;
  const r = await env.DB.prepare('SELECT login, token, plati_do FROM relace WHERE id = ?').bind(id).first();
  if (!r || Date.parse(r.plati_do) < Date.now()) return null;
  // Seznam vlastníků se může změnit; odebraný účet přestane mít přístup hned.
  if (!jeVlastnik(r.login, env.VLASTNICI)) return null;
  return { id, login: r.login, token: () => desifruj(env.SESSION_KEY, r.token) };
}

async function prihlasit(request, env) {
  const url = new URL(request.url);
  const stav = nahodneId(16);
  const cil = new URL('https://github.com/login/oauth/authorize');
  cil.searchParams.set('client_id', env.GITHUB_CLIENT_ID);
  cil.searchParams.set('redirect_uri', `${url.origin}/zpet`);
  cil.searchParams.set('state', stav);
  return presmeruj(cil.toString(), { 'Set-Cookie': cookie('oauth_stav', stav, 600) });
}

async function zpet(request, env) {
  const url = new URL(request.url);
  const stav = url.searchParams.get('state');
  const kod = url.searchParams.get('code');
  if (!kod || !stav || stav !== cookies(request).oauth_stav) {
    return html(chybovaStranka('Přihlášení se nepodařilo', 'Odkaz z GitHubu je neplatný nebo starý. Zkuste to znovu.'), 400);
  }
  const odpoved = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'nastenka-software-factory' },
    body: JSON.stringify({ client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET, code: kod, redirect_uri: `${url.origin}/zpet` }),
  }).then((r) => r.json());
  if (!odpoved.access_token) {
    return html(chybovaStranka('Přihlášení se nepodařilo', 'GitHub nevydal token. Zkuste to znovu.'), 400);
  }
  const uzivatel = await gh('user', { token: odpoved.access_token });
  if (!jeVlastnik(uzivatel.login, env.VLASTNICI)) {
    return html(chybovaStranka('Přístup odepřen', `Účet ${uzivatel.login} není mezi vlastníky této nástěnky (proměnná VLASTNICI).`), 403);
  }
  // Token GitHub App vyprší (obvykle za 8 h); relace platí stejně dlouho. Bez expirace 8 h.
  const platnost = Math.min(Number(odpoved.expires_in) || 8 * 3600, 8 * 3600);
  const id = nahodneId();
  await env.DB.prepare('INSERT INTO relace (id, login, token, plati_do) VALUES (?, ?, ?, ?)')
    .bind(id, uzivatel.login, await zasifruj(env.SESSION_KEY, odpoved.access_token), new Date(Date.now() + platnost * 1000).toISOString()).run();
  const hlavicky = new Headers({ Location: '/' });
  hlavicky.append('Set-Cookie', cookie('relace', id, platnost));
  hlavicky.append('Set-Cookie', cookie('oauth_stav', '', 0));
  return new Response(null, { status: 302, headers: hlavicky });
}

async function karty(env, relace) {
  const { results } = await env.DB.prepare('SELECT full_name, polozky, synchronizovano, chyba FROM repozitare ORDER BY full_name').all();
  const repozitare = results.map((r) => ({ repo: r.full_name, polozky: r.polozky ? JSON.parse(r.polozky) : [] }));
  return json({
    login: relace.login,
    sloupce: SLOUPCE,
    dniHotovo: DNI_HOTOVO,
    karty: kartyNastenky(repozitare),
    repozitare: results.map((r) => ({ nazev: r.full_name, synchronizovano: r.synchronizovano, chyba: r.chyba })),
    instalace: `https://github.com/apps/${env.GITHUB_APP_SLUG}/installations/new`,
  });
}

async function noveZadani(request, env, ctx, relace) {
  let data;
  try {
    data = await request.json();
  } catch {
    return json({ chyba: 'Neplatný požadavek.' }, 400);
  }
  for (const pole of ['repo', 'titulek', 'cil', 'hotovo']) {
    if (typeof data[pole] !== 'string' || !data[pole].trim()) return json({ chyba: `Chybí pole ${pole}.` }, 400);
  }
  const repo = await env.DB.prepare('SELECT id, full_name, installation_id FROM repozitare WHERE full_name = ?').bind(data.repo).first();
  if (!repo) return json({ chyba: 'Repozitář není připojený k nástěnce.' }, 400);
  try {
    const vysledek = await zalozZadani(await relace.token(), repo.full_name, {
      titulek: data.titulek.slice(0, 250),
      cil: data.cil,
      hotovo: data.hotovo,
      mimo: data.mimo ?? '',
      kontext: data.kontext ?? '',
      stitek: data.stitek,
    });
    ctx.waitUntil(obnovRepozitar(env, repo));
    return json(vysledek, 201);
  } catch (e) {
    if (e.status === 401) return json({ chyba: 'Přihlášení vypršelo. Obnovte stránku a přihlaste se znovu.' }, 401);
    return json({ chyba: `GitHub zadání nepřijal: ${e.message}` }, 502);
  }
}

async function webhook(request, env, ctx) {
  const telo = await request.text();
  if (!(await overPodpisWebhooku(env.GITHUB_WEBHOOK_SECRET, telo, request.headers.get('X-Hub-Signature-256')))) {
    return new Response('Neplatný podpis', { status: 401 });
  }
  const udalost = request.headers.get('X-GitHub-Event');
  if (udalost === 'ping') return new Response('pong');
  ctx.waitUntil(zpracujWebhook(env, udalost, JSON.parse(telo)).catch((e) => console.error(`Webhook ${udalost}: ${e.message}`)));
  return new Response('Přijato', { status: 202 });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const cesta = url.pathname;
    const metoda = request.method;

    if (cesta === '/app.js') return new Response(SKRIPT, { headers: { 'Content-Type': 'text/javascript; charset=utf-8', ...BEZPECNOSTNI_HLAVICKY } });
    if (cesta === '/styl.css') return new Response(STYL, { headers: { 'Content-Type': 'text/css; charset=utf-8', ...BEZPECNOSTNI_HLAVICKY } });

    const chybi = chybiNastaveni(env);
    if (chybi.length) {
      return html(chybovaStranka('Nástěnka není nastavená', `Chybí: ${chybi.join(', ')}. Spusťte průvodce: node nastenka/nastav.mjs`), 503);
    }

    try {
      if (cesta === '/webhook' && metoda === 'POST') return await webhook(request, env, ctx);
      if (cesta === '/prihlasit' && metoda === 'GET') return await prihlasit(request, env);
      if (cesta === '/zpet' && metoda === 'GET') return await zpet(request, env);

      const relace = await nactiRelaci(request, env);
      if (cesta === '/odhlasit' && metoda === 'POST') {
        if (relace) await env.DB.prepare('DELETE FROM relace WHERE id = ?').bind(relace.id).run();
        return presmeruj('/', { 'Set-Cookie': cookie('relace', '', 0) });
      }
      if (cesta === '/' && metoda === 'GET') return html(relace ? STRANKA : PRIHLASENI);

      if (cesta.startsWith('/api/')) {
        if (!relace) return json({ chyba: 'Nepřihlášeno.' }, 401);
        // Ochrana proti CSRF: vlastní hlavičku cizí stránka bez CORS (který neposíláme) nepřidá.
        if (metoda !== 'GET' && request.headers.get('X-Nastenka') !== '1') return json({ chyba: 'Chybí hlavička X-Nastenka.' }, 403);
        if (cesta === '/api/karty' && metoda === 'GET') return await karty(env, relace);
        if (cesta === '/api/zadani' && metoda === 'POST') return await noveZadani(request, env, ctx, relace);
        if (cesta === '/api/obnovit' && metoda === 'POST') {
          ctx.waitUntil(behCronu(env).catch((e) => console.error(`Obnova: ${e.message}`)));
          return json({ ok: true }, 202);
        }
      }
      return new Response('Nenalezeno', { status: 404 });
    } catch (e) {
      console.error(e);
      return html(chybovaStranka('Chyba', 'Něco se pokazilo. Podrobnosti jsou v logu Workeru (wrangler tail).'), 500);
    }
  },

  async scheduled(_udalost, env, ctx) {
    if (chybiNastaveni(env).length) return;
    ctx.waitUntil(behCronu(env));
  },
};
