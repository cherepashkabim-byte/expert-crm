#!/bin/sh
# Автообновление CRM на сервере (таймер crm-update.timer, раз в 2 минуты): забирает ветку prod из GitHub
# и, если она изменилась, ставит новый код и перезапускает CRM. Данные (pb_data) не трогает.
set -eu
cd /opt/src
git fetch -q origin prod
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/prod)" ] && exit 0
git reset -q --hard origin/prod
sh /opt/src/deploy/server-install.sh --code
echo "CRM обновлена: $(git log -1 --format=%s)"
