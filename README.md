# Startovací sada: AI agent na vašem GitHubu bez věčného schvalování

Sada souborů, se kterou si nad svým repozitářem na GitHubu rozchodíte AI agenta, který píše kód, a bránu,
která rozhoduje, co se sloučí. Platí jedno pravidlo:

> **Vratná změna se samosloučí. Nevratná čeká na vás.**
>
> PR se sloučí sám, když mění jen vratné soubory, druhý model v něm nenašel vážné nálezy, prošly
> testy a během lhůty nikdo nepřidal `stop`. Takový PR dostane štítek `samoslouceno`. Všechno ostatní
> čeká na váš štítek `schvaleno`. Jednou týdně projdete souhrn a vyberete, co vrátit.

Proč obráceně? Když člověk schvaluje dvacet PR denně, přestane je číst a štítek `schvaleno` pak nic
neznamená. Brána proto pozornost šetří na to, co revert nevrátí.

**Vratné** znamená „jde vrátit revertem i s následky“. Kód stránky z webu sundáte za minutu. Odeslaný
e-mail, platbu, smazaná data ani uniklé údaje revert nevrátí. Které soubory jsou vratné, určuje seznam cest
v `.github/pravidla.jsonc`, ne model. Model smí změnu zařadit jen přísněji.

## Co je v sadě

| soubor | k čemu |
|---|---|
| `MANIFEST.md` | cíl, zákazy a rozpočet; čte ho agent i recenzent |
| `AGENTS.md`, `CLAUDE.md` | pravidla pro agenta (CLAUDE.md jen odkazuje na AGENTS.md) |
| `.github/pravidla.jsonc` | kdo je vlastník, vratné a nevratné cesty, lhůty, limit řádků, povinné testy |
| `.github/workflows/brana.yml` | review druhým modelem a rozhodnutí brány; každou hodinu dohání lhůty |
| `.github/workflows/souhrn.yml` | týdenní souhrn v pondělí ráno |
| `.github/brana/` | kód brány bez závislostí (Node 20+) a jeho testy |
| `.github/ISSUE_TEMPLATE/zadani.yml`, `.github/pull_request_template.md` | formulář zadání a šablona PR |
| `nastaveni/` | štítky, ruleset hlavní větve a skript, který je založí |

## Jak si to vyzkoušet

### 1. Agent s vlastním účtem

Agent musí pracovat pod vlastní identitou, ne pod vaším účtem. Jinak by jeho štítek `schvaleno`
vypadal jako váš. Použijte agenta, který se k repozitáři připojuje jako **GitHub App** (například Claude Code,
OpenAI Codex nebo jiný kódovací agent s aplikací pro GitHub), nebo mu založte samostatný účet.

Oprávnění aplikace agenta zkontrolujte v *Settings → Integrations → GitHub Apps*:

- **Contents, Pull requests, Issues: Read and write.** Tolik agent potřebuje.
- **Workflows: žádné.** Tohle je podmínka, bez které brána nefunguje. S tímto oprávněním by si agent
  mohl v PR přidat vlastní workflow, které zapíše zelenou kontrolu „Brána“ a PR sloučí.
- **Administration, Checks, Commit statuses, Secrets, Variables: žádné.**

Když aplikace agenta oprávnění Workflows vyžaduje, tuto sadu s ní nepoužívejte.

### 2. Sada do repozitáře, štítky a tabule

Zkopírujte soubory sady do kořene repozitáře (nebo založte nový přes *Use this template*), v
`.github/pravidla.jsonc` nahraďte `VAS-GITHUB-LOGIN` svým loginem a upravte vratné cesty podle projektu.
Pak spusťte jako vlastník:

```bash
bash nastaveni/nastav.sh vas-login/vas-repozitar
```

Skript založí štítky, ruleset hlavní větve a nastaví výchozí oprávnění workflow jen pro čtení.

Tabuli, na které uvidíte, jak se práce posouvá, si založte ručně: *Projects → New project → Board*
a zapněte vestavěné automatizace (nové issue → Todo, otevřený PR → In progress, sloučený PR → Done).

### 3. Cíl a meze

Vyplňte `MANIFEST.md`: co má vzniknout, co je zakázané (každý zákaz jako zákaz: „Nikdy neposílej…“)
a kolik smí agent prohrát na pokusech v penězích i v počtu PR. Do `AGENTS.md` sáhněte, jen když potřebujete
pravidla práce změnit.

### 4. Oddělené role: review druhým modelem

Kdo kód píše, ten ho nekontroluje. Review dělá model jiného výrobce, než jaký používá agent. Brána ho volá
přes rozhraní kompatibilní s OpenAI Chat Completions, které nabízí většina výrobců i agregátorů.
V *Settings → Secrets and variables → Actions* nastavte:

| typ | název | hodnota |
|---|---|---|
| secret | `REVIEW_API_KEY` | klíč k API recenzenta |
| variable | `REVIEW_API_URL` | adresa endpointu `.../chat/completions` |
| variable | `REVIEW_MODEL` | název modelu |

Zadání pro recenzenta je v `.github/brana/review-zadani.md`. Review se váže na konkrétní commit: každý
nový commit dostane nové review a lhůta běží znovu.

### 5. Zamčená hlavní větev

Ruleset z kroku 2 platí bez výjimek, i pro vás: do hlavní větve jde jen přes PR a jen se zelenou kontrolou
„Brána“ od aplikace GitHub Actions. Soubory s pravidly (`.github/`, `MANIFEST.md`, `AGENTS.md`) jsou
nevratné cesty, takže jejich změna se sloučí jen s vaším `schvaleno`. To platí i pro vaše vlastní PR.

Jak brána zachází se štítky:

- `schvaleno` platí jen od účtu z `vlastnici` a jen pro commit, na kterém jste ho přidali.
  Nový commit souhlas zruší. Štítek od kohokoli jiného brána odebere.
- `stop` zastaví sloučení čehokoli. Odebrat ho smí jen ten, kdo ho přidal, nebo vlastník.
  Jinak platí dál.
- `samoslouceno` přidává jen brána po sloučení.

**Vypínač:** proměnná repozitáře `SAMOSLUCOVANI` s hodnotou `vypnuto` okamžitě zastaví samoslučování.
Potom se všechno slučuje jen se `schvaleno`. Agent k proměnným přístup nemá.

### 6. Jeden vratný proces, aspoň týden

Začněte procesem, kde chyba nic nestojí: dokumentace a odpovědi na časté dotazy, texty webu, sběr a čištění
dat do repozitáře. Platby, smlouvy a hromadné rozesílky si nechte. V pravidlech je nemějte mezi vratnými
cestami. Lhůty nastavte zpočátku delší, třeba 24 hodin pro kód a 0 pro dokumentaci, a nechte to běžet
aspoň týden.

### 7. Měření

Každé pondělí brána založí issue **Týdenní souhrn**. Obsahuje, co se samosloučilo, co jste schválili, kde
někdo dal `stop` a co se vracelo revertem, plus jednu náhodně vybranou samosloučenou změnu k přečtení celé.
Do tabulky v souhrnu doplňte čtyři čísla:

- váš čas na projektu před zavedením a po něm,
- nápady agenta, které přišly bez vašeho podnětu,
- chyby, které prošly do produkce,
- cenu za hotový výsledek.

Když je počet vet a revertů týdny na nule, jsou dvě možnosti: agent pracuje dobře, nebo souhrn nikdo nečte.
Rozliší je právě ta náhodně vybraná změna.

## Jak brána rozhoduje

V tomto pořadí (kód: `.github/brana/pravidla.mjs`):

1. aktivní `stop` → zastaveno,
2. rozpracovaný PR (draft) → čeká,
3. povinné testy z `pozadovaneKontroly` neprošly, běží nebo chybí → zastaveno nebo čeká,
4. platné `schvaleno` od vlastníka pro tento commit → **sloučí se**,
5. vypínač `SAMOSLUCOVANI=vypnuto` → čeká na vlastníka,
6. jakákoli nevratná cesta (i původní cesta přejmenovaného souboru) nebo víc řádků než `maxRadku` → čeká na vlastníka,
7. chybí review pro tento commit → čeká; vážné nálezy → čeká na opravu; review změnu zařadilo jako nevratnou → čeká na vlastníka,
8. neuplynula lhůta od prvního vyhodnocení tohoto commitu → čeká,
9. jinak → **samosloučí se** a dostane štítek `samoslouceno`.

Testy brány: `node --test '.github/brana/test/*.test.mjs'`.

## Na co pozor

- **Workflow z PR se nespouštějí s právem zápisu.** Brána běží přes `pull_request_target` z hlavní větve a kód
  z PR nestahuje. Vaše testy na `pull_request` kód z PR spouštějí, proto mají mít `permissions: contents: read`.
- **Sloučení bránou nespustí workflow na hlavní větvi.** Brána slučuje tokenem `GITHUB_TOKEN` a GitHub
  na jeho push další workflow nespouští. Nasazení přes integraci hostingu (Vercel, Netlify) funguje.
  Nasazení přes GitHub Actions potřebuje, aby brána slučovala tokenem samostatné GitHub App.
- **Review je jen pojistka.** Recenzenta jde zmást textem v diffu. Proto o vratnosti rozhoduje seznam cest
  a model smí změnu zařadit jen přísněji.
- **Tahle sada zatím neprošla ověřením na skutečném repozitáři.** Logika brány má testy, ruleset vychází
  z nastavení, které funguje v provozu. Celý běh (ruleset, workflow, sloučení) si nejdřív vyzkoušejte
  na testovacím repozitáři.
