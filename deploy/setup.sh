#!/bin/sh
# Первичная настройка сервера (Ubuntu 24.04/26.04) — запускается один раз от root:
#   ssh -i ~/.ssh/expert_crm root@IP 'sh -s' < deploy/setup.sh
# Ставит PocketBase той же версии, что start.ps1, создаёт пользователя crm, папку /opt/expert-crm,
# службу expert-crm и брандмауэр (открыты только 22, 80, 443). Повторный запуск безопасен.
set -eu
VER=0.40.4
D=/opt/expert-crm

export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q unzip ufw curl

id crm >/dev/null 2>&1 || useradd --system --home-dir "$D" --shell /usr/sbin/nologin crm
mkdir -p "$D/bin" "$D/pb_data" "$D/pb_hooks" "$D/pb_migrations" "$D/pb_public"

if ! "$D/bin/pocketbase" --version 2>/dev/null | grep -q "$VER"; then
  ARCH=amd64; [ "$(uname -m)" = "aarch64" ] && ARCH=arm64
  curl -fsSL -o /tmp/pb.zip "https://github.com/pocketbase/pocketbase/releases/download/v$VER/pocketbase_${VER}_linux_${ARCH}.zip"
  unzip -o -q /tmp/pb.zip pocketbase -d "$D/bin"
  rm -f /tmp/pb.zip
  chmod 755 "$D/bin/pocketbase"
fi

# Настройки службы: создаются один раз, дальше правятся вручную (там же ключ sms.ru — в git его нет).
if [ ! -f /etc/expert-crm.env ]; then
  printf '%s\n' '# CRM «Эксперт». Пусто — работа по IP (http, порт 80). Домен — HTTPS сам (Let'"'"'s Encrypt).' \
    'CRM_DOMAIN=' '# Ключ sms.ru (пусто — СМС не отправляются).' 'SMS_RU_API_ID=' > /etc/expert-crm.env
  chmod 600 /etc/expert-crm.env
fi

chown -R crm:crm "$D"

ufw allow 22/tcp >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null

echo "Готово: PocketBase $("$D/bin/pocketbase" --version), папка $D. Служба ставится в push.sh вместе с кодом."
