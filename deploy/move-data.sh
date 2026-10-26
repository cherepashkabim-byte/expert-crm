#!/bin/sh
# Перенести данные CRM (pb_data: заказы, клиенты, деньги, фото, учётки) с этого компьютера на сервер. Один раз.
#   1) Остановите локальную CRM (закройте окно start.bat) — иначе часть заказов останется на компьютере.
#   2) sh deploy/move-data.sh IP
# На сервере служба останавливается, прежние данные откладываются в /opt/expert-crm/pb_data.before-<время>,
# затем CRM запускается уже с вашими данными. После этого работать только на сервере.
set -eu
HOST="${1:?Укажите IP сервера: sh deploy/move-data.sh 1.2.3.4}"
KEY="$HOME/.ssh/expert_crm"
SSH="ssh -i $KEY -o StrictHostKeyChecking=accept-new root@$HOST"
D=/opt/expert-crm

cd "$(dirname "$0")/.."
[ -f pb_data/data.db ] || { echo "Нет pb_data/data.db — нечего переносить"; exit 1; }
if powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort 8090 -State Listen -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }" 2>/dev/null; then
  echo "Локальная CRM ещё работает (порт 8090). Закройте окно start.bat и запустите снова."; exit 1
fi

echo "Переношу данные на $HOST…"
tar czf - --exclude=pb_data/types.d.ts pb_data | $SSH "set -e
  systemctl stop expert-crm 2>/dev/null || true
  [ -d $D/pb_data ] && mv $D/pb_data $D/pb_data.before-\$(date +%Y%m%d-%H%M%S)
  tar xzf - -C $D
  chown -R crm:crm $D
  systemctl start expert-crm
  sleep 3
  systemctl is-active expert-crm"
echo "Готово. Локальную CRM больше не запускайте — работаем на сервере."
