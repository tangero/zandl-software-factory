// Synchronizace D1 s GitHubem. Zdroj pravdy je GitHub: každý repozitář se načte jedním GraphQL
// dotazem a jeho položky se v D1 přepíšou celé (snímek). Webhook i cron dělají totéž, liší se jen
// tím, které repozitáře obnoví.

import { gh, jwtAplikace, nactiRepozitar } from './github.mjs';
import { zasifruj, desifruj } from './bezpecnost.mjs';

// Kolik repozitářů obnoví jeden běh cronu. Drží počet podřízených požadavků pod limitem Workers
// na bezplatném tarifu; zbytek se obnoví v dalších bězích (nejdřív ty nejdéle neobnovené).
export const REPOZITARU_NA_BEH = 15;

const ted = () => new Date().toISOString();

export async function tokenInstalace(env, installationId) {
  const ulozeny = await env.DB.prepare('SELECT token, plati_do FROM tokeny WHERE installation_id = ?').bind(installationId).first();
  if (ulozeny && Date.parse(ulozeny.plati_do) - Date.now() > 5 * 60_000) return desifruj(env.SESSION_KEY, ulozeny.token);
  const jwt = await jwtAplikace(env.GITHUB_APP_ID, env.GITHUB_APP_PRIVATE_KEY);
  const novy = await gh(`app/installations/${installationId}/access_tokens`, { token: jwt, method: 'POST' });
  await env.DB.prepare(
    'INSERT INTO tokeny (installation_id, token, plati_do) VALUES (?, ?, ?) ON CONFLICT(installation_id) DO UPDATE SET token = excluded.token, plati_do = excluded.plati_do',
  ).bind(installationId, await zasifruj(env.SESSION_KEY, novy.token), novy.expires_at).run();
  return novy.token;
}

export async function ulozRepozitare(env, installationId, repozitare) {
  if (!repozitare.length) return;
  await env.DB.batch(repozitare.map((r) => env.DB.prepare(
    'INSERT INTO repozitare (id, full_name, installation_id, pridano) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET full_name = excluded.full_name, installation_id = excluded.installation_id',
  ).bind(r.id, r.full_name, installationId, ted())));
}

export async function odeberRepozitare(env, ids) {
  if (!ids.length) return;
  await env.DB.batch(ids.map((id) => env.DB.prepare('DELETE FROM repozitare WHERE id = ?').bind(id)));
}

export async function odeberInstalaci(env, installationId) {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM repozitare WHERE installation_id = ?').bind(installationId),
    env.DB.prepare('DELETE FROM tokeny WHERE installation_id = ?').bind(installationId),
  ]);
}

// Snímek nese čas začátku načtení. Pomalejší starší načtení nepřepíše novější (dva webhooky těsně po sobě).
const JEN_NOVEJSI = 'WHERE id = ? AND (synchronizovano IS NULL OR synchronizovano <= ?)';

export async function obnovRepozitar(env, repo) {
  const zacatek = ted();
  try {
    const token = await tokenInstalace(env, repo.installation_id);
    const polozky = await nactiRepozitar(token, repo.full_name);
    await env.DB.prepare(`UPDATE repozitare SET polozky = ?, synchronizovano = ?, chyba = NULL ${JEN_NOVEJSI}`)
      .bind(JSON.stringify(polozky), zacatek, repo.id, zacatek).run();
  } catch (e) {
    console.error(`Obnova ${repo.full_name}: ${e.message}`);
    await env.DB.prepare(`UPDATE repozitare SET chyba = ?, synchronizovano = ? ${JEN_NOVEJSI}`)
      .bind(String(e.message).slice(0, 500), zacatek, repo.id, zacatek).run();
  }
}

// Seznam repozitářů podle instalací aplikace. Repozitář, ze kterého vlastník aplikaci odebral,
// zmizí i s položkami.
export async function obnovSeznamRepozitaru(env) {
  const jwt = await jwtAplikace(env.GITHUB_APP_ID, env.GITHUB_APP_PRIVATE_KEY);
  const instalace = await gh('app/installations?per_page=100', { token: jwt });
  const videne = new Set();
  for (const inst of instalace) {
    if (inst.suspended_at) continue;
    const token = await tokenInstalace(env, inst.id);
    const { repositories } = await gh('installation/repositories?per_page=100', { token });
    await ulozRepozitare(env, inst.id, repositories);
    for (const r of repositories) videne.add(r.id);
  }
  const { results } = await env.DB.prepare('SELECT id FROM repozitare').all();
  await odeberRepozitare(env, results.map((r) => r.id).filter((id) => !videne.has(id)));
}

export async function behCronu(env) {
  const pred = (dni) => new Date(Date.now() - dni * 86_400_000).toISOString();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM udalosti WHERE kdy < ?').bind(pred(90)),
    env.DB.prepare('DELETE FROM relace WHERE plati_do < ?').bind(ted()),
  ]);
  await obnovSeznamRepozitaru(env);
  const { results } = await env.DB.prepare(
    'SELECT id, full_name, installation_id FROM repozitare ORDER BY synchronizovano IS NOT NULL, synchronizovano LIMIT ?',
  ).bind(REPOZITARU_NA_BEH).all();
  for (const repo of results) await obnovRepozitar(env, repo);
}

// Zpracování webhooku (podpis už je ověřený). Vrací popis pro log.
export async function zpracujWebhook(env, udalost, data) {
  const instalace = data.installation?.id;
  await env.DB.prepare('INSERT INTO udalosti (repozitar, typ, kdo, kdy) VALUES (?, ?, ?, ?)')
    .bind(data.repository?.full_name ?? null, data.action ? `${udalost}.${data.action}` : udalost, data.sender?.login ?? null, ted()).run();

  if (udalost === 'installation') {
    if (['deleted', 'suspend'].includes(data.action)) return odeberInstalaci(env, instalace);
    if (['created', 'unsuspend', 'new_permissions_accepted'].includes(data.action)) {
      const repozitare = data.repositories ?? [];
      await ulozRepozitare(env, instalace, repozitare);
      // Nejvýš tolik jako cron; zbytek (synchronizovano IS NULL) vezme cron přednostně.
      for (const r of repozitare.slice(0, REPOZITARU_NA_BEH)) await obnovRepozitar(env, { ...r, installation_id: instalace });
    }
    return;
  }
  if (udalost === 'installation_repositories') {
    await odeberRepozitare(env, (data.repositories_removed ?? []).map((r) => r.id));
    const pridane = data.repositories_added ?? [];
    await ulozRepozitare(env, instalace, pridane);
    for (const r of pridane.slice(0, REPOZITARU_NA_BEH)) await obnovRepozitar(env, { ...r, installation_id: instalace });
    return;
  }
  // Ostatní události (issues, pull_request, status…): obnovit celý repozitář jedním dotazem.
  if (data.repository && instalace) {
    await ulozRepozitare(env, instalace, [data.repository]);
    await obnovRepozitar(env, { id: data.repository.id, full_name: data.repository.full_name, installation_id: instalace });
  }
}
