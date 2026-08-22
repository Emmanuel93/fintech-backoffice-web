#!/usr/bin/env bash
# Comprueba la matriz RBAC del BFF desde los dos lados.
#
# Que una ruta responda a quien tiene el rol es la mitad fácil. La otra mitad —que responda 403 a
# quien no lo tiene— es la que de verdad se rompe: se añade un endpoint, se olvida el matcher, y
# queda abierto a cualquier empleado autenticado sin que nada falle. Por eso cada fila se prueba
# con un rol permitido y con uno denegado.
#
# Ocultar el módulo en el menú del front no cuenta: quien tiene el token puede pedir la ruta a
# mano. Lo que se verifica aquí es el servidor, que es quien manda.

set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
source ./lib.sh

need curl; need jq

# ruta | método | roles permitidos | correo permitido | correo denegado
# El correo denegado es siempre un empleado real y autenticado: probar con un token inválido
# comprobaría la autenticación, no la autorización, que es lo que interesa aquí.
MATRIX=(
  "/dashboard/summary|GET|todos|soporte@kredius.mx|"
  "/portfolio?size=1|GET|ADMIN,CREDIT_ANALYST,RISK_ANALYST,EXECUTIVE,OPS_SUPERVISOR|analista@kredius.mx|marketing@kredius.mx"
  "/clients?size=1|GET|ADMIN,CREDIT_ANALYST,EXECUTIVE,OPS_SUPERVISOR,SUPPORT|soporte@kredius.mx|finanzas@kredius.mx"
  "/products|GET|todos|cobranza@kredius.mx|"
  "/staff|GET|ADMIN|admin@kredius.mx|ops@kredius.mx"
  "/origination/applications|GET|ADMIN,CREDIT_ANALYST,UNDERWRITER,COMMITTEE,OPS_SUPERVISOR|underwriter@kredius.mx|cobranza@kredius.mx"
  "/executives|GET|autenticado|ejecutivo@kredius.mx|"
)

step "Matriz de permisos del BFF"

for row in "${MATRIX[@]}"; do
  IFS='|' read -r path method roles allow deny <<< "$row"

  # ── lado permitido ──
  if bo_login_retry "$allow" "$STAFF_PASSWORD"; then
    bo_get "$path"
    # 404/501 significan "la ruta aún no existe", no "te falta permiso": se distingue para que un
    # módulo pendiente no se confunda con un permiso mal puesto.
    case "$HTTP_STATUS" in
      200|204) ok "$method $path — permitido a $allow" ;;
      404)     warn "$method $path — la ruta no existe todavía (404), permiso no verificable" ;;
      403)     fail "$method $path — $allow DEBERÍA tener acceso ($roles) y recibió 403" ;;
      *)       fail "$method $path — $allow recibió HTTP $HTTP_STATUS" ;;
    esac
  else
    fail "no se pudo entrar como $allow para probar $path"
  fi

  # ── lado denegado ──
  [[ -z "$deny" ]] && continue
  if bo_login_retry "$deny" "$STAFF_PASSWORD"; then
    bo_get "$path"
    case "$HTTP_STATUS" in
      403) ok "$method $path — negado a $deny, como debe ser" ;;
      404) warn "$method $path — 404 para $deny; la ruta no existe, el permiso no se probó" ;;
      *)   fail "$method $path — $deny NO debería entrar ($roles) y recibió HTTP $HTTP_STATUS" ;;
    esac
  else
    fail "no se pudo entrar como $deny para probar $path"
  fi
done

# ── sin sesión ───────────────────────────────────────────────────────────────
step "Sin sesión no se entra a ningún lado"
for path in /dashboard/summary /portfolio /clients /staff; do
  _http GET "$BO_HOST" "$path" '' ''
  case "$HTTP_STATUS" in
    401|403) ok "$path rechaza sin token (HTTP $HTTP_STATUS)" ;;
    *)       fail "$path respondió $HTTP_STATUS sin token" ;;
  esac
done

# ── canal equivocado ─────────────────────────────────────────────────────────
# Un token del canal móvil no debe abrir la consola aunque sea válido y esté firmado por la misma
# llave: la separación de canales es lo que impide que la sesión de un cliente sirva de credencial
# de empleado.
step "Un token de otro canal no abre la consola"
mob_post /auth/login "$(jq -nc '{phone:"+525500000000",password:"irrelevante"}')"
if [[ "$HTTP_STATUS" == "200" ]]; then
  mobile_token="$(jget '.accessToken')"
  _http GET "$BO_HOST" /dashboard/summary "$mobile_token" ''
  case "$HTTP_STATUS" in
    401|403) ok "el token móvil no entra al backoffice (HTTP $HTTP_STATUS)" ;;
    *)       fail "un token MOBILE abrió el backoffice — HTTP $HTTP_STATUS" ;;
  esac
else
  info "sin cliente móvil sembrado para esta comprobación (login devolvió $HTTP_STATUS); se omite"
fi

summary
