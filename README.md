# Zandl Software Factory

**AI agent na vašem GitHubu bez věčného schvalování.**

Startovací sada pro firmu, která chce nechat AI agenta psát kód a nechce schvalovat každou čárku.
**[Použít šablonu →](https://github.com/tangero/zandl-software-factory/generate)**

Platí jedno pravidlo:

> **Vratná změna se samosloučí. Nevratná čeká na vás.**

PR se sloučí sám, když mění jen vratné soubory, druhý model v něm nenašel vážné nálezy, prošly testy
a během lhůty nikdo nepřidal `stop`. Pak dostane štítek `samoslouceno`. Všechno ostatní čeká na váš
štítek `schvaleno`. Jednou týdně projdete souhrn a vyberete, co vrátit.

**Proč obráceně?** Když člověk schvaluje dvacet PR denně, přestane je číst a štítek `schvaleno` pak nic
neznamená. Brána proto šetří vaši pozornost na to, co revert nevrátí.

**Co je vratné?** To, co jde vrátit revertem i s následky. Text stránky sundáte z webu za minutu.
Odeslaný e-mail, platbu, smazaná data ani uniklé údaje revert nevrátí. Které soubory jsou vratné, určuje
seznam cest v `.github/pravidla.jsonc`, ne model. Model smí změnu zařadit jen přísněji.

---

## Obsah

1. [Rychlý start (20 minut)](#rychlý-start-20-minut)
2. [Návod krok za krokem](#návod-krok-za-krokem)
3. [Každodenní práce](#každodenní-práce)
4. [Jak brána rozhoduje](#jak-brána-rozhoduje)
5. [Řešení potíží](#řešení-potíží)
6. [Co je v sadě](#co-je-v-sadě)
7. [Co je ověřené a co ne](#co-je-ověřené-a-co-ne)

---

## Rychlý start (20 minut)

Budete potřebovat:

- repozitář na GitHubu, ve kterém jste správce,
- [GitHub CLI](https://cli.github.com) přihlášené s oprávněním pro workflow: `gh auth login`, pak `gh auth refresh -s workflow`,
- Node.js 20 nebo novější,
- klíč k API modelu, který bude dělat review. Má být od jiného výrobce, než jaký používá váš agent.

**1. Zkopírujte sadu do repozitáře.** Pro nový projekt klikněte nahoře na *Use this template → Create a new
repository* a nový repozitář si naklonujte. Do existujícího repozitáře zkopírujte `.github/`, `nastaveni/`,
`MANIFEST.md`, `AGENTS.md` a `CLAUDE.md`. Když už `AGENTS.md` nebo `CLAUDE.md` máte, obsah spojte ručně.

Ve vašem repozitáři pak zkontrolujte *Actions*: když GitHub hlásí, že workflow jsou vypnutá, zapněte je
(v repozitáři šablony vypnutá jsou, aby brána neběžela nad nevyplněnými pravidly).

**2. Spusťte průvodce** v kořeni repozitáře:

```bash
node nastaveni/onboarding.mjs
```

Průvodce se zeptá na vlastníka a recenzenta a sám udělá tohle:

| krok | co udělá |
|---|---|
| 0 | zkontroluje `gh`, oprávnění a repozitář |
| 1 | zapíše vás jako vlastníka do `.github/pravidla.jsonc` a ukáže vratné cesty |
| 2 | commitne a pushne sadu do hlavní větve (dokud není zamčená) |
| 3 | založí štítky, zamkne hlavní větev rulesetem a nastaví workflow jen pro čtení |
| 4 | nastaví recenzenta; klíč zadáte do skrytého vstupu `gh`, průvodce ho nevidí |
| 5 | založí issue **Začínáme** se zbytkem kroků, které se dělají ručně |

Průvodce jde spustit znovu, hotové kroky přeskočí.

**3. Projděte issue „Začínáme“** na GitHubu a odškrtejte ruční kroky: identita a oprávnění agenta,
vyplněný manifest, tabule práce, první zadání.

---

## Návod krok za krokem

Co průvodce dělá a proč, rozepsané podle sedmi kroků. Hodí se, když chcete nastavení pochopit,
upravit nebo udělat ručně.

### 1. Agent s vlastním účtem

Agent musí pracovat pod vlastní identitou, ne pod vaším účtem. Jinak by jeho štítek `schvaleno`
vypadal jako váš. Použijte agenta, který se k repozitáři připojuje jako **GitHub App** (Claude Code,
OpenAI Codex nebo jiný kódovací agent s aplikací pro GitHub), nebo mu založte samostatný účet.

Oprávnění aplikace agenta zkontrolujte v *Settings → Integrations → GitHub Apps → Configure*:

| oprávnění | nastavení |
|---|---|
| Contents, Pull requests, Issues | Read and write |
| **Workflows** | **žádné** |
| Administration, Checks, Commit statuses, Secrets, Variables | žádné |

**Bez oprávnění Workflows to nejde.** S ním by si agent mohl v PR přidat vlastní workflow, které zapíše
zelený stav „Brána“ a PR sloučí. Když aplikace vašeho agenta toto oprávnění vyžaduje, sadu s ní
nepoužívejte.

### 2. Pravidla a tabule práce

Vlastníka a vratné cesty nastavíte v `.github/pravidla.jsonc`. Výchozí hodnoty:

| skupina | cesty | lhůta |
|---|---|---|
| dokumentace | `docs/**`, `**/*.md` | 0 h |
| testy | `tests/**`, `test/**`, `**/*.test.*` | 0 h |
| web | `src/**`, `app/**`, `components/**`, `public/**`, `styles/**` | 24 h |

Nevratné cesty mají přednost. Patří mezi ně `.github/**`, manifest a pravidla agenta, migrace a SQL,
`.env*`, soubory závislostí a složky s e-maily a platbami. Cokoli, co v seznamu vratných není, je nevratné.
Upravte oba seznamy podle svého projektu. Má-li třeba váš web složku, ze které se rozesílají zprávy,
patří do `nevratne`.

Štítky a zamčení založí `bash nastaveni/nastav.sh vlastnik/repozitar`.

Tabuli, na které uvidíte, jak se práce posouvá, máte dvě možnosti:

- **Nástěnka ze šablony** (`nastenka/`, volitelná): jedna stránka pro všechny repozitáře vaší továrny,
  sloupce podle verdiktu brány (co čeká na vás, co se sloučí samo a kdy) a zakládání zadání.
  Nasadíte ji jednou na Cloudflare příkazem `node nastenka/nastav.mjs`; repozitáře připojíte instalací
  její GitHub App. Do projektových repozitářů se nekopíruje. Návod: [nastenka/README.md](nastenka/README.md).
- **GitHub Projects**: *Projects → New project → Board*, propojte s repozitářem a zapněte vestavěné
  automatizace (nové issue → Todo, otevřený PR → In progress, sloučený PR → Done). Bránu nevidí.

### 3. Cíl a meze

Vyplňte `MANIFEST.md`:

- **co má vzniknout**, měřitelně;
- **co je zakázané**, každý zákaz napsaný jako zákaz („Nikdy neposílej…“);
- **kolik smí agent prohrát na pokusech** v penězích, v počtu PR na jedno zadání a v počtu otevřených PR.

Manifest čte agent před každou prací a recenzent při každém review. Je to nevratný soubor, takže jeho
změna vždy čeká na vás. Vyplnění manifestu je zároveň dobrá první zkouška brány: otevřete PR, brána
napíše „Čeká na vlastníka“, přidáte `schvaleno` a PR se sloučí.

### 4. Oddělené role a review druhým modelem

| role | kdo | co smí |
|---|---|---|
| zadává a schvaluje | vy (`vlastnici`) | štítky `zadani`, `schvaleno`, `stop` |
| píše kód | agent | větve a PR, žádné schvalování |
| kontroluje | model jiného výrobce | komentář review s verdiktem |
| slučuje | brána (GitHub Actions) | jen podle pravidel |

Review volá model přes rozhraní kompatibilní s OpenAI Chat Completions, které nabízí většina výrobců
i agregátorů. Průvodce nabízí OpenAI, xAI, Moonshot, Mistral, DeepSeek a OpenRouter, nebo vlastní adresu.
Ručně se review nastavuje v *Settings → Secrets and variables → Actions*:

| typ | název | hodnota |
|---|---|---|
| secret | `REVIEW_API_KEY` | klíč k API recenzenta |
| variable | `REVIEW_API_URL` | adresa endpointu `…/chat/completions` |
| variable | `REVIEW_MODEL` | název modelu přesně podle dokumentace výrobce |

Zadání pro recenzenta je v `.github/brana/review-zadani.md`. Review se váže na konkrétní commit: každý
nový commit dostane nové review a lhůta běží znovu. Bez nastaveného review se nic nesamosloučí. Brána pak
pouští jen PR se `schvaleno`.

### 5. Zamčená hlavní větev

Ruleset (`nastaveni/ruleset.json`) platí bez výjimek, i pro vás. Do hlavní větve jde jen přes PR a jen se
stavem „Brána“ = úspěch od aplikace GitHub Actions. Soubory s pravidly jsou nevratné cesty, takže jejich
změna se sloučí jen s vaším `schvaleno`. To platí i pro vaše vlastní PR.

Jak brána zachází se štítky:

- `schvaleno` platí jen od účtu z `vlastnici` a jen pro commit, na kterém jste ho přidali. Nový commit souhlas
  zruší. Štítek od kohokoli jiného brána odebere.
- `stop` zastaví sloučení čehokoli. Odebrat ho smí jen ten, kdo ho přidal, nebo vlastník. Jinak platí dál.
- `samoslouceno` přidává jen brána, po sloučení.

**Vypínač:** proměnná repozitáře `SAMOSLUCOVANI` s hodnotou `vypnuto` okamžitě zastaví samoslučování.
Potom se všechno slučuje jen se `schvaleno`. Agent k proměnným přístup nemá.

### 6. Jeden vratný proces, aspoň týden

Začněte procesem, kde chyba nic nestojí: dokumentace a odpovědi na časté dotazy, texty webu, sběr a čištění
dat do repozitáře. Platby, smlouvy a hromadné rozesílky si nechte. V pravidlech je nemějte mezi vratnými
cestami. Lhůty nechte zpočátku delší a nechte to běžet aspoň týden.

### 7. Měření

Každé pondělí brána založí issue **Týdenní souhrn**. Obsahuje, co se samosloučilo, co prošlo se schválením,
kde někdo dal `stop` a co se vracelo revertem, plus jednu náhodně vybranou samosloučenou změnu k přečtení
celé. Do tabulky v souhrnu doplňte čtyři čísla:

- váš čas na projektu před zavedením a po něm,
- nápady agenta, které přišly bez vašeho podnětu,
- chyby, které prošly do produkce,
- cenu za hotový výsledek.

Když je počet vet a revertů týdny na nule, jsou dvě možnosti: agent pracuje dobře, nebo souhrn nikdo nečte.
Rozliší je právě ta náhodně vybraná změna.

---

## Každodenní práce

| chcete | uděláte |
|---|---|
| zadat práci | formulář **Zadání pro agenta** (přidá `navrh`), pak sami přidáte `zadani` |
| pustit nevratnou změnu | přečtete PR a přidáte `schvaleno` |
| zastavit jeden PR | přidáte `stop` |
| zastavit veškeré samoslučování | proměnná `SAMOSLUCOVANI` = `vypnuto` |
| vrátit sloučenou změnu | tlačítko **Revert** u PR, revert pak projde bránou jako každý jiný PR |
| zjistit, na co PR čeká | stav „Brána“ u PR a komentář **Brána:** v PR |
| odpovědět agentovi | issue se štítkem `otazka`; odpovíte komentářem a štítek odeberete |
| změnit pravidla | PR se změnou `.github/pravidla.jsonc`, sloučí se jen se `schvaleno` |

Co uvidíte u PR ve stavu „Brána“:

| stav | význam |
|---|---|
| ✅ Samosloučí se / Schváleno vlastníkem | brána PR právě slučuje |
| 🟡 Čeká | review, lhůta nebo testy; vyřeší se samo |
| 🟡 Čeká na vlastníka | nevratná změna, velká změna nebo review chce člověka; přidejte `schvaleno` |
| ❌ Zastaveno | `stop` nebo neprošlé testy |

---

## Jak brána rozhoduje

V tomto pořadí (kód: `.github/brana/pravidla.mjs`):

1. aktivní `stop` → zastaveno,
2. rozpracovaný PR (draft) → čeká,
3. povinné testy z `pozadovaneKontroly` neprošly, běží nebo chybí → zastaveno nebo čeká,
4. platné `schvaleno` od vlastníka pro tento commit → **sloučí se**,
5. vypínač `SAMOSLUCOVANI=vypnuto` → čeká na vlastníka,
6. nevratná cesta (i původní cesta přejmenovaného souboru) nebo víc řádků než `maxRadku` → čeká na vlastníka,
7. chybí review pro tento commit → čeká; vážné nálezy → čeká na opravu; review zařadilo změnu jako nevratnou → čeká na vlastníka,
8. neuplynula lhůta od prvního vyhodnocení tohoto commitu → čeká,
9. jinak → **samosloučí se** a dostane štítek `samoslouceno`.

Brána běží při každé změně PR a každou hodinu, takže PR se sloučí nejpozději hodinu po konci lhůty.

Testy brány: `node --test '.github/brana/test/*.test.mjs'`.

---

## Řešení potíží

**Průvodce hlásí, že token nemá oprávnění „workflow“.** Spusťte `gh auth refresh -s workflow`.

**Ruleset nejde založit (403, „Upgrade“).** U soukromých repozitářů na bezplatném účtu GitHub rulesety
nevynucuje. Repozitář zveřejněte, nebo použijte GitHub Pro či Team.

**Pod PR se neobjevilo review.** Podívejte se do *Actions → Brána → Review druhým modelem*. Žluté varování
„Review není nastavené“ znamená chybějící proměnné nebo klíč (krok 4). Chyba 401 nebo 404 od modelu
znamená špatný klíč, adresu nebo název modelu. Plánovaný běh každou hodinu review dohání.

**Brána píše „GitHub sloučení odmítl (405)“.** Ruleset nepustil sloučení, obvykle proto, že mezitím přišel
nový commit. Brána to zkusí při dalším běhu.

**Štítek `schvaleno` je u PR, ale brána pořád čeká.** Souhlas platil pro starší commit. Projděte novou verzi,
štítek odeberte a přidejte znovu.

**Odebrali jste štítek `stop` a PR se pořád nesloučí.** Stop odebral někdo jiný, než kdo ho přidal. Odeberte ho
jako vlastník: přidejte ho znovu a znovu odeberte.

**Po sloučení bránou se nespustilo nasazení.** Brána slučuje tokenem `GITHUB_TOKEN` a GitHub na jeho push
další workflow nespouští. Nasazení přes integraci hostingu (Vercel, Netlify) funguje. Nasazení přes GitHub
Actions potřebuje, aby brána slučovala tokenem samostatné GitHub App.

---

## Co je v sadě

| soubor | k čemu |
|---|---|
| `MANIFEST.md` | cíl, zákazy a rozpočet; čte ho agent i recenzent |
| `AGENTS.md`, `CLAUDE.md` | pravidla pro agenta (CLAUDE.md jen odkazuje na AGENTS.md) |
| `.github/pravidla.jsonc` | vlastník, vratné a nevratné cesty, lhůty, limit řádků, povinné testy |
| `.github/workflows/brana.yml` | review druhým modelem a rozhodnutí brány, každou hodinu dohání lhůty |
| `.github/workflows/souhrn.yml` | týdenní souhrn v pondělí ráno |
| `.github/workflows/testy-brany.yml` | testy brány při její změně |
| `.github/brana/` | kód brány bez závislostí (Node 20+) a jeho testy |
| `.github/ISSUE_TEMPLATE/zadani.yml`, `.github/pull_request_template.md` | formulář zadání a šablona PR |
| `nastaveni/onboarding.mjs` | průvodce nastavením |
| `nastaveni/nastav.sh`, `stitky.json`, `ruleset.json` | štítky a zamčení hlavní větve |
| `nastenka/` | volitelná nástěnka práce pro všechny repozitáře (Cloudflare Worker); v projektech ji nepotřebujete |
| `.github/workflows/testy-nastenky.yml` | testy nástěnky při její změně |

**Bezpečnostní poznámky:**

- **Brána běží z hlavní větve.** Spouští se přes `pull_request_target`, kód ani pravidla z větve PR nestahuje
  a diff čte přes API. Úprava brány v PR tak nemůže posoudit sama sebe.
- **Testy vašeho projektu kód z PR spouštějí.** Proto mají mít `permissions: contents: read`. Výchozí oprávnění
  nastaví průvodce.
- **Brána zapisuje stav commitu, ne check run.** Check run zapsaný přes API skončí ve starší sadě kontrol
  (check suite) a ruleset vidí jen nejnovější sadu aplikace. Po další události na PR by pak hlásil, že kontrola
  „Brána“ chybí. Při testování sady se to opravdu stalo.
- **Review je jen pojistka.** Recenzenta jde zmást textem v diffu. Proto o vratnosti rozhoduje seznam cest a model
  smí změnu zařadit jen přísněji.

---

## Co je ověřené a co ne

Ověřeno na soukromém testovacím repozitáři (listopad 2026):

- průvodce v režimu bez otázek: vlastník, push, štítky, ruleset, oprávnění workflow, issue „Začínáme“;
- průvodce s otázkami při opakovaném spuštění: hotové kroky přeskočí;
- ruleset odmítne přímý push do hlavní větve, i vlastníkovi;
- vratná změna s review se samosloučí a dostane `samoslouceno`, i po další události na PR;
- nevratná změna čeká na vlastníka a po `schvaleno` se sloučí;
- vratná změna s lhůtou 24 h čeká s časem sloučení;
- `stop` zastaví i schválený PR, po odebrání vlastníkem PR projde;
- souhlas na starším commitu po novém commitu neplatí;
- review s vážnými nálezy, review pro starší commit a review se zařazením „nevratné“ samosloučení nepustí;
- týdenní souhrn založí issue.

Neověřeno:

- **volání skutečného modelu** (v testu bylo review simulované komentářem automatiky);
- štítek `schvaleno` a odebrání `stop` od jiného účtu než vlastníka (test měl jen jeden účet);
- pokus aplikace agenta zapsat vlastní stav „Brána“ (ruleset ho má odmítnout, protože není od GitHub Actions);
- výběr recenzenta v průvodci a skrytý vstup klíče.
