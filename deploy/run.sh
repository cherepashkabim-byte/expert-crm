#!/bin/sh
# Запуск CRM на сервере (зовёт служба expert-crm). Переменные — из /etc/expert-crm.env:
# CRM_DOMAIN пусто — http на порту 80 (по IP); задан — PocketBase сам получает HTTPS-сертификат и слушает 80 и 443.
D=/opt/expert-crm
set -- --dir="$D/pb_data" --hooksDir="$D/pb_hooks" --migrationsDir="$D/pb_migrations" --publicDir="$D/pb_public"
if [ -n "${CRM_DOMAIN:-}" ]; then
  exec "$D/bin/pocketbase" serve "$CRM_DOMAIN" "$@"
fi
exec "$D/bin/pocketbase" serve --http=0.0.0.0:80 "$@"
