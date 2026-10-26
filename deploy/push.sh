#!/bin/sh
# Выложить текущую версию CRM на сервер (из Git Bash в корне проекта):
#   sh deploy/push.sh IP
# Копирует pb_hooks, pb_migrations, pb_public и службу, перезапускает CRM (миграции применяются при старте).
# Данные (pb_data) НЕ трогает — их переносит deploy/move-data.sh один раз.
set -eu
HOST="${1:?Укажите IP сервера: sh deploy/push.sh 1.2.3.4}"
KEY="$HOME/.ssh/expert_crm"
SSH="ssh -i $KEY -o StrictHostKeyChecking=accept-new root@$HOST"
D=/opt/expert-crm

cd "$(dirname "$0")/.."
echo "Отправляю код на $HOST…"
tar czf - pb_hooks pb_migrations pb_public deploy/expert-crm.service deploy/run.sh | $SSH "set -e
  mkdir -p /tmp/crm-new && rm -rf /tmp/crm-new/* && tar xzf - -C /tmp/crm-new
  for d in pb_hooks pb_migrations pb_public; do rm -rf $D/\$d && mv /tmp/crm-new/\$d $D/\$d; done
  install -m 755 /tmp/crm-new/deploy/run.sh $D/run.sh
  install -m 644 /tmp/crm-new/deploy/expert-crm.service /etc/systemd/system/expert-crm.service
  rm -rf /tmp/crm-new
  chown -R crm:crm $D
  systemctl daemon-reload
  systemctl enable expert-crm >/dev/null 2>&1
  systemctl restart expert-crm
  sleep 3
  systemctl is-active expert-crm"
echo "Готово."
