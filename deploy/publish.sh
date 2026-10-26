#!/bin/sh
# Опубликовать CRM для сервера (из Git Bash в корне проекта):  sh deploy/publish.sh
# В закрытый репозиторий GitHub (remote «deploy») уходит ТОЛЬКО ветка prod — снимок закоммиченного HEAD
# из pb_hooks, pb_migrations, pb_public, deploy. Без тестов (там персональные данные), без истории, .autopilot и документов.
# Сервер сам забирает prod раз в 2 минуты (crm-update) и перезапускает CRM. Остальные ветки в deploy НЕ пушить.
set -eu
cd "$(dirname "$0")/.."
REMOTE=deploy
PATHS="pb_hooks pb_migrations pb_public deploy"

[ -z "$(git status --porcelain -- $PATHS)" ] || { echo "Есть незакоммиченные изменения в $PATHS — сначала коммит."; exit 1; }
git fetch -q "$REMOTE" prod 2>/dev/null || true
PARENT=$(git rev-parse -q --verify "refs/remotes/$REMOTE/prod" || true)

IDX=$(mktemp -u)
GIT_INDEX_FILE="$IDX" git read-tree --empty
git ls-tree -r --full-tree HEAD -- $PATHS | GIT_INDEX_FILE="$IDX" git update-index --index-info
TREE=$(GIT_INDEX_FILE="$IDX" git write-tree)
rm -f "$IDX"

if [ -n "$PARENT" ] && [ "$(git rev-parse "$PARENT^{tree}")" = "$TREE" ]; then echo "Изменений для сервера нет."; exit 0; fi
MSG="CRM $(git rev-parse --short HEAD): $(git log -1 --format=%s HEAD)"
if [ -n "$PARENT" ]; then C=$(git commit-tree "$TREE" -p "$PARENT" -m "$MSG"); else C=$(git commit-tree "$TREE" -m "$MSG"); fi
git push -q "$REMOTE" "$C:refs/heads/prod"
echo "Опубликовано: $MSG — сервер подхватит за ~2 минуты."
