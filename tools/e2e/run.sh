#!/usr/bin/env bash
# Corre el harness completo: siembra, permisos, journey y navegador.
#
# El orden importa y no es arbitrario. El navegador va al final porque comprueba que la consola
# *muestre* lo que los pasos anteriores crearon; correrlo primero probaría una pantalla vacía y
# pasaría en verde sin haber verificado nada.
#
#   ./run.sh              todo
#   ./run.sh --no-browser solo curl (útil en CI sin navegador)
#   ./run.sh --browser    solo navegador (el backend ya está sembrado)

set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
source ./lib.sh

RUN_CURL=1
RUN_BROWSER=1
case "${1:-}" in
  --no-browser) RUN_BROWSER=0 ;;
  --browser)    RUN_CURL=0 ;;
  --help|-h)    sed -n '2,12p' "$0"; exit 0 ;;
esac

WEB_ROOT="$(cd ../.. && pwd)"
FAILED=0

# ── el entorno responde ──────────────────────────────────────────────────────
step "Comprobación previa del entorno"
# Se sondea el login con credenciales vacías en vez de /actuator/health: el gateway protege los
# actuators tras la barrera del canal, así que un 401 ahí no distingue "el BFF está caído" de
# "el BFF está bien y no me dejó pasar". Un 400 del login sí prueba que la cadena completa
# —gateway, ruta, BFF, validación— está en pie.
_http POST "$BO_HOST" /auth/staff/login '' '{}'
case "$HTTP_STATUS" in
  400|401|422|429) ok "gateway → BFF de backoffice responde en ${GATEWAY_HOST}:${GATEWAY_PORT} (HTTP $HTTP_STATUS)" ;;
  *) die "el BFF no responde por el gateway (HTTP $HTTP_STATUS). ¿Están arriba los contenedores?
   cd $COMPOSE_DIR && docker compose up -d" ;;
esac

if (( RUN_CURL )); then
  for script in 01-seed.sh 02-rbac.sh 03-journey.sh; do
    printf '\n%s══ %s ══%s\n' "$C_BOLD" "$script" "$C_RESET"
    if bash "./$script"; then
      printf '%s%s en verde%s\n' "$C_GREEN" "$script" "$C_RESET"
    else
      printf '%s%s con fallos%s\n' "$C_RED" "$script" "$C_RESET"
      FAILED=1
    fi
  done
fi

if (( RUN_BROWSER )); then
  printf '\n%s══ navegador ══%s\n' "$C_BOLD" "$C_RESET"

  # Las pruebas necesitan los cinco servidores de Vite (shell + 4 remotos). Se levantan aquí si no
  # están: dejarlo al operador es la forma segura de que la suite falle por algo que no es la
  # aplicación.
  started_dev=0
  if ! curl -sf -m 3 http://localhost:4200 >/dev/null 2>&1; then
    info "levantando los servidores de desarrollo…"
    ( cd "$WEB_ROOT" && ./run-dev.sh > "$ARTIFACT_DIR/dev-servers.log" 2>&1 ) &
    DEV_PID=$!
    started_dev=1
    for _ in $(seq 1 60); do
      curl -sf -m 2 http://localhost:4200 >/dev/null 2>&1 && break
      sleep 1
    done
    curl -sf -m 2 http://localhost:4200 >/dev/null 2>&1 \
      || { warn "los servidores de desarrollo no arrancaron; ver $ARTIFACT_DIR/dev-servers.log"; FAILED=1; }
  else
    info "servidores de desarrollo ya en marcha"
  fi

  ( cd "$WEB_ROOT" && npx playwright test ) || FAILED=1

  if (( started_dev )); then
    info "deteniendo los servidores de desarrollo"
    kill "$DEV_PID" 2>/dev/null || true
    pkill -f "vite --port 41\|vite --port 51" 2>/dev/null || true
  fi

  info "vídeos y trazas en $ARTIFACT_DIR/browser"
  info "reporte navegable: npx playwright show-report tools/e2e/.artifacts/report"
fi

printf '\n%s────────────────────────────────────────%s\n' "$C_DIM" "$C_RESET"
if (( FAILED )); then
  printf '%sHubo fallos. El detalle está arriba y en %s%s\n\n' "$C_RED$C_BOLD" "$ARTIFACT_DIR" "$C_RESET"
  exit 1
fi
printf '%sTodo en verde. Evidencia en %s%s\n\n' "$C_GREEN$C_BOLD" "$ARTIFACT_DIR" "$C_RESET"
