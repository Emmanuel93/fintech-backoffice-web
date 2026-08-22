#!/usr/bin/env bash
# Utilidades comunes del harness end-to-end del backoffice.
#
# Hay dos planos de llamadas y la distinción no es cosmética:
#
#   · PLANO DE VERIFICACIÓN  — todo lo que la consola ve pasa por el gateway hacia el BFF de
#     backoffice (`bo_*`). Si una aserción sobre lo que muestra el backoffice no sale por aquí,
#     la prueba no está probando el backoffice.
#
#   · PLANO DE SIMULACIÓN    — para que haya algo que ver, alguien tiene que originar el crédito
#     y alguien tiene que correr los procesos batch. Eso lo hacen el cliente (BFF móvil, `mob_*`)
#     y los jobs (`svc_*`, dentro de la red de Docker). No son atajos del backoffice: son los
#     otros actores del sistema, y por eso jamás se usan para *afirmar* algo.
#
# Los servicios de dominio no publican puerto fuera de la red de Docker —esa es justamente la
# garantía de que el navegador no puede saltarse el BFF—, así que `svc_*` entra por un contenedor
# efímero en la misma red en vez de por localhost.

set -uo pipefail

# ── configuración ────────────────────────────────────────────────────────────
GATEWAY_HOST="${GATEWAY_HOST:-localhost}"
GATEWAY_PORT="${GATEWAY_PORT:-8090}"
BO_HOST="${BO_HOST:-backoffice.localhost}"
MOBILE_HOST="${MOBILE_HOST:-mobile.localhost}"
COMPOSE_DIR="${COMPOSE_DIR:-/Users/emmanuelhernandez/Documents/projects/fintech-services}"
DOCKER_NETWORK="${DOCKER_NETWORK:-fintech-services_fintech-network}"
CURL_IMAGE="${CURL_IMAGE:-curlimages/curl:8.10.1}"

ADMIN_EMAIL="${ADMIN_EMAIL:-admin@kredius.mx}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-Backoffice#2026}"
STAFF_PASSWORD="${STAFF_PASSWORD:-Backoffice#2026}"

ARTIFACT_DIR="${ARTIFACT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/.artifacts}"
mkdir -p "$ARTIFACT_DIR"

# ── salida ───────────────────────────────────────────────────────────────────
if [[ -t 1 ]]; then
  C_RESET=$'\033[0m'; C_DIM=$'\033[2m'; C_RED=$'\033[31m'; C_GREEN=$'\033[32m'
  C_YELLOW=$'\033[33m'; C_BLUE=$'\033[34m'; C_BOLD=$'\033[1m'
else
  C_RESET=''; C_DIM=''; C_RED=''; C_GREEN=''; C_YELLOW=''; C_BLUE=''; C_BOLD=''
fi

PASS_COUNT=0
FAIL_COUNT=0
declare -a FAILURES=()

step()  { printf '\n%s▸ %s%s\n' "$C_BOLD$C_BLUE" "$*" "$C_RESET"; }
info()  { printf '  %s%s%s\n' "$C_DIM" "$*" "$C_RESET"; }
ok()    { PASS_COUNT=$((PASS_COUNT + 1)); printf '  %s✓%s %s\n' "$C_GREEN" "$C_RESET" "$*"; }
fail()  { FAIL_COUNT=$((FAIL_COUNT + 1)); FAILURES+=("$*"); printf '  %s✗ %s%s\n' "$C_RED" "$*" "$C_RESET"; }
warn()  { printf '  %s! %s%s\n' "$C_YELLOW" "$*" "$C_RESET"; }
die()   { printf '\n%s✗ %s%s\n\n' "$C_RED$C_BOLD" "$*" "$C_RESET"; exit 1; }

summary() {
  printf '\n%s────────────────────────────────────────%s\n' "$C_DIM" "$C_RESET"
  if (( FAIL_COUNT == 0 )); then
    printf '%s%d comprobaciones, todas en verde%s\n\n' "$C_GREEN$C_BOLD" "$PASS_COUNT" "$C_RESET"
    return 0
  fi
  printf '%s%d en verde, %d en rojo:%s\n' "$C_BOLD" "$PASS_COUNT" "$FAIL_COUNT" "$C_RESET"
  for f in "${FAILURES[@]}"; do printf '  %s· %s%s\n' "$C_RED" "$f" "$C_RESET"; done
  printf '\n'
  return 1
}

need() { command -v "$1" >/dev/null 2>&1 || die "hace falta '$1' en el PATH"; }

# ── HTTP ─────────────────────────────────────────────────────────────────────
# Cada llamada deja el status en HTTP_STATUS y el cuerpo en HTTP_BODY. Se separan porque casi
# todas las aserciones interesantes son sobre el status *y* sobre el contenido: un 200 con la
# lista vacía y un 403 son fallos distintos y hay que poder distinguirlos en el reporte.
HTTP_STATUS=0
HTTP_BODY=''

_http() {
  local method="$1" host="$2" path="$3" token="${4:-}" body="${5:-}"
  local -a args=(-sS -m 30 -X "$method" -H "Host: $host" -H 'Content-Type: application/json')
  [[ -n "$token" ]] && args+=(-H "Authorization: Bearer $token")
  [[ -n "$body"  ]] && args+=(--data "$body")

  local tmp; tmp="$(mktemp)"
  HTTP_STATUS="$(curl "${args[@]}" -o "$tmp" -w '%{http_code}' \
    "http://${GATEWAY_HOST}:${GATEWAY_PORT}${path}" 2>>"$ARTIFACT_DIR/curl-errors.log")" || HTTP_STATUS=0
  HTTP_BODY="$(cat "$tmp")"
  rm -f "$tmp"
  printf '%s %s%s -> %s\n' "$method" "$host" "$path" "$HTTP_STATUS" >> "$ARTIFACT_DIR/http.log"
}

# Plano de verificación: lo que ve la consola. Toda aserción del backoffice pasa por aquí.
bo_get()    { _http GET    "$BO_HOST" "$1" "${2:-$BO_TOKEN}"; }
bo_post()   { _http POST   "$BO_HOST" "$1" "${3:-$BO_TOKEN}" "${2:-}"; }
bo_put()    { _http PUT    "$BO_HOST" "$1" "${3:-$BO_TOKEN}" "${2:-}"; }

# Plano de simulación: el cliente en la app.
mob_post()  { _http POST   "$MOBILE_HOST" "$1" "${3:-}" "${2:-}"; }
mob_get()   { _http GET    "$MOBILE_HOST" "$1" "${2:-}"; }

# Plano de simulación: servicios de dominio y jobs, dentro de la red de Docker.
# No tienen puerto publicado a propósito — es lo que impide que el navegador los alcance.
svc() {
  local method="$1" url="$2" body="${3:-}"
  local -a args=(-sS -m 30 -X "$method" -H 'Content-Type: application/json'
                 -H 'X-User-Id: 00000000-0000-0000-0000-0000000000e2'
                 -H 'X-Roles: ADMIN' -H 'X-Channel: SERVICE')
  [[ -n "$body" ]] && args+=(--data "$body")

  # El status va en la última línea para no tener que recortar bytes del cuerpo.
  local out
  out="$(docker run --rm --network "$DOCKER_NETWORK" "$CURL_IMAGE" \
        "${args[@]}" -w '\n%{http_code}' "$url" 2>>"$ARTIFACT_DIR/curl-errors.log")" || { HTTP_STATUS=0; HTTP_BODY=''; return 1; }
  HTTP_STATUS="${out##*$'\n'}"
  HTTP_BODY="${out%$'\n'*}"
  printf '%s %s -> %s\n' "$method" "$url" "$HTTP_STATUS" >> "$ARTIFACT_DIR/http.log"
}

# Espera a que un servicio de dominio acepte tráfico.
#
# Un contenedor "Up" no significa "listo": Spring tarda segundos en abrir el puerto, y una llamada
# en esa ventana devuelve 0 (conexión rechazada). Sin esta compuerta, un journey lanzado justo
# después de `docker compose up` falla en el primer paso y arrastra todos los demás — y el reporte
# culpa a la lógica de negocio de algo que solo era arranque.
wait_service() {
  local name="$1" url="$2" attempts="${3:-30}" i
  for (( i = 1; i <= attempts; i++ )); do
    svc GET "$url/actuator/health" >/dev/null 2>&1
    case "$HTTP_STATUS" in
      200|401|403) return 0 ;;   # responde: con o sin permiso, el puerto está abierto
    esac
    sleep 2
  done
  return 1
}

# ── JSON ─────────────────────────────────────────────────────────────────────
jget()  { printf '%s' "$HTTP_BODY" | jq -r "$1" 2>/dev/null; }
jgetf() { printf '%s' "$1" | jq -r "$2" 2>/dev/null; }

# ── aserciones ───────────────────────────────────────────────────────────────
expect_status() {
  local want="$1" what="$2"
  if [[ "$HTTP_STATUS" == "$want" ]]; then
    ok "$what (HTTP $HTTP_STATUS)"
  else
    fail "$what — esperaba HTTP $want, llegó $HTTP_STATUS: $(printf '%s' "$HTTP_BODY" | head -c 200)"
  fi
}

expect_status_in() {
  local want="$1" what="$2"
  if [[ " $want " == *" $HTTP_STATUS "* ]]; then
    ok "$what (HTTP $HTTP_STATUS)"
  else
    fail "$what — esperaba uno de [$want], llegó $HTTP_STATUS: $(printf '%s' "$HTTP_BODY" | head -c 200)"
  fi
}

expect_eq() {
  local got="$1" want="$2" what="$3"
  if [[ "$got" == "$want" ]]; then ok "$what = $want"; else fail "$what — esperaba '$want', llegó '$got'"; fi
}

expect_not_empty() {
  local got="$1" what="$2"
  if [[ -n "$got" && "$got" != "null" ]]; then ok "$what presente ($got)"; else fail "$what vacío"; fi
}

expect_gt() {
  local got="$1" than="$2" what="$3"
  if awk -v a="$got" -v b="$than" 'BEGIN{exit !(a+0 > b+0)}'; then
    ok "$what ($got) > $than"
  else
    fail "$what — esperaba > $than, llegó '$got'"
  fi
}

# ── espera activa ────────────────────────────────────────────────────────────
# La cadena es asíncrona por Kafka: aprobar no activa la cuenta en el mismo instante. Reintentar
# no es taparlo, es reconocer que el sistema es eventual; lo que sí sería taparlo es un sleep fijo
# largo, que además hace la prueba lenta cuando todo va bien.
wait_for() {
  local desc="$1" attempts="${2:-20}" delay="${3:-1.5}"; shift 3
  local i
  for (( i = 1; i <= attempts; i++ )); do
    if "$@"; then
      (( i > 1 )) && info "$desc — resuelto en el intento $i"
      return 0
    fi
    sleep "$delay"
  done
  return 1
}

# ── sesión de backoffice ─────────────────────────────────────────────────────
BO_TOKEN=''

bo_login() {
  local email="$1" password="$2"
  _http POST "$BO_HOST" /auth/staff/login '' "$(jq -nc --arg e "$email" --arg p "$password" '{email:$e,password:$p}')"
  if [[ "$HTTP_STATUS" != "200" ]]; then
    BO_TOKEN=''
    return 1
  fi
  BO_TOKEN="$(jget '.accessToken')"
  [[ -n "$BO_TOKEN" && "$BO_TOKEN" != "null" ]]
}

# Dos motivos legítimos para reintentar un login, y ninguno es "la credencial está mal":
#
#   · 429 — el gateway limita /auth/staff/login por minuto contra fuerza bruta. Encadenar los
#     logins de doce roles lo dispara; aquí el 429 es la política funcionando.
#   · 502/503/0 — el servicio acaba de reiniciarse y todavía no acepta tráfico. Es la ventana de
#     arranque, no un fallo de la prueba.
#
# Un 401 sí se devuelve de inmediato: esa credencial no va a mejorar esperando.
bo_login_retry() {
  local email="$1" password="$2" i
  for (( i = 1; i <= 6; i++ )); do
    if bo_login "$email" "$password"; then return 0; fi
    case "$HTTP_STATUS" in
      429)
        info "rate limit en login de $email, esperando 12s (intento $i)"
        sleep 12 ;;
      0|502|503|504)
        info "el BFF aún no responde ($HTTP_STATUS), esperando 5s (intento $i)"
        sleep 5 ;;
      *) return 1 ;;
    esac
  done
  return 1
}
