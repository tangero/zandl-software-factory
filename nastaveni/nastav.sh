#!/usr/bin/env bash
# Založí štítky a ruleset hlavní větve. Spouští vlastník repozitáře (potřebuje práva správce):
#   bash nastaveni/nastav.sh vlastnik/repozitar
set -euo pipefail
REPO="${1:?Zadejte repozitář ve tvaru vlastnik/nazev}"
cd "$(dirname "$0")"

node -e '
  for (const s of require("./stitky.json")) console.log([s.name, s.color, s.description].join("\t"));
' | while IFS=$'\t' read -r nazev barva popis; do
  gh label create "$nazev" --repo "$REPO" --color "$barva" --description "$popis" --force
done

if gh api "repos/$REPO/rulesets" --jq '.[].name' | grep -qx "Ochrana hlavní větve"; then
  echo "Ruleset „Ochrana hlavní větve“ už existuje, nechávám ho být."
else
  gh api -X POST "repos/$REPO/rulesets" --input ruleset.json --jq '"Ruleset založen: " + .name'
fi

# Výchozí oprávnění GITHUB_TOKEN jen pro čtení: workflow, která spouštějí kód z PR (testy),
# pak nemohou zapsat kontrolu „Brána“ ani nic sloučit. Workflow brány si práva zvyšuje samo.
gh api -X PUT "repos/$REPO/actions/permissions/workflow" -f default_workflow_permissions=read -F can_approve_pull_request_reviews=false
echo "Hotovo. Další kroky: README, krok 4 (review) a krok 5 (proměnné)."
