#!/usr/bin/env bash
# Global pre-commit-hook (aktivert med core.hooksPath i ~/.config/git/config).
#
# Git har bare én core.hooksPath, så en global verdi slår repoets egen. Det er
# med vilje: en hook i hjemmemappa di skal ikke kunne overta et repo. Men det
# gir et gap når repoet har en hook den ikke får kjørt — agent-init skriver
# `.githooks/pre-commit` i repoet den scaffolder, ser at core.hooksPath alt
# peker hit, og rapporterer «not activated» i stedet for å ta over.
#
# Dette skriptet lukker gapet ved å gjøre det motsatte av å ta over: den kjører
# repoets egen hook når den finnes, og gjør ellers ingenting. Samme mønster som
# pre-push her ved siden av, utvidet til å lete begge stedene en repo-hook kan
# ligge — agent-init legger sin i `.githooks/`, ikke i `$GIT_DIR/hooks/`.
#
# Styring:
#   KROK_KJEDE=1   settes på barnet, så en hook som peker tilbake ikke looper
#
# Hooken feiler åpent: finnes ingen repo-hook å kjede til, går commiten
# gjennom. En hook i hjemmemappa di skal ikke blokkere arbeid i et vilkårlig
# repo av en grunn den ikke kan forklare.

set -uo pipefail

log() { printf 'pre-commit: %s\n' "$*"; }

# Rekursjonsvern. Kalles denne på nytt nedenfra — en repo-hook som lenker hit,
# eller en core.hooksPath som peker hit igjen — stopper kjeden her.
if [ "${KROK_KJEDE:-0}" = "1" ]; then
  exit 0
fi

common_dir=$(git rev-parse --git-common-dir 2>/dev/null) || exit 0
top=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0

# --git-common-dir er relativ til arbeidsmappa når den ikke er absolutt.
case "$common_dir" in
  /*) ;;
  *) common_dir="$PWD/$common_dir" ;;
esac

# Repoets egen hook, i den rekkefølgen den er mest sannsynlig å ligge i.
# `.githooks/` først: det er konvensjonen agent-init skriver, og den eneste en
# global core.hooksPath kan ha gjort uoppnåelig. Deretter Gits eget sted, som
# er det pre-push her ved siden av leter i. Den første som kan kjøres avgjør:
# å kjøre to pre-commit-hooker etter hverandre ville kjørt `git diff --cached`
# to ganger og gjort en feilende sjekk vanskelig å tilskrive.
for candidate in "$top/.githooks/pre-commit" "$common_dir/hooks/pre-commit"; do
  if [ -f "$candidate" ] && [ -x "$candidate" ]; then
    if ! KROK_KJEDE=1 "$candidate" "$@"; then
      log "repoets egen pre-commit stoppet commiten: $candidate"
      exit 1
    fi
    exit 0
  fi
done

exit 0
