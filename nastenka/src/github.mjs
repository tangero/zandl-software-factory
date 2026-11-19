// GitHub z Workeru: JWT aplikace, instalační tokeny, GraphQL dotaz na stav repozitáře a převod
// odpovědi na položky nástěnky. Bez závislostí, jen fetch a WebCrypto.

import { jeAutomatika, prectiZnackuVerdiktu, stavBrany, DNI_HOTOVO } from './sloupce.mjs';

const API = 'https://api.github.com';
export const KONTROLA_BRANY = 'Brána';

export async function gh(cesta, { token, method = 'GET', body, typ = 'Bearer' } = {}) {
  const odpoved = await fetch(cesta.startsWith('https://') ? cesta : `${API}/${cesta}`, {
    method,
    headers: {
      Authorization: `${typ} ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'nastenka-software-factory',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!odpoved.ok) {
    const chyba = new Error(`${method} ${cesta}: ${odpoved.status} ${(await odpoved.text()).slice(0, 300)}`);
    chyba.status = odpoved.status;
    throw chyba;
  }
  return odpoved.status === 204 ? null : odpoved.json();
}

// --- Klíč aplikace a JWT ------------------------------------------------------------------------

const b64url = (bajty) => btoa(String.fromCharCode(...new Uint8Array(bajty))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const textNaB64url = (text) => b64url(new TextEncoder().encode(text));

function derDelka(n) {
  if (n < 0x80) return [n];
  const bajty = [];
  while (n > 0) { bajty.unshift(n & 0xff); n >>= 8; }
  return [0x80 | bajty.length, ...bajty];
}
const der = (znacka, obsah) => [znacka, ...derDelka(obsah.length), ...obsah];

// GitHub vydává klíč aplikace jako PKCS#1 („BEGIN RSA PRIVATE KEY“), WebCrypto bere jen PKCS#8.
// Průvodce klíč převádí, ale ručně vložený klíč z GitHubu funguje také: obalíme ho sami.
export function pemNaPkcs8(pem) {
  const pkcs1 = pem.includes('BEGIN RSA PRIVATE KEY');
  const telo = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const bajty = [...Uint8Array.from(atob(telo), (z) => z.charCodeAt(0))];
  if (!pkcs1) return new Uint8Array(bajty);
  const algoritmus = [0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00];
  return new Uint8Array(der(0x30, [0x02, 0x01, 0x00, ...algoritmus, ...der(0x04, bajty)]));
}

export async function jwtAplikace(appId, pem, ted = Date.now()) {
  const klic = await crypto.subtle.importKey('pkcs8', pemNaPkcs8(pem), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const s = Math.floor(ted / 1000);
  const obsah = `${textNaB64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${textNaB64url(JSON.stringify({ iat: s - 60, exp: s + 540, iss: String(appId) }))}`;
  const podpis = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', klic, new TextEncoder().encode(obsah));
  return `${obsah}.${b64url(podpis)}`;
}

// --- Dotaz na stav repozitáře ------------------------------------------------------------------

// Jeden dotaz na repozitář: Workers na bezplatném tarifu dovolí jen omezený počet podřízených
// požadavků na jedno spuštění, takže stav nesmíme skládat z desítek REST volání na každé PR.
export const DOTAZ_REPOZITARE = `
query($owner: String!, $name: String!, $od: DateTime!) {
  repository(owner: $owner, name: $name) {
    otevreneIssues: issues(states: OPEN, first: 100, orderBy: {field: UPDATED_AT, direction: DESC}) { nodes { ...Issue } }
    zavreneIssues: issues(states: CLOSED, first: 50, orderBy: {field: UPDATED_AT, direction: DESC}, filterBy: {since: $od}) { nodes { ...Issue } }
    otevrenePr: pullRequests(states: OPEN, first: 50, orderBy: {field: UPDATED_AT, direction: DESC}) {
      nodes {
        ...Pr
        isDraft
        headRefOid
        reviewDecision
        commits(last: 1) { nodes { commit { statusCheckRollup { contexts(first: 50) { nodes {
          __typename
          ... on StatusContext { context state description creator { login } }
          ... on CheckRun { name status conclusion }
        } } } } } }
        comments(last: 30) { nodes { author { login } body } }
      }
    }
    zavrenePr: pullRequests(states: [MERGED, CLOSED], first: 50, orderBy: {field: UPDATED_AT, direction: DESC}) { nodes { ...Pr } }
  }
}
fragment Issue on Issue { number title url state stateReason updatedAt closedAt author { login } labels(first: 20) { nodes { name } } }
fragment Pr on PullRequest {
  number title url state merged updatedAt closedAt headRefName author { login }
  labels(first: 20) { nodes { name } }
  closingIssuesReferences(first: 5) { nodes { number } }
}`;

const SELHANI = new Set(['FAILURE', 'ERROR', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE']);

// Souhrn kontrol CI bez brány: failure, když cokoli selhalo; pending, když něco běží; jinak success.
export function souhrnKontrol(kontexty) {
  const ostatni = kontexty.filter((k) => !(k.__typename === 'StatusContext' && k.context === KONTROLA_BRANY));
  if (!ostatni.length) return null;
  let bezi = false;
  for (const k of ostatni) {
    if (k.__typename === 'StatusContext') {
      if (SELHANI.has(k.state)) return 'failure';
      if (k.state !== 'SUCCESS') bezi = true;
    } else {
      if (k.status !== 'COMPLETED') bezi = true;
      else if (SELHANI.has(k.conclusion)) return 'failure';
    }
  }
  return bezi ? 'pending' : 'success';
}

const stitky = (uzel) => (uzel.labels?.nodes ?? []).map((l) => l.name);

function issueNaPolozku(i) {
  return {
    druh: 'issue',
    cislo: i.number,
    titulek: i.title,
    url: i.url,
    autor: i.author?.login ?? null,
    stitky: stitky(i),
    stav: i.state === 'OPEN' ? 'open' : 'closed',
    duvodUzavreni: i.stateReason ? i.stateReason.toLowerCase() : null,
    upraveno: i.updatedAt,
    uzavreno: i.closedAt,
  };
}

function prNaPolozku(p) {
  const polozka = {
    druh: 'pr',
    cislo: p.number,
    titulek: p.title,
    url: p.url,
    autor: p.author?.login ?? null,
    stitky: stitky(p),
    stav: p.state === 'OPEN' ? 'open' : 'closed',
    merged: Boolean(p.merged),
    draft: Boolean(p.isDraft),
    vetev: p.headRefName,
    uzaviraIssues: (p.closingIssuesReferences?.nodes ?? []).map((n) => n.number),
    upraveno: p.updatedAt,
    uzavreno: p.closedAt,
  };
  if (p.state !== 'OPEN') return polozka;

  const kontexty = p.commits?.nodes?.[0]?.commit?.statusCheckRollup?.contexts?.nodes ?? [];
  // Stav „Brána“ se bere jen od automatiky brány; stejně pojmenovaný stav od kohokoli jiného se ignoruje.
  const status = kontexty.find((k) => k.__typename === 'StatusContext' && k.context === KONTROLA_BRANY && jeAutomatika(k.creator?.login));
  const komentarBrany = (p.comments?.nodes ?? []).filter((k) => jeAutomatika(k.author?.login) && k.body?.includes('brana:verdikt')).at(-1);
  polozka.hlava = p.headRefOid;
  polozka.brana = stavBrany(
    status ? { stav: status.state.toLowerCase(), popis: status.description } : null,
    prectiZnackuVerdiktu(komentarBrany?.body),
    p.headRefOid,
  );
  polozka.kontroly = souhrnKontrol(kontexty);
  polozka.review = p.reviewDecision ?? null;
  return polozka;
}

// Odpověď GraphQL → položky jednoho repozitáře. Uzavřené PR starší než DNI_HOTOVO se zahodí.
export function polozkyZOdpovedi(repository, ted = Date.now()) {
  const hranice = ted - DNI_HOTOVO * 86_400_000;
  const r = repository;
  const issues = [...r.otevreneIssues.nodes, ...r.zavreneIssues.nodes].map(issueNaPolozku);
  const pr = [
    ...r.otevrenePr.nodes,
    ...r.zavrenePr.nodes.filter((p) => p.closedAt && Date.parse(p.closedAt) >= hranice),
  ].map(prNaPolozku);
  return [...issues, ...pr];
}

export async function nactiRepozitar(token, fullName, ted = Date.now()) {
  const [owner, name] = fullName.split('/');
  const od = new Date(ted - DNI_HOTOVO * 86_400_000).toISOString();
  const odpoved = await gh('graphql', { token, method: 'POST', body: { query: DOTAZ_REPOZITARE, variables: { owner, name, od } } });
  if (odpoved.errors?.length) throw new Error(`GraphQL ${fullName}: ${odpoved.errors.map((e) => e.message).join('; ')}`);
  return polozkyZOdpovedi(odpoved.data.repository, ted);
}

// --- Založení zadání ---------------------------------------------------------------------------

// Tělo issue ve stejném tvaru, jaký vytváří formulář .github/ISSUE_TEMPLATE/zadani.yml.
export function teloZadani({ cil, hotovo, mimo, kontext }) {
  const oddil = (nadpis, text) => `### ${nadpis}\n\n${text?.trim() ? text.trim() : '_No response_'}`;
  return [oddil('Cíl', cil), oddil('Hotovo, když', hotovo), oddil('Mimo rozsah', mimo), oddil('Podklady', kontext)].join('\n\n');
}

// Zadání se zakládá tokenem přihlášeného vlastníka. Štítek se přidává druhým voláním, aby na GitHubu
// vznikla událost `labeled` s vlastníkem jako aktérem: podle ní agent (AGENTS.md) ověřuje, že zadání
// schválil vlastník.
export async function zalozZadani(tokenUzivatele, fullName, data) {
  const issue = await gh(`repos/${fullName}/issues`, {
    token: tokenUzivatele,
    method: 'POST',
    body: { title: data.titulek.trim(), body: teloZadani(data) },
  });
  await gh(`repos/${fullName}/issues/${issue.number}/labels`, {
    token: tokenUzivatele,
    method: 'POST',
    body: { labels: [data.stitek === 'navrh' ? 'navrh' : 'zadani'] },
  });
  return { cislo: issue.number, url: issue.html_url };
}
