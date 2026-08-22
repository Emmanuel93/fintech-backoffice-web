# mfe-accounting — Contabilidad  ·  `:5110`

Cuatro pantallas sobre un mismo período: **Resumen general**, **Pólizas**, **Facturas** y
**Balanza**.

## Qué consume

`/accounting/{periods,summary,units,vouchers,loans,trial-balance}` · `/vouchers/{id}` ·
`/accounts/{id}/ledger` · `/invoices[/{id}]` · `POST /accounting/periods/{p}/{close,reopen}` ·
`POST /accounting/billing-runs` · `POST /accounting/backfill-origin-units`

## Decisiones

**El período manda sobre todo y vive fuera de las pestañas.** Si cada vista llevara el suyo,
comparar el resumen contra la balanza obligaría a acordarse de mover dos selectores, y la primera
vez que se olvide uno la conclusión será que la contabilidad no cuadra. Por eso el shell pasa la
vista como prop y **no remonta** el módulo: cambiar de pantalla conserva el mes.

**La navegación es circular a propósito** —póliza → préstamo → póliza, factura → préstamo →
factura—, porque conciliar es ir y volver entre esas tres cosas.

**El cuadre va primero y en grande.** Una balanza descuadrada no es un número peor: es que ningún
número de la pantalla se puede usar. Al final, entre otras seis cifras, se lee como un detalle.

**Cerrar exige `accounting.close`, que un auditor no tiene.** Auditar no puede implicar poder mover
el corte de lo que se está auditando. Cerrar no rechaza lo que llegue después: se asienta en el
primer período abierto y queda marcado como extemporáneo.

**La reconciliación de sucursal corre en dos tiempos.** Primero en seco —no escribe nada— y sólo
después se aplica: reatribuir de qué sucursal es un ingreso se lee en los números de la gente. Lo
que no se resuelve se queda sin sucursal y se reporta contado; repartirlo con una heurística haría
que las sumas cerraran a costa de atribuirle ingreso a quien no lo colocó, y eso ya no se audita.

> El botón de reconciliar se ofrece con `accounting.close`, aunque el BFF hoy lo deja pasar con
> `accounting.view` (cae en el matcher genérico de `/accounting/**`). Es cortesía de la consola, no
> la puerta.
