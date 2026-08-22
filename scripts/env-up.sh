#!/usr/bin/env bash
# Levanta el backend que el backoffice necesita, reconstruyendo lo que cambió.
#
# Existe porque dos veces se concluyó que un endpoint "no existía" cuando lo que
# pasaba era que el contenedor corría una imagen vieja, o que el servicio no
# estaba arriba. Reconstruir es barato; depurar contra una imagen de hace dos
# días, no.
set -euo pipefail

SERVICES_DIR="${SERVICES_DIR:-$HOME/Documents/projects/fintech-services}"
GW_PORT="${GATEWAY_PORT:-8090}"
API="http://backoffice.localhost:${GW_PORT}"

cd "$SERVICES_DIR"

# Los que el backoffice consulta, directa o indirectamente.
DEPS=(postgres kafka redis identity-service party-service credit-product-service
      scoring-service origination-service credit-portfolio-service sales-org-service
      notifications-service payments-service charges-service collections-service
      wallet-service audit-service)

echo "▸ Levantando dependencias…"
docker compose up -d "${DEPS[@]}" >/dev/null

# audit-service entra a la reconstrucción por experiencia propia: su changeset
# `006-add-actor` llevaba tiempo sin aplicarse porque el contenedor corría una
# imagen anterior, y la columna `actor` —la que responde "quién lo hizo"— no
# existía en la tabla. El código decía una cosa y la base otra.
echo "▸ Reconstruyendo el BFF, auditoría y el gateway…"
docker compose build channel-backoffice-service audit-service >/dev/null
docker compose up -d --force-recreate channel-backoffice-service audit-service gateway-service >/dev/null

echo -n "▸ Esperando al BFF"
for _ in $(seq 1 60); do
  code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/auth/staff/login" \
         -H 'Content-Type: application/json' \
         -d '{"email":"admin@kredius.mx","password":"Backoffice#2026"}' || true)
  [ "$code" = "200" ] && { echo " ✓"; break; }
  echo -n "."; sleep 3
done
[ "${code:-}" = "200" ] || { echo " ✗ el BFF no respondió"; exit 1; }

TOKEN=$(curl -s -X POST "$API/auth/staff/login" -H 'Content-Type: application/json' \
        -d '{"email":"admin@kredius.mx","password":"Backoffice#2026"}' \
        | python3 -c 'import sys,json;print(json.load(sys.stdin)["accessToken"])')

echo "▸ Verificando lo que el front consume:"
for ep in /permissions/me /origination/applications /sales-org/units /audit/entries \
          /dashboard/summary /portfolio /clients /products /executives; do
  printf '   %-28s %s\n' "$ep" \
    "$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $TOKEN" "$API$ep")"
done

echo
echo "Listo. El front en vivo:  VITE_API_MODE=live VITE_BO_API_URL=$API ./run-dev.sh"
