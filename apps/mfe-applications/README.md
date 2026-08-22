# mfe-applications — Solicitudes y Beneficiarios  ·  `:5105`

Dos colas con dueños distintos que comparten remote:

- **Solicitudes de crédito** — el ciclo entero: captura, mesa de análisis, decisión, oferta,
  contrato y desembolso.
- **Beneficiarios de crédito** — colocaciones B2B2C: la distribuidora invita, la persona verifica
  su identidad, la distribuidora decide y firma que asume el riesgo.

## Qué consume

`/origination/applications[/{id}]` · `/{id}/decision` · `/{id}/request-documents` ·
`/{id}/documents[/{tipo}/file]` · `/beneficiaries/placements[/{id}]`

## Decisiones

**«Por decidir» es un filtro, no una pantalla.** Tuvo entrada de menú y se retiró: ofrecer la lista
y un recorte de la misma lista obliga a elegir entre dos puertas al mismo sitio antes de saber cuál
lleva a lo que se busca. Vive como botón en la barra de filtros.

**El embudo se calcula sin el filtro de estatus.** Recalculado con él, elegir una etapa dejaba el
tablero con una sola barra al 100% y se perdía la comparación para la que existe. Los demás
filtros sí lo acotan.

**En beneficiarios validamos identidad, no riesgo.** El historial que ve la distribuidora es
informativo y **no bloquea**; lo único que detiene el depósito es una identidad sin comprobar. Por
eso `identityStatus` tiene columna propia y no se mezcla con el paso del proceso.

**El teléfono llega enmascarado desde el servicio.** Es dato de alguien que no es cliente de la
casa; la consola no debe poder recomponerlo.

**Desde aquí no se aprueba ni se deposita una colocación.** Eso ocurre en la app de la distribuidora
y en credit-portfolio. Esta pantalla existe para contestar «¿por qué no le ha llegado su dinero?»,
y se contesta leyendo en qué salto se detuvo.
