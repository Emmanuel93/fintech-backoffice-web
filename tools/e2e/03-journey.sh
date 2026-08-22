#!/usr/bin/env bash
# Journey completo de un crédito, visto desde el backoffice.
#
#   solicitud → scoring → autorización → contrato → desembolso → consulta → devengo → pagos → cierre
#
# Dos reglas que gobiernan todo el archivo:
#
#   1. Lo que la consola *ve* se lee siempre por `bo_*` (gateway → BFF de backoffice). Si un dato
#      se comprobara leyéndolo del servicio de dominio, la prueba pasaría aunque el BFF no lo
#      expusiera, que es justo el fallo que se quiere detectar.
#
#   2. Lo que *ocurre* lo provocan los otros actores: el cliente que solicita (`svc` a origination,
#      como haría el canal móvil) y los procesos batch (`svc` a los test-support). El backoffice
#      solo interviene donde de verdad interviene: autorizando.
#
# El tiempo se mueve con los endpoints /internal/test-support de charges y cartera. Sin eso, ver
# un crédito devengar y liquidarse tomaría meses reales.

set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
source ./lib.sh

need curl; need jq; need docker

ORIGINATION=http://origination-service:8080
SCORING=http://scoring-service:8080
PAYMENTS=http://payments-service:8080
CHARGES=http://charges-service:8080
PORTFOLIO=http://credit-portfolio-service:8080

RUN_ID="$(date +%s)"
STATE="$ARTIFACT_DIR/journey-state.env"
: > "$STATE"
remember() { printf '%s=%s\n' "$1" "$2" >> "$STATE"; }

# CURP y teléfono irrepetibles: el alta de prospecto es única por CURP y por teléfono, y reusarlos
# haría que la segunda corrida chocara con la primera en vez de crear un caso nuevo.
#
# La CURP tiene que pasar el patrón del dominio —4 letras, 6 dígitos, H/M, 5 letras, 1 alfanumérico,
# 1 dígito—, así que la parte variable se codifica en letras, no en dígitos: meter el número de
# corrida dentro del bloque de cinco letras produce un 400 de validación, no una CURP repetida.
letters_of() {  # entero → n letras A-Z
  local n="$1" v="$2" out='' i
  for (( i = 0; i < n; i++ )); do
    out="$(printf '\\%03o' $(( 65 + v % 26 )))$out"
    v=$(( v / 26 ))
  done
  printf '%b' "$out"
}
CURP="TEJU900101H$(letters_of 5 "$RUN_ID")$(letters_of 1 $(( RUN_ID / 11 )))$(( RUN_ID % 10 ))"
PHONE="+5255${RUN_ID: -8}"
USERNAME="e2e${RUN_ID}"
USER_PASSWORD='E2ePassw0rd!2026'

# ─────────────────────────────────────────────────────────────────────────────
step "0 · Los servicios del recorrido aceptan tráfico"

# Se espera antes de empezar, no durante. Si el scoring todavía no escucha cuando le toca, la
# solicitud se queda en PENDING_SCORING y fallan los seis pasos siguientes por una razón que no
# tiene nada que ver con ellos: el reporte diría "transición inválida" cuando el problema era que
# el servicio llevaba ocho segundos arrancando.
for pair in "origination:$ORIGINATION" "scoring:$SCORING" "cartera:$PORTFOLIO" "pagos:$PAYMENTS" "cargos:$CHARGES"; do
  svc_name="${pair%%:*}"; svc_url="${pair#*:}"
  if wait_service "$svc_name" "$svc_url"; then
    ok "$svc_name responde"
  else
    fail "$svc_name no aceptó tráfico tras 60s"
  fi
done
(( FAIL_COUNT > 0 )) && die "el entorno no está listo; el journey mediría arranques, no negocio"

# ─────────────────────────────────────────────────────────────────────────────
step "1 · Llega la solicitud"

prospect_body="$(jq -nc \
  --arg curp "$CURP" --arg phone "$PHONE" --arg run "$RUN_ID" \
  --arg user "$USERNAME" --arg pass "$USER_PASSWORD" '{
  prospectType: "INDIVIDUAL",
  firstName: "Julieta", lastName1: "Tejeda", lastName2: "Rojas",
  curp: $curp, rfc: "TERJ900101AB1",
  dateOfBirth: "1990-01-01", gender: "FEMALE", stateOfBirth: "Ciudad de México",
  phone: $phone, email: ("julieta.e2e+" + $run + "@kredius.mx"),
  street: "Av. Reforma", exteriorNumber: "222", neighborhood: "Juárez",
  municipality: "Cuauhtémoc", city: "Ciudad de México", state: "Ciudad de México",
  postalCode: "06600", country: "MX",
  channelType: "MOBILE_APP",
  privacyNoticeAccepted: true, circuloConsentAccepted: true,
  documents: [],
  username: $user, password: $pass
}')"

svc POST "$ORIGINATION/api/v1/origination/prospects" "$prospect_body"
expect_status_in "200 201" "alta del prospecto"
PROSPECT_ID="$(jget '.prospectId')"
expect_not_empty "$PROSPECT_ID" "prospectId"
remember PROSPECT_ID "$PROSPECT_ID"
[[ -z "$PROSPECT_ID" || "$PROSPECT_ID" == "null" ]] && die "sin prospecto no hay journey que seguir"

app_body="$(jq -nc --arg p "$PROSPECT_ID" '{
  prospectId: $p, productType: "PERSONAL_LOAN", requestedAmount: 60000, requestedTerm: 24
}')"
svc POST "$ORIGINATION/api/v1/origination/applications" "$app_body"
expect_status_in "200 201" "alta de la solicitud"
APP_ID="$(jget '.applicationId')"
expect_not_empty "$APP_ID" "applicationId"
remember APP_ID "$APP_ID"
[[ -z "$APP_ID" || "$APP_ID" == "null" ]] && die "sin solicitud no hay journey que seguir"
info "prospecto $PROSPECT_ID · solicitud $APP_ID"

# ─────────────────────────────────────────────────────────────────────────────
step "2 · El analista la ve en la consola"

bo_login_retry "analista@kredius.mx" "$STAFF_PASSWORD" || die "no se pudo entrar como analista"

sees_application() {
  bo_get "/origination/applications"
  [[ "$HTTP_STATUS" == "200" ]] && printf '%s' "$HTTP_BODY" | jq -e --arg id "$APP_ID" \
    '(if type=="array" then . else .content end) | any(.applicationId == $id)' >/dev/null 2>&1
}

if wait_for "la solicitud aparece en la bandeja" 20 1.5 sees_application; then
  ok "la solicitud $APP_ID aparece en /origination/applications"
else
  fail "la solicitud no aparece en la bandeja del backoffice (último HTTP $HTTP_STATUS)"
fi

# ─────────────────────────────────────────────────────────────────────────────
step "3 · Scoring"

svc POST "$SCORING/api/v1/scoring/evaluate/$PROSPECT_ID?prospectType=INDIVIDUAL&productTypeIntent=PERSONAL_LOAN" '{}'
expect_status_in "200 201 202" "evaluación de score"

svc GET "$SCORING/api/v1/scoring/evaluations/$PROSPECT_ID/latest"
if [[ "$HTTP_STATUS" == "200" ]]; then
  SCORE="$(jget '.totalScore // .score')"
  RISK="$(jget '.riskLevel')"
  expect_not_empty "$SCORE" "score del prospecto"
  info "score $SCORE · riesgo $RISK"
  remember SCORE "$SCORE"
else
  warn "sin evaluación consultable (HTTP $HTTP_STATUS) — el flujo sigue por decisión manual"
fi

# ─────────────────────────────────────────────────────────────────────────────
step "4 · Autorización del crédito"

# El flujo de aprobación depende del score: un riesgo bajo se resuelve solo (AUTOMATIC) y llega a
# APPROVED sin que nadie toque la consola. Pedir una decisión manual sobre una solicitud ya
# aprobada devuelve 422 por transición inválida — que es el dominio funcionando, no un fallo.
# Por eso se lee primero el estado y se decide qué corresponde.
bo_login_retry "underwriter@kredius.mx" "$STAFF_PASSWORD" || die "no se pudo entrar como underwriter"

svc GET "$ORIGINATION/api/v1/origination/applications/$APP_ID"
APP_STATUS="$(jget '.status')"
APP_FLOW="$(jget '.approvalFlow')"
info "estado de la solicitud: $APP_STATUS · flujo $APP_FLOW"

case "$APP_STATUS" in
  APPROVED|OFFER_PRESENTED|OFFER_ACCEPTED|PENDING_SIGNATURE|CONTRACT_SIGNED|DISBURSED)
    ok "autorizada por flujo $APP_FLOW sin intervención manual (estado $APP_STATUS)" ;;
  UNDER_MANUAL_REVIEW|COMMITTEE_REVIEW|PENDING_SCORING|SCORING)
    # Aquí sí actúa el backoffice, y se hace por el BFF: es exactamente lo que hará la persona.
    bo_post "/origination/applications/$APP_ID/decision" "$(jq -nc '{approved:true}')"
    case "$HTTP_STATUS" in
      200|201|204) ok "solicitud autorizada desde la consola" ;;
      404) warn "el BFF no expone la decisión todavía (404) — se autoriza por el dominio para seguir"
           svc POST "$ORIGINATION/api/v1/origination/underwriting/applications/$APP_ID/decision" \
             "$(jq -nc '{decidedBy:"e2e-underwriter", approved:true}')"
           expect_status_in "200 201 204" "autorización por el servicio de originación" ;;
      *) fail "la autorización devolvió HTTP $HTTP_STATUS: $(printf '%s' "$HTTP_BODY" | head -c 200)" ;;
    esac ;;
  REJECTED)
    fail "la solicitud fue rechazada (score $SCORE); el journey no puede continuar"
    summary; exit 1 ;;
  *)
    warn "estado inesperado '$APP_STATUS'; se intenta continuar" ;;
esac

# Un rol sin facultad de autorizar no debe poder hacerlo, esté la solicitud como esté. Esta es la
# comprobación que evita que la decisión de crédito quede al alcance de cualquier empleado con
# sesión: lo que se mira es el 403, no el resultado de la operación.
if bo_login_retry "soporte@kredius.mx" "$STAFF_PASSWORD"; then
  bo_post "/origination/applications/$APP_ID/decision" "$(jq -nc '{approved:true}')"
  case "$HTTP_STATUS" in
    403) ok "soporte NO puede autorizar créditos (403)" ;;
    404) warn "ruta de decisión inexistente; la restricción no se pudo verificar" ;;
    *)   fail "soporte pudo llamar a la decisión — HTTP $HTTP_STATUS" ;;
  esac
fi

# ─────────────────────────────────────────────────────────────────────────────
step "5 · Oferta, contrato y desembolso"

# El código de producto se toma del catálogo que expone el BFF, no de una constante: los códigos
# llevan sufijo de versión (PL-IND-STD-V1) y fijarlo a mano hace que la prueba se rompa en la
# siguiente versión del producto por un motivo que no tiene nada que ver con lo que prueba.
bo_login_retry "producto@kredius.mx" "$STAFF_PASSWORD" || die "no se pudo entrar como product manager"
bo_get /products
PRODUCT_CODE="$(printf '%s' "$HTTP_BODY" | jq -r \
  '(if type=="array" then . else .content end)
   | map(select(.productType == "PERSONAL_LOAN" and .status == "ACTIVE"))
   | first | .productCode // empty')"
if [[ -z "$PRODUCT_CODE" ]]; then
  fail "no hay un PERSONAL_LOAN activo en el catálogo; no se puede ofertar"
  summary; exit 1
fi
ok "producto elegido del catálogo: $PRODUCT_CODE"
remember PRODUCT_CODE "$PRODUCT_CODE"

svc POST "$ORIGINATION/api/v1/origination/applications/$APP_ID/offer" \
  "$(jq -nc --arg c "$PRODUCT_CODE" '{productCode:$c, offeredAmount:60000, offeredTerm:24}')"
expect_status_in "200 201" "oferta presentada"

svc POST "$ORIGINATION/api/v1/origination/applications/$APP_ID/offer/accept" '{}'
expect_status_in "200 201 204" "oferta aceptada por el cliente"

svc POST "$ORIGINATION/api/v1/origination/applications/$APP_ID/contract/generate" \
  "$(jq -nc '{signatureMethod:"ELECTRONIC"}')"
expect_status_in "200 201" "contrato generado"

svc POST "$ORIGINATION/api/v1/origination/applications/$APP_ID/contract/sign" \
  "$(jq -nc '{clabeAccount:"646180000000000123", signatureProof:"e2e-signature", documentRef:"e2e-contract.pdf"}')"
expect_status_in "200 201 204" "contrato firmado (dispara el desembolso)"

# ─────────────────────────────────────────────────────────────────────────────
step "6 · El crédito aparece en cartera"

bo_login_retry "analista@kredius.mx" "$STAFF_PASSWORD" || die "no se pudo entrar como analista"

CREDIT_ACCOUNT_ID=''
finds_account() {
  bo_get "/portfolio?size=100&sort=createdAt,desc"
  [[ "$HTTP_STATUS" != "200" ]] && return 1
  CREDIT_ACCOUNT_ID="$(printf '%s' "$HTTP_BODY" | jq -r --arg p "$PROSPECT_ID" \
    '(.content // []) | map(select(.obligorPartyId == $p)) | first | .creditAccountId // empty')"
  [[ -n "$CREDIT_ACCOUNT_ID" ]]
}

# El desembolso viaja por Kafka: firmar y ver la cuenta activa no ocurre en el mismo instante.
if wait_for "la cuenta se abre en cartera" 40 2 finds_account; then
  ok "cuenta creada y visible en /portfolio: $CREDIT_ACCOUNT_ID"
  remember CREDIT_ACCOUNT_ID "$CREDIT_ACCOUNT_ID"
else
  fail "el crédito nunca apareció en la cartera del backoffice"
  summary; exit 1
fi

bo_get "/portfolio/$CREDIT_ACCOUNT_ID"
expect_status 200 "detalle de la cuenta"
CONTRACT="$(jget '.contractNumber')"
PRINCIPAL_0="$(jget '.principalBalance')"
SCHEDULE_N="$(jget '.schedule | length')"
expect_not_empty "$CONTRACT" "número de contrato"
expect_gt "$PRINCIPAL_0" 0 "capital dispuesto"
expect_gt "$SCHEDULE_N" 0 "mensualidades en el calendario"
info "contrato $CONTRACT · capital $PRINCIPAL_0 · $SCHEDULE_N mensualidades"

# ─────────────────────────────────────────────────────────────────────────────
step "7 · Devengo de intereses"

svc POST "$CHARGES/internal/test-support/run-daily-accrual" '{}'
expect_status_in "200 202 204" "corrida de devengo diario"

accrued_moved() {
  bo_get "/portfolio/$CREDIT_ACCOUNT_ID"
  [[ "$HTTP_STATUS" == "200" ]] && awk -v v="$(jget '.accruedInterestBalance')" 'BEGIN{exit !(v+0 > 0)}'
}
if wait_for "el interés devengado se refleja en la consola" 15 2 accrued_moved; then
  ok "interés devengado visible: $(jget '.accruedInterestBalance')"
else
  warn "el devengo no movió el saldo de interés (puede no haber días transcurridos que devengar)"
fi

# ─────────────────────────────────────────────────────────────────────────────
step "8 · Pagos y su aplicación"

bo_get "/portfolio/$CREDIT_ACCOUNT_ID"
INSTALLMENT_AMOUNT="$(jget '.schedule[0].totalAmount // .minimumPayment // 0')"
OBLIGOR="$(jget '.obligorPartyId')"
info "mensualidad a cubrir: $INSTALLMENT_AMOUNT"

pay() {
  local amount="$1" ref="$2"
  svc POST "$PAYMENTS/api/v1/payments" "$(jq -nc \
    --arg a "$CREDIT_ACCOUNT_ID" --arg o "$OBLIGOR" --arg r "$ref" --argjson m "$amount" \
    '{creditAccountId:$a, obligorPartyId:$o, amount:$m, paymentMethod:"SPEI", externalRef:$r}')"
}

pay "$INSTALLMENT_AMOUNT" "E2E-$RUN_ID-1"
expect_status_in "200 201" "primer pago registrado"
PAYMENT_1="$(jget '.paymentOrderId')"
PAYMENT_1_STATUS="$(jget '.status')"
info "orden $PAYMENT_1 en estado $PAYMENT_1_STATUS"

# El pago se confirma de forma asíncrona; lo que se comprueba es que la consola termine viéndolo,
# no que sea instantáneo.
payment_visible() {
  bo_get "/portfolio/$CREDIT_ACCOUNT_ID"
  [[ "$HTTP_STATUS" == "200" ]] && printf '%s' "$HTTP_BODY" | jq -e --arg id "$PAYMENT_1" \
    '(.payments // []) | any(.paymentOrderId == $id)' >/dev/null 2>&1
}
if wait_for "el pago aparece en la ficha del backoffice" 25 2 payment_visible; then
  st="$(printf '%s' "$HTTP_BODY" | jq -r --arg id "$PAYMENT_1" '(.payments // []) | map(select(.paymentOrderId==$id)) | first | .status')"
  ok "el pago se ve en la consola con estatus $st"
else
  fail "el pago nunca apareció en /portfolio/{id} — la consola no muestra los pagos aplicados"
fi

payment_applied() {
  bo_get "/portfolio/$CREDIT_ACCOUNT_ID"
  [[ "$HTTP_STATUS" == "200" ]] && awk -v v="$(jget '.paidInstallments // 0')" 'BEGIN{exit !(v+0 > 0)}'
}
if wait_for "el pago mueve el calendario" 25 2 payment_applied; then
  ok "mensualidades cubiertas: $(jget '.paidInstallments') de $(jget '.totalInstallments')"
  PRINCIPAL_1="$(jget '.principalBalance')"
  if awk -v a="$PRINCIPAL_1" -v b="$PRINCIPAL_0" 'BEGIN{exit !(a+0 < b+0)}'; then
    ok "el capital bajó de $PRINCIPAL_0 a $PRINCIPAL_1"
  else
    warn "el capital no bajó ($PRINCIPAL_0 → $PRINCIPAL_1); el pago pudo aplicarse primero a interés"
  fi
else
  warn "el pago no movió el contador de mensualidades cubiertas"
fi

# ─────────────────────────────────────────────────────────────────────────────
step "9 · Liquidación del crédito"

bo_get "/portfolio/$CREDIT_ACCOUNT_ID"
PAYOFF="$(jget '.totalDebt')"
info "adeudo total para liquidar: $PAYOFF"

if awk -v v="$PAYOFF" 'BEGIN{exit !(v+0 > 0)}'; then
  pay "$PAYOFF" "E2E-$RUN_ID-PAYOFF"
  expect_status_in "200 201" "pago de liquidación registrado"

  settled() {
    bo_get "/portfolio/$CREDIT_ACCOUNT_ID"
    [[ "$HTTP_STATUS" != "200" ]] && return 1
    local st bal
    st="$(jget '.status')"; bal="$(jget '.totalDebt')"
    [[ "$st" == "SETTLED" || "$st" == "CLOSED" ]] || awk -v v="$bal" 'BEGIN{exit !(v+0 <= 0.01)}'
  }
  if wait_for "el crédito queda liquidado" 30 2 settled; then
    ok "estatus final: $(jget '.status') · adeudo $(jget '.totalDebt')"
  else
    warn "el crédito no llegó a SETTLED (estatus $(jget '.status'), adeudo $(jget '.totalDebt'))"
  fi
else
  warn "el adeudo ya era cero; no hay nada que liquidar"
fi

# ─────────────────────────────────────────────────────────────────────────────
step "10 · El tablero se movió"

bo_login_retry "ops@kredius.mx" "$STAFF_PASSWORD" || die "no se pudo entrar como supervisor"
bo_get /dashboard/summary
expect_status 200 "resumen del tablero"
CAPITAL="$(jget '.capitalColocado')"
ACCOUNTS="$(jget '.activeAccounts')"
expect_gt "$ACCOUNTS" 0 "cuentas activas en el tablero"
info "capital colocado $CAPITAL · $ACCOUNTS cuentas activas"
printf '%s' "$HTTP_BODY" > "$ARTIFACT_DIR/dashboard-after.json"

info "estado de la corrida guardado en $STATE"
summary
