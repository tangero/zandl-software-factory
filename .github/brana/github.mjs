// Čtení a zápis přes GitHub REST API. Bez závislostí, jen fetch (Node 20+).
// Kód z větve PR se nikdy nestahuje ani nespouští; všechno o PR se čte přes API.

import fs from 'node:fs';
import { nactiKonfiguraci } from './pravidla.mjs';

export const REPO = process.env.GITHUB_REPOSITORY;

export function vytvorApi(token = process.env.GITHUB_TOKEN) {
  if (!token) throw new Error('Chybí GITHUB_TOKEN.');
  return async function api(cesta, { method = 'GET', body, accept } = {}) {
    const url = cesta.startsWith('https://') ? cesta : `https://api.github.com/${cesta}`;
    const odpoved = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: accept ?? 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'brana-slouceni',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!odpoved.ok) {
      const text = await odpoved.text();
      const chyba = new Error(`${method} ${cesta}: ${odpoved.status} ${text.slice(0, 300)}`);
      chyba.status = odpoved.status;
      throw chyba;
    }
    if (odpoved.status === 204) return { data: null, dalsi: null };
    const dalsi = odpoved.headers.get('link')?.match(/<([^>]+)>;\s*rel="next"/)?.[1] ?? null;
    const typ = odpoved.headers.get('content-type') ?? '';
    return { data: typ.includes('json') ? await odpoved.json() : await odpoved.text(), dalsi };
  };
}

// Projde všechny stránky. `klic` je pro odpovědi typu { check_runs: [...] }.
export async function vsechny(api, cesta, klic = null) {
  const vysledek = [];
  let url = cesta.includes('?') ? `${cesta}&per_page=100` : `${cesta}?per_page=100`;
  while (url) {
    const { data, dalsi } = await api(url);
    vysledek.push(...(klic ? data[klic] : data));
    url = dalsi;
  }
  return vysledek;
}

export function nactiKonfiguraciZeSouboru(cesta = '.github/pravidla.jsonc') {
  return nactiKonfiguraci(fs.readFileSync(cesta, 'utf8'));
}

export async function otevrenePr(api) {
  return (await vsechny(api, `repos/${REPO}/pulls?state=open`)).map((p) => p.number);
}

// Načte všechno, co potřebuje rozhodni() z pravidla.mjs.
export async function nactiVstup(api, cislo) {
  const { data: pr } = await api(`repos/${REPO}/pulls/${cislo}`);
  const hlava = pr.head.sha;

  // API vrací nejvýš 3000 souborů; když jich je víc, změna se bere jako nevratná.
  const soubory = (await vsechny(api, `repos/${REPO}/pulls/${cislo}/files`)).map((s) => ({
    cesta: s.filename,
    puvodniCesta: s.previous_filename ?? null,
    radku: (s.additions ?? 0) + (s.deletions ?? 0),
  }));

  const udalosti = (await vsechny(api, `repos/${REPO}/issues/${cislo}/events`))
    .filter((u) => u.event === 'labeled' || u.event === 'unlabeled')
    .map((u) => ({ typ: u.event, stitek: u.label?.name, akter: u.actor?.login, kdy: u.created_at }));

  const komentare = (await vsechny(api, `repos/${REPO}/issues/${cislo}/comments`)).map((k) => ({
    autor: k.user?.login,
    telo: k.body ?? '',
    kdy: k.created_at,
  }));

  const runy = (await vsechny(api, `repos/${REPO}/commits/${hlava}/check-runs?filter=all`, 'check_runs')).map((r) => ({
    nazev: r.name,
    stav: r.status,
    zaver: r.conclusion,
    zacatek: r.started_at,
    aplikace: r.app?.slug,
  }));
  // Pro testy CI platí poslední běh každé kontroly.
  const posledni = new Map();
  const odNejnovejsiho = [...runy].sort((a, b) => Date.parse(b.zacatek ?? 0) - Date.parse(a.zacatek ?? 0));
  for (const r of odNejnovejsiho) if (!posledni.has(r.nazev)) posledni.set(r.nazev, r);

  return {
    pr: { cislo, stav: pr.state, rozpracovany: pr.draft, hlava, autor: pr.user?.login, titulek: pr.title },
    stitky: pr.labels.map((l) => l.name),
    soubory,
    souboryUplne: soubory.length === pr.changed_files,
    udalosti,
    komentare,
    kontroly: [...posledni.values()],
    runyBrany: runy,
  };
}
