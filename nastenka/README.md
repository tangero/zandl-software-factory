# Nástěnka práce

Jedna stránka se stavem zadání a PR ze všech repozitářů vaší software factory. Sloupce se počítají
z GitHubu a z verdiktu brány, ručně se nic nepřetahuje. Z nástěnky jde založit nové zadání.

Nástěnka je volitelná a je jedna na vlastníka, ne na repozitář. Do projektových repozitářů se
nekopíruje: nasazuje se jednou z klonu šablony a repozitáře k ní připojíte instalací její GitHub App.

Specifikace: [Nástěnka práce – specifikace](https://claude.ai/artifact/A4ahV2qafCZzDzTqk2ayms).

## Nasazení (10 minut)

Potřebujete účet Cloudflare (stačí bezplatný), Node 20+ a přihlášený wrangler (`npx wrangler login`).

```bash
node nastenka/nastav.mjs            # aplikace pod osobním účtem
node nastenka/nastav.mjs --org ACME # aplikace pod organizací
```

Průvodce:

1. zeptá se na GitHub účty, které se smějí přihlásit (výchozí je váš účet z `gh`),
2. založí databázi D1 `nastenka` a pustí migrace,
3. nasadí Worker a zjistí jeho adresu (`https://nastenka.<účet>.workers.dev`),
4. otevře GitHub s předvyplněnou aplikací (oprávnění i webhooky); potvrdíte ji jedním tlačítkem,
5. uloží klíče aplikace jako tajemství Workeru a nasadí znovu,
6. otevře instalaci aplikace, kde vyberete repozitáře.

Hotové kroky si pamatuje v `nastenka/.nastaveni.json` a při dalším spuštění je přeskočí.
`wrangler.toml` vzniká ze vzoru `wrangler.example.toml`; oba lokální soubory jsou v `.gitignore`.

## Repozitáře

Seznam repozitářů není v kódu. Určuje ho instalace aplikace: *GitHub → Settings → Applications →
Nástěnka → Configure*, nebo tlačítko **Přidat repozitář** na nástěnce. Nový repozitář se objeví
do minuty, odebraný zmizí i s daty.

Repozitář bez brány funguje také. Sloupce se pak berou jen z PR: draft = Agent pracuje,
běžící CI = Kontroluje se, selhané CI, požadované změny nebo zelené PR čekající na sloučení = Čeká na vás.

## Sloupce

| sloupec | karta tam je, když |
|---|---|
| Čeká na vás | issue má `otazka`; PR má `stop`; brána je *Zastaveno* nebo *Čeká na vlastníka* |
| Sloučí se samo | brána hlásí lhůtu samosloučení (karta ukáže čas) nebo PR sloučí při dalším běhu |
| Kontroluje se | PR je připravený a brána čeká na kontroly nebo review |
| Agent pracuje | PR je draft |
| Zadáno | issue má `zadani` a ještě nemá PR |
| Návrhy | issue má `navrh` |
| Hotovo | PR je sloučený (posledních 14 dní) |
| Zamítnuto | `zamitnuto`, zavřeno jako *not planned* nebo PR zavřený bez sloučení (skryté, přepínač *Zamítnuté*) |

Karta je jedno zadání: issue a jeho PR (větev `zadani/<číslo>-…` nebo `Fixes #<číslo>`).
Pravidlo je čistá funkce `urciSloupec` v `src/sloupce.mjs` s testy.

## Jak to funguje

```
GitHub ──webhook──▶ Worker ──GraphQL (1 dotaz na repozitář)──▶ GitHub
                      │
                      ▼
                D1: snímek položek repozitáře ──▶ stránka (sloupce se počítají při čtení)
cron po 15 min ──▶ obnoví seznam instalací a repozitáře, kterým mohl ujet webhook
```

- **Čtení:** instalačním tokenem aplikace. Každá událost z repozitáře (issue, PR, review, stav, CI)
  obnoví celý repozitář jedním GraphQL dotazem; D1 drží jen snímek a jde kdykoli smazat.
- **Zápis:** jediný zápis na GitHub je nové zadání, a to tokenem přihlášeného vlastníka. Issue vznikne
  jeho jménem a štítek `zadani` přidá druhým voláním, takže na GitHubu je událost `labeled` s vlastníkem
  jako aktérem. Podle ní agent (`AGENTS.md`) pozná, že zadání schválil vlastník.
- **Brána:** stav commitu „Brána“ a komentář brány se berou jen od `github-actions`. Brána zapisuje do
  komentáře strojově čitelný verdikt (`<!-- brana:verdikt {...} -->`); u starších kopií brány bez něj
  nástěnka čte popis stavu.
- **Přihlášení:** přes GitHub (OAuth téže aplikace), jen účty z proměnné `VLASTNICI`. Relace platí
  jako token GitHubu (obvykle 8 hodin), pak stránka přesměruje na nové přihlášení.

## Oprávnění aplikace

| oprávnění | úroveň | proč |
|---|---|---|
| Metadata, Pull requests, Commit statuses, Checks | čtení | stav PR, brány a CI |
| Issues | čtení a zápis | založení zadání jménem přihlášeného vlastníka |
| Contents, Workflows, Administration, Secrets | žádné | nástěnka nečte kód a nic jiného nemění |

Nástěnka nikdy nepřidává `schvaleno`, `samoslouceno` ani `stop` a nic neslučuje.

## Provoz a ladění

- Log: `cd nastenka && npx wrangler tail`.
- Chyba načtení repozitáře se ukáže v patičce nástěnky.
- Cron obnoví nejvýš 15 repozitářů za běh (limit podřízených požadavků Workers na bezplatném tarifu);
  při větším počtu se střídají, webhooky obnovují okamžitě.
- Testy: `node --test 'nastenka/test/*.test.mjs'` (workflow *Testy nástěnky*).
- Lokálně: `npx wrangler d1 migrations apply nastenka --local`, tajemství do `nastenka/.dev.vars`, `npx wrangler dev`.

## Co je ověřené a co ne

Ověřeno (listopad 2026):

- testy sloupců, kontraktu s bránou, převodu GraphQL, podpisu JWT, webhooků a šifrování;
- GraphQL dotaz na skutečných repozitářích s bránou i bez ní: sloupce, čas samosloučení, spojení issue a PR;
- `wrangler dev` s lokální D1: přihlašovací stránka, odmítnutí nepodepsaného webhooku, API jen s relací,
  ochrana proti CSRF, vykreslení nástěnky a formuláře, text z GitHubu se nevykonává jako HTML.

Neověřeno, dokud ho někdo nespustí naostro:

- průvodce `nastav.mjs` (D1 na Cloudflaru, manifest GitHub App, tajemství, nasazení),
- přihlášení přes GitHub a založení zadání skutečným tokenem uživatele,
- příjem skutečných webhooků a cron na Cloudflaru.
