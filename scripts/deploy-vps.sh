#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/root/nanopaquete}"
WEB_DIR="${WEB_DIR:-/var/www/nanopaquete}"
BRANCH="${BRANCH:-main}"
SERVICE_NAME="${SERVICE_NAME:-nanopaquete-api.service}"

echo "Entrando a ${APP_DIR}"
cd "$APP_DIR"

echo "Descargando cambios desde GitHub (${BRANCH})"
git fetch origin "$BRANCH"
git pull --ff-only origin "$BRANCH"

echo "Instalando dependencias"
npm install

echo "Construyendo frontend"
npm run build

echo "Publicando archivos web en ${WEB_DIR}"
install -d "$WEB_DIR"
find "$WEB_DIR" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
cp -a dist/. "$WEB_DIR/"

echo "Reiniciando API (${SERVICE_NAME})"
systemctl restart "$SERVICE_NAME"

echo "Recargando Nginx"
nginx -t
systemctl reload nginx

echo "Verificando servicios"
systemctl is-active --quiet "$SERVICE_NAME"
systemctl is-active --quiet nginx

for attempt in {1..10}; do
  if curl -fsS http://127.0.0.1:8789/api/health; then
    printf '\n'
    break
  fi

  if [ "$attempt" -eq 10 ]; then
    echo "La API no respondio despues del reinicio."
    exit 1
  fi

  sleep 1
done
printf '\n'

echo "Despliegue completado"
