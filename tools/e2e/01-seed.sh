#!/usr/bin/env bash
# Siembra el entorno para las pruebas: un empleado por rol y el catálogo de productos.
#
# Es idempotente a propósito. Un seed que solo funciona sobre base vacía obliga a tirar el entorno
# para volver a correrlo, y en la práctica eso significa que deja de correrse: cuando el alta
# devuelve 409 (ya existe) se toma como éxito y se sigue.

set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
source ./lib.sh

need curl; need jq; need docker

step "Sesión de administrador"
bo_login_retry "$ADMIN_EMAIL" "$ADMIN_PASSWORD" \
  || die "no se pudo iniciar sesión como $ADMIN_EMAIL (HTTP $HTTP_STATUS: $(printf '%s' "$HTTP_BODY" | head -c 200))"
ok "sesión iniciada como $ADMIN_EMAIL"
ADMIN_TOKEN="$BO_TOKEN"

# ── empleados, uno por rol ───────────────────────────────────────────────────
# Un usuario por rol y no uno con todos: la única forma de comprobar que un permiso *falta* es
# tener a alguien que no lo tenga. Un superusuario prueba que las rutas responden, no que estén
# protegidas.
step "Empleados por rol"

# email|nombre|roles (coma) |tipo
STAFF_FIXTURES=(
  "ops@kredius.mx|Olivia Paz|OPS_SUPERVISOR|INTERNO"
  "analista@kredius.mx|Sandra Núñez|CREDIT_ANALYST,RISK_ANALYST|INTERNO"
  "underwriter@kredius.mx|Ulises Ward|UNDERWRITER|INTERNO"
  "comite@kredius.mx|Comité de Crédito|COMMITTEE|INTERNO"
  "ejecutivo@kredius.mx|Ana Torres|EXECUTIVE|INTERNO"
  "cobranza@kredius.mx|Cecilia Bravo|COLLECTIONS_AGENT|INTERNO"
  "riesgo@kredius.mx|Raúl Islas|RISK_ANALYST|INTERNO"
  "producto@kredius.mx|Pablo Vela|PRODUCT_MANAGER|INTERNO"
  "finanzas@kredius.mx|Fernanda Nava|FINANCE|INTERNO"
  "auditor@kredius.mx|Aurora Díaz|AUDITOR|INTERNO"
  "soporte@kredius.mx|Sergio Ponce|SUPPORT|INTERNO"
  "marketing@kredius.mx|Mario Kant|MARKETING|INTERNO"
)

for fixture in "${STAFF_FIXTURES[@]}"; do
  IFS='|' read -r email name roles etype <<< "$fixture"
  roles_json="$(printf '%s' "$roles" | jq -Rc 'split(",")')"
  payload="$(jq -nc \
    --arg e "$email" --arg n "$name" --arg t "$etype" --arg p "$STAFF_PASSWORD" \
    --argjson r "$roles_json" \
    '{email:$e, fullName:$n, employeeType:$t, roles:$r, password:$p}')"
  bo_post /staff "$payload" "$ADMIN_TOKEN"
  case "$HTTP_STATUS" in
    200|201) ok "alta de $email ($roles)" ;;
    409)
      # Reconciliar, no aceptar lo que haya. Un empleado que sobrevive de una corrida anterior con
      # otros roles cambia en silencio lo que significa la prueba de permisos: el rol "COMMITTEE"
      # que también es UNDERWRITER deja de servir para comprobar que a un comité le falta algo.
      # El seed existe para dejar un estado conocido.
      bo_get /staff "$ADMIN_TOKEN"
      # El listado expone `staffUserId`; el login devuelve el mismo valor como `user.id`. Se
      # aceptan los dos nombres para que la diferencia no rompa el seed si alguno se unifica.
      staff_id="$(printf '%s' "$HTTP_BODY" | jq -r --arg e "$email" \
        '(if type=="array" then . else .content end) | map(select(.email==$e)) | first | (.staffUserId // .id) // empty')"
      current="$(printf '%s' "$HTTP_BODY" | jq -r --arg e "$email" \
        '(if type=="array" then . else .content end) | map(select(.email==$e)) | first | (.roles // []) | sort | join(",")')"
      want="$(printf '%s' "$roles" | tr ',' '\n' | sort | paste -sd, -)"
      if [[ "$current" == "$want" ]]; then
        ok "$email ya existía con los roles correctos ($roles)"
      elif [[ -n "$staff_id" ]]; then
        bo_put "/staff/$staff_id/roles" "$(jq -nc --argjson r "$roles_json" '{roles:$r}')" "$ADMIN_TOKEN"
        case "$HTTP_STATUS" in
          200|204) ok "$email reconciliado: '$current' → '$want'" ;;
          *)       fail "no se pudieron corregir los roles de $email — HTTP $HTTP_STATUS" ;;
        esac
      else
        fail "$email existe pero no aparece en /staff; no se pudo reconciliar"
      fi
      ;;
    *) fail "alta de $email — HTTP $HTTP_STATUS: $(printf '%s' "$HTTP_BODY" | head -c 160)" ;;
  esac
done

# Se comprueba que los empleados sembrados pueden entrar de verdad. Dar de alta y poder iniciar
# sesión son cosas distintas: un usuario creado con un hash mal formado se ve bien en la lista
# y falla en el login, que es donde importa.
step "Los empleados sembrados pueden entrar"
for fixture in "${STAFF_FIXTURES[@]}"; do
  IFS='|' read -r email name roles etype <<< "$fixture"
  if bo_login_retry "$email" "$STAFF_PASSWORD"; then
    got_roles="$(jget '.user.roles | sort | join(",")')"
    want_roles="$(printf '%s' "$roles" | tr ',' '\n' | sort | paste -sd, -)"
    expect_eq "$got_roles" "$want_roles" "roles de $email"
  else
    fail "login de $email — HTTP $HTTP_STATUS"
  fi
done

# ── catálogo de productos ────────────────────────────────────────────────────
step "Catálogo de productos"
bo_login_retry "producto@kredius.mx" "$STAFF_PASSWORD" || die "no se pudo entrar como product manager"
bo_get /products
if [[ "$HTTP_STATUS" == "200" ]]; then
  n="$(jget 'if type=="array" then length else (.content|length) end')"
  if [[ "${n:-0}" -gt 0 ]]; then
    ok "catálogo con $n productos"
    printf '%s' "$HTTP_BODY" > "$ARTIFACT_DIR/products.json"
  else
    warn "el catálogo está vacío — el journey no podrá elegir producto"
  fi
else
  fail "no se pudo leer el catálogo — HTTP $HTTP_STATUS"
fi

summary
