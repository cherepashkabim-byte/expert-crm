#!/bin/sh
# На сервере, из клона ветки prod в /opt/src.
#   sh /opt/src/deploy/server-install.sh         — первая установка: setup.sh + код + служба + автообновление
#   sh /opt/src/deploy/server-install.sh --code  — только код и перезапуск (зовёт crm-update)
set -eu
S=/opt/src
D=/opt/expert-crm
FULL=1; [ "${1:-}" = "--code" ] && FULL=0

[ "$FULL" = 1 ] && sh "$S/deploy/setup.sh"

for d in pb_hooks pb_migrations pb_public; do rm -rf "$D/$d"; cp -r "$S/$d" "$D/$d"; done
install -m 755 "$S/deploy/run.sh" "$D/run.sh"
install -m 644 "$S/deploy/expert-crm.service" /etc/systemd/system/expert-crm.service
chown -R crm:crm "$D"

if [ "$FULL" = 1 ]; then
  install -m 755 "$S/deploy/crm-update.sh" /usr/local/bin/crm-update
  printf '%s\n' '[Unit]' 'Description=CRM Expert: pull prod from GitHub' '[Service]' 'Type=oneshot' 'ExecStart=/usr/local/bin/crm-update' \
    > /etc/systemd/system/crm-update.service
  printf '%s\n' '[Unit]' 'Description=CRM Expert: check updates every 2 minutes' '[Timer]' 'OnBootSec=1min' 'OnUnitActiveSec=2min' \
    '[Install]' 'WantedBy=timers.target' > /etc/systemd/system/crm-update.timer
fi

systemctl daemon-reload
systemctl enable expert-crm >/dev/null 2>&1
systemctl restart expert-crm
[ "$FULL" = 1 ] && systemctl enable --now crm-update.timer >/dev/null 2>&1
sleep 3
if systemctl is-active -q expert-crm; then echo "CRM РАБОТАЕТ: http://$(hostname -I | cut -d' ' -f1)/"; else echo "ОШИБКА запуска CRM:"; journalctl -u expert-crm -n 20 --no-pager; fi
